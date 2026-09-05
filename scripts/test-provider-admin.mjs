import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync, mkdtempSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const root = process.cwd();
// These modules import each other, so they are transpiled into a shared
// directory as .mjs files where the relative specifiers still resolve.
const buildDir = mkdtempSync(join(tmpdir(), 'sentra-build-'));

function transpileLib(name) {
  const source = readFileSync(resolve(root, 'src/lib', `${name}.ts`), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
    },
    fileName: `${name}.ts`,
  });
  const code = outputText
    .replace(/from ['"]@\/lib\/([^'"]+)['"]/g, (_m, dep) => `from './${dep}.mjs'`)
    .replace(/from ['"]\.\/([^'"]+)['"]/g, (_m, dep) => `from './${dep.replace(/\.mjs$/, '')}.mjs'`);
  writeFileSync(join(buildDir, `${name}.mjs`), code, 'utf8');
}

for (const name of ['provider-health', 'provider-config', 'admin-guard', 'cache-registry']) {
  transpileLib(name);
}

const importLib = (name) => import(pathToFileURL(join(buildDir, `${name}.mjs`)).href);

// ── Admin guard ────────────────────────────────────────────────────────────
const guardModule = await importLib('admin-guard');
const { guardAdminRequest, isAdminEnabled, isLoopbackHost, hostnameOf, ADMIN_REQUEST_HEADER } = guardModule;

const ON = { ENABLE_PROVIDER_ADMIN: 'true' };

assert.equal(isAdminEnabled({}), false, 'admin is off unless explicitly enabled');
assert.equal(isAdminEnabled({ ENABLE_PROVIDER_ADMIN: 'false' }), false);
assert.equal(isAdminEnabled({ ENABLE_PROVIDER_ADMIN: '1' }), false, 'only the literal string true enables it');
assert.equal(isAdminEnabled({ ENABLE_PROVIDER_ADMIN: 'TRUE' }), true);

assert.equal(hostnameOf('localhost:3000'), 'localhost');
assert.equal(hostnameOf('[::1]:3000'), '[::1]');
assert.equal(hostnameOf(null), null);
assert.equal(isLoopbackHost('127.0.0.1:3005'), true);
assert.equal(isLoopbackHost('sentra.example.com'), false);
assert.equal(isLoopbackHost('localhost.evil.com'), false, 'suffix must not be treated as loopback');

const req = (headers) => new Request('http://localhost:3000/api/admin/providers', { headers });

// Disabled by default, and the denial is a 404 so the surface is not advertised.
const offResult = guardAdminRequest(req({ host: 'localhost:3000' }), { env: {} });
assert.equal(offResult.allowed, false);
assert.equal(offResult.reason, 'disabled');
assert.equal(offResult.status, 404);

// Loopback read is allowed.
assert.equal(guardAdminRequest(req({ host: 'localhost:3000' }), { env: ON }).allowed, true);
assert.equal(guardAdminRequest(req({ host: '127.0.0.1:3005' }), { env: ON }).allowed, true);

// A non-loopback Host is refused — this is the DNS-rebinding defence.
const rebind = guardAdminRequest(req({ host: 'attacker.example.com' }), { env: ON });
assert.equal(rebind.allowed, false);
assert.equal(rebind.reason, 'non_local_host');
assert.equal(rebind.status, 403);

// A cross-origin request is refused even when the Host looks local.
const crossOrigin = guardAdminRequest(
  req({ host: 'localhost:3000', origin: 'https://evil.example.com' }),
  { env: ON },
);
assert.equal(crossOrigin.allowed, false);
assert.equal(crossOrigin.reason, 'cross_origin');

// Same-origin loopback origin is fine.
assert.equal(
  guardAdminRequest(req({ host: 'localhost:3000', origin: 'http://localhost:3000' }), { env: ON }).allowed,
  true,
);

// Writes need the custom header — this is what a cross-origin form POST cannot send.
const noHeader = guardAdminRequest(req({ host: 'localhost:3000' }), { env: ON, requireWriteHeader: true });
assert.equal(noHeader.allowed, false);
assert.equal(noHeader.reason, 'missing_admin_header');

const withHeader = guardAdminRequest(
  req({ host: 'localhost:3000', [ADMIN_REQUEST_HEADER]: '1' }),
  { env: ON, requireWriteHeader: true },
);
assert.equal(withHeader.allowed, true);

// ── Provider config storage ────────────────────────────────────────────────
const configDir = mkdtempSync(join(tmpdir(), 'sentra-cfg-'));
process.env.SENTRA_CONFIG_DIR = configDir;
delete process.env.AIS_API_KEY;
process.env.SCANNER_KEY = 'from-environment';

const config = await importLib('provider-config');
const {
  getManagedKeys,
  isManagedKey,
  getProviderEnv,
  setProviderValues,
  describeProviderKeys,
  getOverrideFilePath,
} = config;

// The allowlist comes from the provider inventory, so real keys are writable...
const managed = getManagedKeys();
assert.equal(isManagedKey('AIS_API_KEY'), true);
assert.equal(isManagedKey('OPENSKY_CLIENT_SECRET'), true);
assert.equal(isManagedKey('GEMINI_API_KEY_3'), true);
assert.equal(managed.includes('SUBMARINE_CABLE_BASE_URL'), true);
// ...and arbitrary process variables are not.
assert.equal(isManagedKey('PATH'), false);
assert.equal(isManagedKey('NODE_OPTIONS'), false);
assert.equal(isManagedKey('AWS_SECRET_ACCESS_KEY'), false);

