/**
 * The standalone verifier + README shipped inside every evidence bundle.
 *
 * Kept as string constants (not a runtime file read) so the export route embeds
 * the EXACT source the test exercises — tested == shipped — and so nothing has to
 * be traced into the Next standalone output at runtime. The verifier is
 * dependency-free: it uses only node:crypto and node:fs, so a recipient with plain
 * Node (18+) can re-check the bundle without installing anything.
 *
 * It re-implements verifyChain's contract exactly, PLUS a check verifyChain never
 * did: that each blob's bytes still hash to its filename.
 */

// NOTE: String.raw so backslashes (the /\r?\n/ regex) survive verbatim. The
// verifier body therefore must contain no backticks and no ${…} interpolation.
export const EVIDENCE_VERIFIER_MJS = String.raw`#!/usr/bin/env node
// Sentra Mi8 evidence-bundle verifier. Run from inside the bundle folder:
//   node verify.mjs
// Exit 0 + "VERIFIED" = every check passed. Non-zero + "BROKEN: <reason>" = the
// first failure found. Dependency-free (node:crypto + node:fs only).
import { createHash, createPublicKey, verify as edVerify } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';

const GENESIS = '0'.repeat(64);
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const fail = (msg) => { console.error('BROKEN: ' + msg); process.exit(1); };

if (!existsSync('./ledger.jsonl')) fail('ledger.jsonl not found — run this from inside the bundle folder');
const lines = readFileSync('./ledger.jsonl', 'utf8').split(/\r?\n/).filter(Boolean);

let pubKey = null;
let keyLabel = 'none';
if (existsSync('./meta.json')) {
  try {
    const meta = JSON.parse(readFileSync('./meta.json', 'utf8'));
    if (meta.public_key) { pubKey = createPublicKey(meta.public_key); keyLabel = meta.key_id || 'present'; }
  } catch (e) { fail('meta.json is unreadable: ' + (e && e.message)); }
}

let prev = GENESIS;
let signed = 0;
for (let i = 0; i < lines.length; i++) {
  let rec;
  try { rec = JSON.parse(lines[i]); } catch (e) { fail('record ' + (i + 1) + ' is not valid JSON'); }
  if (rec.prev_record_sha256 !== prev) fail('chain link mismatch at seq ' + rec.seq);

  const recordHash = rec.record_sha256;
  const signature = rec.signature;
  // Canonical base: the record minus record_sha256 and signature, keys in file
  // order (JSON already omitted absent optional fields when this was written).
  const base = Object.assign({}, rec);
  delete base.record_sha256;
  delete base.signature;
  if (sha256(JSON.stringify(base)) !== recordHash) fail('record hash mismatch (edited) at seq ' + rec.seq);

  if (signature) {
    if (!pubKey) fail('record at seq ' + rec.seq + ' is signed but no public key (meta.json) is present');
    const ok = edVerify(null, Buffer.from(recordHash, 'hex'), pubKey, Buffer.from(signature, 'base64'));
    if (!ok) fail('signature invalid at seq ' + rec.seq);
    signed++;
  }

  const blobPath = './blobs/' + rec.content_sha256;
  if (!existsSync(blobPath)) fail('missing blob for seq ' + rec.seq + ' (' + rec.content_sha256 + ')');
  if (sha256(readFileSync(blobPath)) !== rec.content_sha256) fail('blob bytes do not match their hash at seq ' + rec.seq);

  prev = recordHash;
}

console.log('VERIFIED');
console.log('  records: ' + lines.length);
console.log('  chain:   unbroken from genesis');
console.log('  blobs:   ' + lines.length + ' present and hash-matched');
if (pubKey) console.log('  signatures: ' + signed + '/' + lines.length + ' valid (Ed25519 key ' + keyLabel + ')');
else console.log('  signatures: none (UNSIGNED bundle — chain + blobs verified, but authorship is not attested)');
process.exit(0);
`;

/** Bundle README, stating what VERIFIED proves and the exact hash contract. */
export function buildBundleReadme(opts: { records: number; signed: boolean; keyId?: string }): string {
  return [
    '# Sentra Mi8 — Evidence Bundle',
    '',
    'A self-contained, independently verifiable snapshot of captured source material.',
    '',
    '## Contents',
    '- `ledger.jsonl` — append-only, hash-chained index (one JSON record per line).',
    '- `blobs/<sha256>` — the exact captured bytes; each filename IS the SHA-256 of its contents.',
    '- `dossier.md` — human-readable summary.',
    opts.signed
      ? '- `meta.json` — the Ed25519 public key and its fingerprint (key_id `' + (opts.keyId || '') + '`).'
      : '- _(no `meta.json` — this bundle is **UNSIGNED**)_',
    '- `verify.mjs` — dependency-free verifier (plain Node 18+, only `node:crypto` + `node:fs`).',
    '',
    '## Verify it yourself',
    '```',
    'cd sentra-evidence-bundle',
    'node verify.mjs',
    '```',
    'Exit `0` and `VERIFIED` means every check passed; a non-zero exit and `BROKEN: …` names the first failure.',
    '',
    '## What `VERIFIED` proves',
    '1. **Chain integrity** — each record links to the previous record’s hash; nothing was edited, inserted, or removed.',
    '2. **Blob integrity** — every captured file’s bytes still hash to its filename.',
    opts.signed
      ? '3. **Authorship** — every record is signed by the Ed25519 key in `meta.json`; edited records cannot be re-signed without that private key.'
      : '3. _Authorship is **not** proven — this bundle is unsigned. Chain + blob integrity still hold, but nothing binds these records to a signer._',
    '',
    '## What it does NOT prove',
    'Independent existence-in-time. Capture timestamps are asserted by the capturing system, not a third party. External anchoring (RFC-3161 / OpenTimestamps) would add that and is a planned step.',
    '',
    '## Canonical serialization (for re-implementers)',
    'A record’s `record_sha256` is the SHA-256 of the record’s JSON with the `record_sha256` and `signature` fields removed, keys kept in their original line order (absent optional fields are simply not present). `signature` is Ed25519 over the raw 32-byte `record_sha256` digest.',
    '',
    'Records: ' + opts.records + '. This bundle was assembled in memory; for very large stores expect proportional memory use during export.',
    '',
  ].join('\n');
}
