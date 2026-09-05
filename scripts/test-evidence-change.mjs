import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

// Transpile evidence.ts to a self-contained ESM module (node builtins only) and
// drive its pure change-detection helpers exactly the way the capture + history
// routes do: snapshot the ledger BEFORE appending, then summarize against it.
const root = process.cwd();
const buildDir = mkdtempSync(join(tmpdir(), 'sentra-change-'));

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

const store = mkdtempSync(join(tmpdir(), 'sentra-store-change-'));
process.env.SENTRA_EVIDENCE_DIR = store;
delete process.env.SENTRA_EVIDENCE_SIGNING_KEY;
const { appendEvidence, readLedger, captureHistoryForUrl, summarizeChange } = await import(evidenceUrl);

// Mirror the capture route: read the ledger first, append, then summarize the new
// record against what existed before it — never against itself.
function captureWithChange(url, bodyStr, now) {
  const prior = readLedger();
  const rec = appendEvidence({
    kind: 'news-article', requested_url: url, source_url: url,
    http_status: 200, body: Buffer.from(bodyStr), now,
  });
  return { rec, change: summarizeChange(url, rec.content_sha256, prior) };
}

const A = 'https://n.com.do/article-a';
const B = 'https://n.com.do/article-b';

// ── #1: first capture of A. changed must be null (nothing was compared), NOT false.
const c1 = captureWithChange(A, '<html>A v1</html>', '2026-09-05T10:00:00.000Z');
assert.equal(c1.change.first_capture, true);
assert.equal(c1.change.changed, null, 'first capture: changed must be null, never false');
assert.equal(c1.change.capture_count, 1);
assert.equal(c1.change.prior, undefined, 'first capture has no prior');

// ── Interleave a first capture of a DIFFERENT url, to expose any cross-url bleed.
const cb = captureWithChange(B, '<html>B v1</html>', '2026-09-05T10:01:00.000Z');
assert.equal(cb.change.first_capture, true, 'B is its own first capture — A must not count toward it');
assert.equal(cb.change.changed, null);
assert.equal(cb.change.capture_count, 1);

// ── #2: re-capture A with IDENTICAL bytes → unchanged, prior points at #1.
const c2 = captureWithChange(A, '<html>A v1</html>', '2026-09-05T10:02:00.000Z');
assert.equal(c2.change.first_capture, false);
assert.equal(c2.change.changed, false, 'identical re-capture is unchanged (false, not null)');
assert.equal(c2.change.capture_count, 2, 'count is A-only — the interleaved B must not inflate it');
assert.equal(c2.change.prior.seq, c1.rec.seq, 'prior points at the previous A capture');
assert.equal(c2.change.prior.content_sha256, c1.rec.content_sha256);
assert.equal(c2.rec.content_sha256, c1.rec.content_sha256, 'identical bytes dedupe to the same blob hash');

// ── #3: re-capture A with DIFFERENT bytes → changed, prior points at #2 (not #1).
const c3 = captureWithChange(A, '<html>A v2 EDITED</html>', '2026-09-05T10:03:00.000Z');
assert.equal(c3.change.first_capture, false);
assert.equal(c3.change.changed, true, 'edited re-capture is changed');
assert.equal(c3.change.capture_count, 3);
assert.equal(c3.change.prior.seq, c2.rec.seq, 'prior is the immediately preceding A capture (#2), not the first');
assert.notEqual(c3.rec.content_sha256, c2.rec.content_sha256, 'changed bytes produce a new blob hash');

// ── Timeline for A: exactly 3 entries; changed_from_prev = [false, false, true].
const histA = captureHistoryForUrl(A);
assert.equal(histA.length, 3, 'A has exactly 3 captures — B did not bleed in');
assert.deepEqual(histA.map((e) => e.changed_from_prev), [false, false, true]);
assert.deepEqual(histA.map((e) => e.seq), [c1.rec.seq, c2.rec.seq, c3.rec.seq]);

// ── Timeline for B: exactly 1 entry; A's three captures do not bleed across.
const histB = captureHistoryForUrl(B);
assert.equal(histB.length, 1, 'B has exactly 1 capture — the filter is per-url');
assert.equal(histB[0].seq, cb.rec.seq);
assert.equal(histB[0].changed_from_prev, false, 'a lone capture is not "changed"');

// ── Non-match (the history endpoint's key case): empty timeline, never the whole
//    ledger. A filter that fell through to "return everything" on a miss dies here.
const histNone = captureHistoryForUrl('https://example.org/never-captured');
assert.equal(histNone.length, 0, 'unknown url returns an EMPTY timeline, not the full ledger');
const ledgerLen = readLedger().length;
assert.equal(ledgerLen, 4, 'sanity: the store actually holds 4 records (3×A + 1×B)');
assert.notEqual(histNone.length, ledgerLen, 'a non-match must not leak the ledger');

const sNone = summarizeChange('https://example.org/never-captured', 'deadbeef'.repeat(8), readLedger());
assert.equal(sNone.first_capture, true, 'summarizing an unseen url is a first capture');
assert.equal(sNone.changed, null);

console.log('DR evidence change-detection tests passed.');