// Before any write, values come from the environment only.
assert.equal(getProviderEnv().SCANNER_KEY, 'from-environment');
assert.equal(getProviderEnv().AIS_API_KEY, undefined);

const written = setProviderValues({
  AIS_API_KEY: '  ais-secret-value  ',
  PATH: '/tmp/evil',
  NODE_OPTIONS: '--require /tmp/x.js',
  OPENSKY_CLIENT_ID: 'opensky-id',
});
assert.deepEqual(written.applied.sort(), ['AIS_API_KEY', 'OPENSKY_CLIENT_ID']);
assert.deepEqual(written.rejected.sort(), ['NODE_OPTIONS', 'PATH']);

// The write takes effect without a restart, and values are trimmed.
assert.equal(getProviderEnv().AIS_API_KEY, 'ais-secret-value');
assert.equal(getProviderEnv().OPENSKY_CLIENT_ID, 'opensky-id');

// Rejected keys never reach the file.
const onDisk = JSON.parse(readFileSync(getOverrideFilePath(), 'utf8'));
assert.deepEqual(Object.keys(onDisk).sort(), ['AIS_API_KEY', 'OPENSKY_CLIENT_ID']);
assert.equal('PATH' in onDisk, false);

// An override wins over the environment.
setProviderValues({ SCANNER_KEY: 'from-override' });
assert.equal(getProviderEnv().SCANNER_KEY, 'from-override');

// Status reporting exposes provenance and length but never the value itself.
const status = describeProviderKeys();
const aisStatus = status.find((s) => s.key === 'AIS_API_KEY');
assert.equal(aisStatus.set, true);
assert.equal(aisStatus.source, 'override');
assert.equal(aisStatus.length, 'ais-secret-value'.length);
assert.equal('value' in aisStatus, false, 'status must not carry the secret');
const serialized = JSON.stringify(status);
assert.equal(serialized.includes('ais-secret-value'), false, 'no secret may appear in the payload');
assert.equal(serialized.includes('from-override'), false);

// Clearing an override falls the key back to its environment value.
setProviderValues({ SCANNER_KEY: '' });
assert.equal(getProviderEnv().SCANNER_KEY, 'from-environment');
assert.equal(describeProviderKeys().find((s) => s.key === 'SCANNER_KEY').source, 'environment');

// Clearing a key with no environment value leaves it unset.
setProviderValues({ AIS_API_KEY: '' });
assert.equal(getProviderEnv().AIS_API_KEY, undefined);
assert.equal(describeProviderKeys().find((s) => s.key === 'AIS_API_KEY').source, 'unset');

// Non-string values are refused rather than coerced.
const badTypes = setProviderValues({ AIS_API_KEY: { nested: true }, SCANNER_URL: 42 });
assert.deepEqual(badTypes.rejected.sort(), ['AIS_API_KEY', 'SCANNER_URL']);

// ── Cache invalidation ─────────────────────────────────────────────────────
const registry = await importLib('cache-registry');
const { registerCacheReset, resetAllProviderCaches, registeredCacheNames } = registry;

let flightsCleared = 0;
registerCacheReset('flights', () => { flightsCleared++; });
registerCacheReset('boom', () => { throw new Error('reset failed'); });
registerCacheReset('cables', () => {});

const cleared = resetAllProviderCaches();
assert.equal(flightsCleared, 1);
assert.equal(cleared.includes('flights'), true);
assert.equal(cleared.includes('cables'), true, 'a throwing resetter must not stop the others');
assert.equal(cleared.includes('boom'), false);
assert.equal(registeredCacheNames().length, 3);

// Registering the same name twice replaces rather than duplicates.
registerCacheReset('flights', () => { flightsCleared += 10; });
resetAllProviderCaches();
assert.equal(flightsCleared, 11);

// ── Route contracts ────────────────────────────────────────────────────────
const routeSource = readFileSync(resolve(root, 'src/app/api/admin/providers/route.ts'), 'utf8');
assert.match(routeSource, /guardAdminRequest\(request\)/, 'GET must be guarded');
assert.match(routeSource, /requireWriteHeader: true/, 'POST must require the write header');
assert.match(routeSource, /resetAllProviderCaches\(\)/, 'a write must invalidate provider caches');
assert.equal(routeSource.includes('getProviderValue'), false, 'no value read path may exist');

// The flights and cables routes must read the merged env, not process.env.
for (const routePath of ['src/app/api/flights/route.ts', 'src/app/api/cables/route.ts']) {
  const src = readFileSync(resolve(root, routePath), 'utf8');
  assert.match(src, /getProviderEnv\(\)/, `${routePath} must use the merged provider env`);
  assert.match(src, /registerCacheReset\(/, `${routePath} must register a cache reset`);
  assert.equal(src.includes('env: process.env'), false, `${routePath} must not read process.env directly`);
}

rmSync(configDir, { recursive: true, force: true });
rmSync(buildDir, { recursive: true, force: true });
assert.equal(existsSync(configDir), false);

console.log('Provider admin tests passed.');
