import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

const root = process.cwd();

async function importTsModule(relativePath) {
  const sourcePath = resolve(root, relativePath);
  const source = readFileSync(sourcePath, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
    },
    fileName: sourcePath,
  });
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(transpiled.outputText).toString('base64')}`;
  return import(moduleUrl);
}

const providerHealth = await importTsModule('src/lib/provider-health.ts');
const {
  buildProviderHealth,
  parseTelegramChannels,
} = providerHealth;

const emptyHealth = buildProviderHealth({});
assert.equal(emptyHealth.platform, 'Sentra Mi8');
assert.ok(emptyHealth.timestamp);
assert.equal(emptyHealth.summary.total, emptyHealth.providers.length);

const byId = new Map(emptyHealth.providers.map((provider) => [provider.id, provider]));
assert.equal(byId.get('public-feeds')?.state, 'keyless');
assert.equal(byId.get('gemini')?.state, 'missing_optional');
assert.equal(byId.get('aisstream')?.state, 'missing_optional');
assert.equal(byId.get('scanner')?.state, 'disabled');
assert.equal(byId.get('sdk-ingest')?.state, 'missing_optional');
assert.equal(byId.get('github-webhook')?.state, 'disabled');
assert.equal(byId.get('umami')?.state, 'disabled');
assert.equal(byId.get('opensky')?.state, 'missing_optional');
assert.equal(byId.get('adsb-lol')?.state, 'keyless');
assert.equal(byId.get('submarine-cables')?.state, 'keyless');
assert.equal(byId.get('osm-surveillance')?.state, 'keyless');
assert.equal(byId.get('windy-webcams')?.state, 'missing_optional');
assert.equal(byId.get('n2yo')?.state, 'planned');
assert.equal(byId.get('firms-keyed')?.state, 'planned');

assert.deepEqual(parseTelegramChannels({ SENTRA_MI8_TELEGRAM_CHANNELS: 'Alpha, @Beta, , gamma ' }), ['Alpha', 'Beta', 'gamma']);
assert.deepEqual(parseTelegramChannels({ OSIRIS_TELEGRAM_CHANNELS: 'LegacyOne,legacyTwo' }), ['LegacyOne', 'legacyTwo']);

const configuredSecret = 'super-secret-provider-health-test-value';
const configuredHealth = buildProviderHealth({
  GEMINI_API_KEY_1: configuredSecret,
  GEMINI_API_KEY_2: 'second-secret-value',
  AIS_API_KEY: configuredSecret,
  SCANNER_URL: 'http://scanner:7700',
  SCANNER_KEY: configuredSecret,
  SDK_INGEST_KEY: configuredSecret,
  GITHUB_WEBHOOK_SECRET: configuredSecret,
  GITHUB_WEBHOOK_FORWARD_URL: 'http://127.0.0.1:3005/github/webhook',
  UMAMI_ENDPOINT: 'http://umami:3000/api/send',
  UMAMI_WEBSITE_ID: configuredSecret,
  IPTV_ORG_BASE_URL: 'https://iptv-org.github.io',
  OPENSKY_CLIENT_ID: configuredSecret,
  OPENSKY_CLIENT_SECRET: configuredSecret,
  WINDY_API_KEY: configuredSecret,
  SENTRA_MI8_INTEL_URL: 'http://sentra-mi8-intel:4000',
  SENTRA_MI8_TELEGRAM_CHANNELS: 'OSINTtechnical,Faytuks',
});

const configuredById = new Map(configuredHealth.providers.map((provider) => [provider.id, provider]));
for (const id of ['gemini', 'aisstream', 'scanner', 'sdk-ingest', 'github-webhook', 'umami', 'iptv-org', 'opensky', 'windy-webcams', 'intel-service', 'telegram-osint']) {
  assert.equal(configuredById.get(id)?.state, 'configured', `${id} should be configured`);
}
assert.equal(configuredById.get('gemini')?.message.includes('2'), true);
assert.equal(configuredHealth.summary.configured >= 8, true);

const serialized = JSON.stringify(configuredHealth);
for (const forbidden of [
  configuredSecret,
  'second-secret-value',
  '127.0.0.1:3005',
  'scanner:7700',
  'sentra-mi8-intel:4000',
  'umami:3000',
]) {
  assert.equal(serialized.includes(forbidden), false, `provider health leaked ${forbidden}`);
}

const sdkIngestSource = readFileSync(resolve(root, 'src/app/api/sdk/ingest/route.ts'), 'utf8');
assert.equal(sdkIngestSource.includes('polybolos-dev-key'), false);
assert.equal(sdkIngestSource.includes('lattice-integration-key'), false);
assert.match(sdkIngestSource, /process\.env\.SDK_INGEST_KEY/);

const githubWebhookSource = readFileSync(resolve(root, 'src/app/api/github-webhook/route.ts'), 'utf8');
assert.equal(githubWebhookSource.includes('100.68.100.15'), false);
assert.match(githubWebhookSource, /process\.env\.GITHUB_WEBHOOK_FORWARD_URL/);

const middlewareSource = readFileSync(resolve(root, 'src/middleware.ts'), 'utf8');
assert.equal(middlewareSource.includes('umami-umami-1'), false);
assert.equal(middlewareSource.includes('cd8f216c-fc3f-45f5-ba1a-e10309a61d18'), false);
assert.match(middlewareSource, /process\.env\.UMAMI_ENDPOINT/);
assert.match(middlewareSource, /process\.env\.UMAMI_WEBSITE_ID/);

const sdkIngesterSource = readFileSync(resolve(root, 'scripts/sdk_ingester.js'), 'utf8');
assert.equal(sdkIngesterSource.includes('SENTRA_MI8-dev-key'), false);
assert.match(sdkIngesterSource, /process\.env\.SDK_INGEST_KEY/);

console.log('Provider health tests passed.');
