import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { generateKeyPairSync, sign as edSign } from 'node:crypto';
import ts from 'typescript';

const root = process.cwd();
const buildDir = mkdtempSync(join(tmpdir(), 'sentra-sign-'));
const evDir = mkdtempSync(join(tmpdir(), 'sentra-evidence-sign-'));

// Mint an Ed25519 signing key and point the store at it BEFORE importing.
const { privateKey } = generateKeyPairSync('ed25519');
const keyPath = join(buildDir, 'signing.pem');
writeFileSync(keyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
process.env.SENTRA_EVIDENCE_DIR = evDir;
process.env.SENTRA_EVIDENCE_SIGNING_KEY = keyPath;

const src = readFileSync(resolve(root, 'src/lib/dr-media/evidence.ts'), 'utf8');
const { outputText } = ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  fileName: 'evidence.ts',
});
writeFileSync(join(buildDir, 'evidence.mjs'), outputText, 'utf8');
const mod = await import(pathToFileURL(join(buildDir, 'evidence.mjs')).href);
const { appendEvidence, readLedger, verifyChain, buildDossier, loadSigningKey, anchorHead, computeChainHead } = mod;

// ── Signed append ──
const r1 = appendEvidence({ kind: 'news-article', requested_url: 'https://x/a', source_url: 'https://x/a', http_status: 200, body: Buffer.from('<html>ONE</html>'), title: 'One', now: '2026-09-05T10:00:00.000Z' });
const r2 = appendEvidence({ kind: 'news-article', requested_url: 'https://x/b', source_url: 'https://x/b', http_status: 200, body: Buffer.from('<html>TWO</html>'), now: '2026-09-05T10:01:00.000Z' });
assert.ok(r1.signature, 'record carries a signature');
assert.ok(r1.key_id, 'record carries a key_id');
assert.equal(r2.prev_record_sha256, r1.record_sha256, 'chain links seq2 -> seq1');

// meta.json written with the public key so verifiers can find it
assert.ok(existsSync(join(evDir, 'meta.json')), 'meta.json written');
const meta = JSON.parse(readFileSync(join(evDir, 'meta.json'), 'utf8'));
assert.equal(meta.algo, 'ed25519');
assert.ok(meta.public_key.includes('BEGIN PUBLIC KEY'), 'meta carries the public key PEM');
assert.equal(meta.key_id, r1.key_id, 'meta key_id matches record key_id');

// ── verifyChain: signatures present and valid ──
const recs = readLedger();
let v = verifyChain(recs);
assert.equal(v.ok, true, 'signed chain verifies');
assert.equal(v.signatures.signed, 2);
assert.equal(v.signatures.valid, 2);
assert.equal(v.signatures.verifiable, true);
assert.equal(v.signatures.keyId, r1.key_id);

// ── Tamper: edit content (record hash mismatch) ──
let t = recs.map((r) => ({ ...r }));
t[0] = { ...t[0], content_sha256: 'deadbeef'.repeat(8) };
v = verifyChain(t);
assert.equal(v.ok, false); assert.match(v.reason, /record hash mismatch/);

// ── Tamper: edit key_id WITHOUT recomputing — proves key_id is inside the hashed base ──
t = recs.map((r) => ({ ...r }));
t[0] = { ...t[0], key_id: 'ffffffffffffffff' };
v = verifyChain(t);
assert.equal(v.ok, false, 'editing key_id breaks the record hash');
assert.match(v.reason, /record hash mismatch/);

// ── Tamper: swap in a signature from a DIFFERENT key → signature invalid ──
const other = generateKeyPairSync('ed25519');
t = recs.map((r) => ({ ...r }));
t[1] = { ...t[1], signature: edSign(null, Buffer.from(t[1].record_sha256, 'hex'), other.privateKey).toString('base64') };
v = verifyChain(t);
assert.equal(v.ok, false, 'a signature from the wrong key is rejected');
assert.match(v.reason, /signature invalid/);

// ── Dossier: two claims (chain + signatures), NO anchor claim ──
const dossier = buildDossier(recs);
assert.match(dossier, /Chain integrity: VERIFIED/);
assert.match(dossier, new RegExp(`Signatures: 2/2 valid — Ed25519 key ${r1.key_id}`));
assert.doesNotMatch(dossier, /anchored/i, 'dossier must not claim external anchoring yet');

// ── Wrong-curve key rejected with a clear error ──
const ecKeyPath = join(buildDir, 'ec.pem');
const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' });
writeFileSync(ecKeyPath, ec.privateKey.export({ type: 'pkcs8', format: 'pem' }));
assert.throws(() => loadSigningKey({ SENTRA_EVIDENCE_SIGNING_KEY: ecKeyPath }), /Ed25519/);

// ── Anchor hook: computes head + calls the injected submitter; persists nothing ──
const head = computeChainHead(recs);
assert.equal(head.head_record_sha256, r2.record_sha256, 'head is the last record hash');
let submittedHash = null;
const fakeSubmit = async (h) => { submittedHash = h; return { authority: 'fake', proof: 'PROOF', anchored_at: '2026-09-05T10:05:00.000Z' }; };
const anchored = await anchorHead(fakeSubmit, recs);
assert.equal(submittedHash, r2.record_sha256, 'submitter received the head hash');
assert.equal(anchored.receipt.authority, 'fake');
assert.equal(existsSync(join(evDir, 'anchors.jsonl')), false, 'anchor hook persists nothing yet');

console.log('DR evidence signing tests passed.');
