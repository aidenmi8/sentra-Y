import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync, statSync, appendFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const root = process.cwd();
const buildDir = mkdtempSync(join(tmpdir(), 'sentra-ev-'));
const evDir = mkdtempSync(join(tmpdir(), 'sentra-evidence-'));
// The module reads SENTRA_EVIDENCE_DIR at import time — set it BEFORE importing.
process.env.SENTRA_EVIDENCE_DIR = evDir;

const src = readFileSync(resolve(root, 'src/lib/dr-media/evidence.ts'), 'utf8');
const { outputText } = ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  fileName: 'evidence.ts',
});
writeFileSync(join(buildDir, 'evidence.mjs'), outputText, 'utf8');
const mod = await import(pathToFileURL(join(buildDir, 'evidence.mjs')).href);
const { appendEvidence, readLedger, verifyChain, buildDossier, EVIDENCE_DIR } = mod;

assert.equal(EVIDENCE_DIR, evDir, 'module honored SENTRA_EVIDENCE_DIR');

// ── Append + content-addressed blobs ──
const r1 = appendEvidence({ kind: 'news-article', requested_url: 'https://x/a', source_url: 'https://x/a', http_status: 200, content_type: 'text/html', body: Buffer.from('<html>ONE</html>'), title: 'One', now: '2026-08-22T10:00:00.000Z' });
const r2 = appendEvidence({ kind: 'news-article', requested_url: 'https://x/b', source_url: 'https://x/b', http_status: 200, body: Buffer.from('<html>TWO</html>'), now: '2026-08-22T10:01:00.000Z' });
assert.equal(r1.seq, 1);
assert.equal(r2.seq, 2);
assert.equal(r2.prev_record_sha256, r1.record_sha256, 'chain links seq2 -> seq1');
assert.equal(r1.captured_at, '2026-08-22T10:00:00.000Z', 'captured_at is the attested clock');

// blob filename IS the content hash, and the bytes match
const blob1 = join(evDir, 'blobs', r1.content_sha256);
assert.ok(existsSync(blob1), 'blob written at content hash path');
assert.equal(readFileSync(blob1, 'utf8'), '<html>ONE</html>', 'blob content matches');
// 0o600 perms on both ledger and blob
assert.equal(statSync(join(evDir, 'ledger.jsonl')).mode & 0o777, 0o600, 'ledger is 0600');
assert.equal(statSync(blob1).mode & 0o777, 0o600, 'blob is 0600');

// identical bytes dedupe to the same blob
const r3 = appendEvidence({ kind: 'x', requested_url: 'https://x/a2', source_url: 'https://x/a2', http_status: 200, body: Buffer.from('<html>ONE</html>'), now: '2026-08-22T10:02:00.000Z' });
assert.equal(r3.content_sha256, r1.content_sha256, 'same bytes -> same content hash');

// ── Chain verification: intact ──
let recs = readLedger();
assert.equal(recs.length, 3);
let v = verifyChain(recs);
assert.equal(v.ok, true, 'intact chain verifies');
assert.equal(v.count, 3);

// ── Durability: a tight fsync'd append loop must not disturb the chain ──
// (guards the openSync/writeSync/fsyncSync append path against link regressions)
let prevRec = readLedger().slice(-1)[0];
for (let i = 0; i < 25; i++) {
  const rec = appendEvidence({ kind: 'loop', requested_url: `https://x/loop${i}`, source_url: `https://x/loop${i}`, http_status: 200, body: Buffer.from(`payload-${i}`), now: '2026-08-22T11:00:00.000Z' });
  assert.equal(rec.prev_record_sha256, prevRec.record_sha256, `loop append ${i} chains onto the prior record`);
  prevRec = rec;
}
assert.equal(verifyChain(readLedger()).ok, true, 'chain stays intact after a tight append loop');

// ── Tamper detection: edit a record's content hash in place ──
const tampered = recs.map((r) => ({ ...r }));
tampered[1] = { ...tampered[1], content_sha256: 'deadbeef'.repeat(8) };
v = verifyChain(tampered);
assert.equal(v.ok, false, 'edited record breaks its own hash');
assert.equal(v.brokenAt, 2);
assert.match(v.reason, /record hash mismatch/);

// ── Tamper detection: delete a middle record (chain link breaks) ──
v = verifyChain([recs[0], recs[2]]);
assert.equal(v.ok, false, 'deleting a record breaks the chain link');
assert.equal(v.brokenAt, recs[2].seq);
assert.match(v.reason, /chain link mismatch/);

// ── Tamper detection on the actual file: append a forged line ──
appendFileSync(join(evDir, 'ledger.jsonl'), JSON.stringify({ ...recs[2], seq: 4, title: 'FORGED', prev_record_sha256: 'nope' }) + '\n');
v = verifyChain(readLedger());
assert.equal(v.ok, false, 'forged appended line is detected');

// ── Dossier ──
const dossier = buildDossier(recs);
assert.match(dossier, /Evidence Dossier/);
assert.match(dossier, /Chain integrity: VERIFIED/);
assert.match(dossier, /blobs\//);

// ── SSRF guard: the capture route must reject internal targets ──
// (unit-check the guard the route uses, with hostile fixtures)
const sg = readFileSync(resolve(root, 'src/lib/ssrf-guard.ts'), 'utf8');
const sgOut = ts.transpileModule(sg, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 }, fileName: 'ssrf.ts' }).outputText;
writeFileSync(join(buildDir, 'ssrf.mjs'), sgOut, 'utf8');
const { safeFetch, validateHost } = await import(pathToFileURL(join(buildDir, 'ssrf.mjs')).href);
for (const host of ['127.0.0.1', 'localhost', '169.254.169.254', '10.0.0.1', '192.168.1.1', 'host.docker.internal']) {
  const check = await validateHost(host);
  assert.equal(check.ok, false, `SSRF guard must reject ${host}`);
}
// safeFetch throws on a blocked target (never fetches it)
await assert.rejects(() => safeFetch('http://169.254.169.254/latest/meta-data/', { signal: AbortSignal.timeout(5000) }), /blocked/i);
await assert.rejects(() => safeFetch('file:///etc/passwd'), /protocol|invalid/i);

// ── Route contracts ──
const capSrc = readFileSync(resolve(root, 'src/app/api/dr/evidence/capture/route.ts'), 'utf8');
assert.match(capSrc, /safeFetch/, 'capture must use the SSRF-safe fetch');
assert.match(capSrc, /guardEvidenceRequest\(request, \{ requireWriteHeader: true \}\)/, 'capture requires the write header');
const expSrc = readFileSync(resolve(root, 'src/app/api/dr/evidence/export/route.ts'), 'utf8');
assert.match(expSrc, /guardEvidenceRequest/, 'export is guarded');

rmSync(buildDir, { recursive: true, force: true });
rmSync(evDir, { recursive: true, force: true });
console.log('DR evidence tests passed.');
