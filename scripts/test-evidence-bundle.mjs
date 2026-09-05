import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, cpSync, existsSync, appendFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { generateKeyPairSync, sign as edSign } from 'node:crypto';
import ts from 'typescript';

const root = process.cwd();
const buildDir = mkdtempSync(join(tmpdir(), 'sentra-bundle-'));

function transpile(rel, out) {
  const src = readFileSync(resolve(root, rel), 'utf8');
  const { outputText } = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
    fileName: rel.split('/').pop(),
  });
  const p = join(buildDir, out);
  writeFileSync(p, outputText, 'utf8');
  return pathToFileURL(p).href;
}

const evidenceUrl = transpile('src/lib/dr-media/evidence.ts', 'evidence.mjs');
const verifierUrl = transpile('src/lib/dr-media/evidence-verifier.ts', 'evidence-verifier.mjs');
const { EVIDENCE_VERIFIER_MJS } = await import(verifierUrl);

// ── Signed store: mint a key, capture 3 records ──
const { privateKey } = generateKeyPairSync('ed25519');
const keyPath = join(buildDir, 'signing.pem');
writeFileSync(keyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
const signedStore = mkdtempSync(join(tmpdir(), 'sentra-store-signed-'));
process.env.SENTRA_EVIDENCE_DIR = signedStore;
process.env.SENTRA_EVIDENCE_SIGNING_KEY = keyPath;
const signedMod = await import(evidenceUrl + '?v=signed');
for (let i = 0; i < 3; i++) {
  signedMod.appendEvidence({ kind: 'news-article', requested_url: 'https://x/' + i, source_url: 'https://x/' + i, http_status: 200, body: Buffer.from('<html>ART ' + i + '</html>'), title: 'Article ' + i, now: '2026-09-05T1' + i + ':00:00.000Z' });
}

// Assemble a bundle the way the export route does (ledger + blobs + meta + verify.mjs).
function buildBundle(store, bundle, { meta = true } = {}) {
  mkdirSync(bundle, { recursive: true });
  cpSync(join(store, 'ledger.jsonl'), join(bundle, 'ledger.jsonl'));
  cpSync(join(store, 'blobs'), join(bundle, 'blobs'), { recursive: true });
  if (meta && existsSync(join(store, 'meta.json'))) cpSync(join(store, 'meta.json'), join(bundle, 'meta.json'));
  writeFileSync(join(bundle, 'verify.mjs'), EVIDENCE_VERIFIER_MJS);
  return bundle;
}
const run = (dir) => spawnSync(process.execPath, ['verify.mjs'], { cwd: dir, encoding: 'utf8' });
const fresh = (name) => mkdtempSync(join(tmpdir(), 'sentra-bundle-' + name + '-'));

// ── Happy path: the shipped verifier VERIFIES a good signed bundle ──
const good = buildBundle(signedStore, fresh('good'));
let r = run(good);
assert.equal(r.status, 0, 'good bundle verifies (exit 0)\n' + r.stdout + r.stderr);
assert.match(r.stdout, /VERIFIED/);
assert.match(r.stdout, /signatures: 3\/3 valid/);

// ── Negative 1: an edited record field (hash mismatch) ──
let d = buildBundle(signedStore, fresh('edit'));
{
  const lines = readFileSync(join(d, 'ledger.jsonl'), 'utf8').split(/\r?\n/).filter(Boolean);
  const rec = JSON.parse(lines[0]); rec.http_status = 500;              // change WITHOUT rehashing
  lines[0] = JSON.stringify(rec);
  writeFileSync(join(d, 'ledger.jsonl'), lines.join('\n') + '\n');
}
r = run(d);
assert.notEqual(r.status, 0, 'edited record must fail');
assert.match(r.stderr, /record hash mismatch/);

// ── Negative 2: a deleted middle record (chain-link break) ──
d = buildBundle(signedStore, fresh('delete'));
{
  const lines = readFileSync(join(d, 'ledger.jsonl'), 'utf8').split(/\r?\n/).filter(Boolean);
  lines.splice(1, 1);
  writeFileSync(join(d, 'ledger.jsonl'), lines.join('\n') + '\n');
}
r = run(d);
assert.notEqual(r.status, 0, 'deleted record must fail');
assert.match(r.stderr, /chain link mismatch/);

// ── Negative 3: a signature replaced with one from a different key ──
d = buildBundle(signedStore, fresh('sig'));
{
  const other = generateKeyPairSync('ed25519');
  const lines = readFileSync(join(d, 'ledger.jsonl'), 'utf8').split(/\r?\n/).filter(Boolean);
  const rec = JSON.parse(lines[1]);
  rec.signature = edSign(null, Buffer.from(rec.record_sha256, 'hex'), other.privateKey).toString('base64');
  lines[1] = JSON.stringify(rec);
  writeFileSync(join(d, 'ledger.jsonl'), lines.join('\n') + '\n');
}
r = run(d);
assert.notEqual(r.status, 0, 'wrong-key signature must fail');
assert.match(r.stderr, /signature invalid/);

// ── Negative 4: an altered blob (bytes no longer hash to filename) — NEW surface ──
d = buildBundle(signedStore, fresh('blob'));
{
  const firstRec = JSON.parse(readFileSync(join(d, 'ledger.jsonl'), 'utf8').split(/\r?\n/).filter(Boolean)[0]);
  appendFileSync(join(d, 'blobs', firstRec.content_sha256), Buffer.from('!tampered'));
}
r = run(d);
assert.notEqual(r.status, 0, 'altered blob must fail');
assert.match(r.stderr, /blob bytes do not match/);

// ── Unsigned store: no meta.json → verifier reports UNSIGNED, still exit 0 ──
const unsignedStore = mkdtempSync(join(tmpdir(), 'sentra-store-unsigned-'));
process.env.SENTRA_EVIDENCE_DIR = unsignedStore;
delete process.env.SENTRA_EVIDENCE_SIGNING_KEY;
const unsignedMod = await import(evidenceUrl + '?v=unsigned'); // fresh module re-reads env
for (let i = 0; i < 2; i++) {
  unsignedMod.appendEvidence({ kind: 'x', requested_url: 'https://u/' + i, source_url: 'https://u/' + i, http_status: 200, body: Buffer.from('u' + i), now: '2026-09-05T0' + i + ':00:00.000Z' });
}
assert.equal(existsSync(join(unsignedStore, 'meta.json')), false, 'unsigned store writes no meta.json');
const u = buildBundle(unsignedStore, fresh('unsigned'), { meta: false });
r = run(u);
assert.equal(r.status, 0, 'unsigned bundle verifies (exit 0)\n' + r.stdout + r.stderr);
assert.match(r.stdout, /VERIFIED/);
assert.match(r.stdout, /UNSIGNED/);

console.log('DR evidence bundle tests passed.');
