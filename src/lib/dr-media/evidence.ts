import {
  createHash, createPrivateKey, createPublicKey,
  sign as edSign, verify as edVerify, type KeyObject,
} from 'node:crypto';
import {
  mkdirSync, writeFileSync, renameSync, existsSync, unlinkSync,
  readFileSync, openSync, writeSync, fsyncSync, closeSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Sentra Mi8 — tamper-evident evidence store (local-first).
 *
 * An append-only, hash-chained JSONL ledger plus a content-addressed blob store.
 * Deliberately NOT SQLite: a native module risks Next's standalone Docker build,
 * whereas JSONL is dependency-free, greppable, and the chain gives tamper-evidence
 * for free. Each ledger line references the previous line's record hash, so any
 * later edit or deletion breaks the chain and is detectable.
 *
 * All of this is local-only: it lives under SENTRA_EVIDENCE_DIR, is written 0o600,
 * and is never transmitted anywhere. A journalist's captures are source material.
 */

export const EVIDENCE_DIR = process.env.SENTRA_EVIDENCE_DIR || join(process.cwd(), 'evidence');
const LEDGER_PATH = join(EVIDENCE_DIR, 'ledger.jsonl');
const BLOBS_DIR = join(EVIDENCE_DIR, 'blobs');
const META_PATH = join(EVIDENCE_DIR, 'meta.json'); // { algo, key_id, public_key, created_at }
const GENESIS = '0'.repeat(64);

export interface EvidenceRecord {
  seq: number;
  captured_at: string;         // the ONLY clock we attest to (UTC)
  kind: string;                // 'news-article' | ...
  source_url: string;          // the URL actually fetched (post-redirect)
  requested_url: string;       // what the caller asked for
  title?: string;
  content_type?: string;
  content_sha256: string;      // hash of the captured bytes == blob filename
  content_bytes: number;
  http_status: number;
  metadata?: Record<string, unknown>;
  prev_record_sha256: string;  // chain link
  key_id?: string;             // fingerprint of the signing key (inside the hashed base)
  record_sha256: string;       // hash of this record (excludes record_sha256 + signature)
  signature?: string;          // base64 Ed25519 over the raw record_sha256 digest
}

function sha256(buf: Buffer | string): string {
  return createHash('sha256').update(buf).digest('hex');
}

/* ── Signing (opt-in Ed25519) ─────────────────────────────────────────────
 * A pure hash chain proves internal consistency but nothing stops someone with
 * write access to ledger.jsonl from editing a record and recomputing every
 * downstream hash into a "clean" chain. An Ed25519 signature over each record's
 * digest closes that: a tamperer without the private key cannot re-sign, so an
 * edit is detected even when the hashes are recomputed. Signing is OFF unless an
 * operator points SENTRA_EVIDENCE_SIGNING_KEY at an Ed25519 private-key PEM held
 * off-box (see scripts/gen-evidence-key.mjs); with no key, records are unsigned
 * and the store behaves exactly as before. The key_id lives INSIDE the hashed
 * base, so an attacker cannot swap in their own key without breaking the hash.
 * ─────────────────────────────────────────────────────────────────────────── */

export interface SigningKey {
  privateKey: KeyObject;
  publicKey: KeyObject;
  publicKeyPem: string;
  keyId: string;
}

function computeKeyId(publicKey: KeyObject): string {
  const der = publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
  return sha256(der).slice(0, 16);
}

/** Loads the configured Ed25519 signing key, or null when signing is disabled. */
export function loadSigningKey(env: NodeJS.ProcessEnv = process.env): SigningKey | null {
  const path = env.SENTRA_EVIDENCE_SIGNING_KEY?.trim();
  if (!path) return null;
  const pem = readFileSync(path, 'utf8');
  const privateKey = createPrivateKey(pem);
  if (privateKey.asymmetricKeyType !== 'ed25519') {
    throw new Error(
      `SENTRA_EVIDENCE_SIGNING_KEY must be an Ed25519 private key, got ${privateKey.asymmetricKeyType}`,
    );
  }
  const publicKey = createPublicKey(privateKey);
  return {
    privateKey,
    publicKey,
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }) as string,
    keyId: computeKeyId(publicKey),
  };
}

let signingKeyCache: SigningKey | null | undefined;
function getSigningKey(): SigningKey | null {
  if (signingKeyCache === undefined) signingKeyCache = loadSigningKey(process.env);
  return signingKeyCache;
}
/** Tests set env then re-load; production loads once per process. */
export function resetSigningKeyCache(): void { signingKeyCache = undefined; }

function signDigest(recordSha256Hex: string, privateKey: KeyObject): string {
  return edSign(null, Buffer.from(recordSha256Hex, 'hex'), privateKey).toString('base64');
}

function verifyDigestSignature(recordSha256Hex: string, sigB64: string, publicKey: KeyObject): boolean {
  try {
    return edVerify(null, Buffer.from(recordSha256Hex, 'hex'), publicKey, Buffer.from(sigB64, 'base64'));
  } catch {
    return false;
  }
}

/** Writes meta.json (public key + fingerprint) once, so verifiers can find the key. */
function writeMetaIfNeeded(key: SigningKey): void {
  if (existsSync(META_PATH)) return;
  const meta = JSON.stringify({
    algo: 'ed25519',
    key_id: key.keyId,
    public_key: key.publicKeyPem,
    created_at: new Date().toISOString(),
  }, null, 2);
  const tmp = `${META_PATH}.tmp`;
  writeFileSync(tmp, meta, { mode: 0o600 });
  renameSync(tmp, META_PATH);
  fsyncDir(EVIDENCE_DIR);
}

/**
 * Resolves the public key a verifier should check signatures against:
 * an explicit SENTRA_EVIDENCE_PUBLIC_KEY PEM path, else the store's meta.json,
 * else the configured signing key's own public half, else null (unverifiable).
 */
export function loadVerificationKey(env: NodeJS.ProcessEnv = process.env): KeyObject | null {
  const explicit = env.SENTRA_EVIDENCE_PUBLIC_KEY?.trim();
  if (explicit) {
    try { return createPublicKey(readFileSync(explicit, 'utf8')); } catch { /* fall through */ }
  }
  if (existsSync(META_PATH)) {
    try {
      const meta = JSON.parse(readFileSync(META_PATH, 'utf8')) as { public_key?: string };
      if (meta.public_key) return createPublicKey(meta.public_key);
    } catch { /* fall through */ }
  }
  return loadSigningKey(env)?.publicKey ?? null;
}

function ensureDirs(): void {
  mkdirSync(BLOBS_DIR, { recursive: true });
}

/** Best-effort fsync of a directory so a create/rename is itself durable. */
function fsyncDir(dir: string): void {
  let fd: number | null = null;
  try {
    fd = openSync(dir, 'r');
    fsyncSync(fd);
  } catch {
    /* directory fsync is unsupported on some platforms — best effort only */
  } finally {
    if (fd !== null) { try { closeSync(fd); } catch { /* ignore */ } }
  }
}

/** Reads the last ledger line's record hash to chain onto, or genesis. */
function lastRecordHash(): { hash: string; seq: number } {
  if (!existsSync(LEDGER_PATH)) return { hash: GENESIS, seq: 0 };
  const lines = readFileSync(LEDGER_PATH, 'utf8').split('\n').filter(Boolean);
  if (lines.length === 0) return { hash: GENESIS, seq: 0 };
  try {
    const last = JSON.parse(lines[lines.length - 1]) as EvidenceRecord;
    return { hash: last.record_sha256, seq: last.seq };
  } catch {
    return { hash: GENESIS, seq: lines.length };
  }
}

/** Content-addressed blob write: filename IS the content hash. Atomic, 0o600. */
function writeBlob(buf: Buffer): string {
  const hash = sha256(buf);
  const path = join(BLOBS_DIR, hash);
  if (existsSync(path)) return hash; // identical bytes already captured
  const tmp = `${path}.tmp`;
  let fd: number | null = null;
  try {
    fd = openSync(tmp, 'w', 0o600);
    writeSync(fd, buf);
    fsyncSync(fd);        // bytes are durable before we expose them under the hash name
    closeSync(fd);
    fd = null;
    renameSync(tmp, path);
    fsyncDir(BLOBS_DIR);  // and the directory entry that names them
  } catch (error) {
    if (fd !== null) { try { closeSync(fd); } catch { /* ignore */ } }
    try { if (existsSync(tmp)) unlinkSync(tmp); } catch { /* best effort */ }
    throw error;
  }
  return hash;
}

export interface CaptureInput {
  kind: string;
  requested_url: string;
  source_url: string;
  http_status: number;
  content_type?: string;
  body: Buffer;
  title?: string;
  metadata?: Record<string, unknown>;
  now?: string;
}

/**
 * Persists one captured artifact + its chained ledger record.
 *
 * INVARIANT — this function MUST stay fully synchronous end to end. Node runs it
 * to completion in one tick, so `lastRecordHash()` → append cannot interleave with
 * a concurrent capture in the same process; that synchrony IS the mutual exclusion
 * that keeps the chain from forking. Do NOT add an `await` in here. (Two server
 * processes sharing SENTRA_EVIDENCE_DIR would still need an OS advisory lock — that
 * deployment does not occur today and is tracked as a follow-up, not solved here.)
 */
export function appendEvidence(input: CaptureInput): EvidenceRecord {
  ensureDirs();
  const signer = getSigningKey();
  if (signer) writeMetaIfNeeded(signer);
  const content_sha256 = writeBlob(input.body);
  const { hash: prev, seq } = lastRecordHash();

  const base = {
    seq: seq + 1,
    captured_at: input.now || new Date().toISOString(),
    kind: input.kind,
    source_url: input.source_url,
    requested_url: input.requested_url,
    title: input.title,
    content_type: input.content_type,
    content_sha256,
    content_bytes: input.body.length,
    http_status: input.http_status,
    metadata: input.metadata,
    prev_record_sha256: prev,
    // key_id joins the hashed base only when signing, so it is covered by
    // record_sha256 and cannot be swapped for an attacker's key.
    ...(signer ? { key_id: signer.keyId } : {}),
  };
  const record_sha256 = sha256(JSON.stringify(base));
  const signature = signer ? signDigest(record_sha256, signer.privateKey) : undefined;
  const record: EvidenceRecord = { ...base, record_sha256, ...(signature ? { signature } : {}) };

  const isNew = !existsSync(LEDGER_PATH);
  if (isNew) {
    // Create empty ledger with 0o600 before appending, so perms are set once.
    const tmp = `${LEDGER_PATH}.tmp`;
    writeFileSync(tmp, '', { mode: 0o600 });
    renameSync(tmp, LEDGER_PATH);
  }
  // Append the line and fsync BEFORE returning: the receipt the caller gets must
  // be backed by bytes that survive a crash, not just sit in the page cache.
  const fd = openSync(LEDGER_PATH, 'a');
  try {
    writeSync(fd, `${JSON.stringify(record)}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  if (isNew) fsyncDir(EVIDENCE_DIR);
  return record;
}

export function readLedger(): EvidenceRecord[] {
  if (!existsSync(LEDGER_PATH)) return [];
  return readFileSync(LEDGER_PATH, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as EvidenceRecord);
}

export interface SignatureSummary {
  total: number;       // records in the chain
  signed: number;      // records carrying a signature
  valid: number;       // signatures verified against the public key
  verifiable: boolean; // a public key was available to check against
  keyId?: string;      // fingerprint of the verifying key, when known
}

export interface ChainVerification {
  ok: boolean;
  count: number;
  brokenAt: number | null;
  reason?: string;
  signatures?: SignatureSummary;
}

/**
 * Walks the chain, confirming each link and each record's own hash, and — when a
 * public key is resolvable — each present signature. A signed record whose
 * signature fails to verify is a break (ok:false). Records with no signature, or
 * a store with no available public key, verify on hashes alone (signatures then
 * unverifiable, which the summary reports honestly rather than as "valid").
 */
export function verifyChain(records: EvidenceRecord[] = readLedger()): ChainVerification {
  const vkey = loadVerificationKey(process.env);
  let prev = GENESIS;
  let signed = 0;
  let valid = 0;
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    if (r.prev_record_sha256 !== prev) {
      return { ok: false, count: records.length, brokenAt: r.seq, reason: 'chain link mismatch' };
    }
    const { record_sha256, signature, ...base } = r;
    if (sha256(JSON.stringify(base)) !== record_sha256) {
      return { ok: false, count: records.length, brokenAt: r.seq, reason: 'record hash mismatch (edited)' };
    }
    if (signature) {
      signed++;
      if (vkey) {
        if (!verifyDigestSignature(record_sha256, signature, vkey)) {
          return { ok: false, count: records.length, brokenAt: r.seq, reason: 'signature invalid' };
        }
        valid++;
      }
    }
    prev = record_sha256;
  }
  const signatures: SignatureSummary = {
    total: records.length,
    signed,
    valid,
    verifiable: !!vkey,
    keyId: vkey ? computeKeyId(vkey) : undefined,
  };
  return { ok: true, count: records.length, brokenAt: null, signatures };
}

/** Human-readable citable dossier built from the ledger. */
export function buildDossier(records: EvidenceRecord[] = readLedger()): string {
  const v = verifyChain(records);
  const s = v.signatures;
  let sigLine: string;
  if (!s || s.signed === 0) {
    sigLine = 'Signatures: none (unsigned store — integrity rests on the hash chain alone)';
  } else if (!s.verifiable) {
    sigLine = `Signatures: ${s.signed}/${s.total} present but NOT verifiable here (no public key available)`;
  } else if (v.ok && s.valid === s.signed) {
    sigLine = `Signatures: ${s.signed}/${s.total} valid — Ed25519 key ${s.keyId}`;
  } else {
    sigLine = `Signatures: INVALID (Ed25519 key ${s.keyId})`;
  }
  const lines: string[] = [
    '# Sentra Mi8 — Evidence Dossier',
    '',
    `Generated: ${new Date().toISOString()}`,
    `Records: ${records.length}`,
    `Chain integrity: ${v.ok ? 'VERIFIED — unbroken' : `BROKEN at seq ${v.brokenAt} (${v.reason})`}`,
    sigLine,
    // NOTE: no external-anchor line. A "head signed at time T" with this same key
    // is another self-attestation, not independent proof. Real external anchoring
    // (RFC-3161 / OpenTimestamps) is the next Wave-1 step; see anchorHead() below.
    '',
    '> Titles below are normalized display text (HTML entities decoded). The',
    '> attested artifact is the byte-exact snapshot at `blobs/<content_sha256>`;',
    '> cite the snapshot and hash, not the title, as source-exact.',
    '',
    '---',
    '',
  ];
  for (const r of records) {
    lines.push(`## #${r.seq} — ${r.title || r.source_url}`);
    lines.push('');
    lines.push(`- Captured (UTC): ${r.captured_at}`);
    lines.push(`- Source URL: ${r.source_url}`);
    if (r.requested_url !== r.source_url) lines.push(`- Requested URL: ${r.requested_url}`);
    lines.push(`- Kind: ${r.kind}`);
    lines.push(`- HTTP status at capture: ${r.http_status}`);
    lines.push(`- Content SHA-256: \`${r.content_sha256}\` (${r.content_bytes} bytes, ${r.content_type || 'unknown type'})`);
    lines.push(`- Snapshot file: \`blobs/${r.content_sha256}\``);
    lines.push(`- Record hash: \`${r.record_sha256}\``);
    lines.push('');
  }
  return lines.join('\n');
}

/* ── External anchoring (injection point only — NOT yet wired) ─────────────
 * True external anchoring means committing the chain head to an INDEPENDENT
 * third party (RFC-3161 timestamp authority, OpenTimestamps/Bitcoin, or a
 * transparency log) so existence-by-time-T can be proven without trusting this
 * machine or its signing key. A "head signed with our own key" would NOT be
 * that — it is one more self-attestation — so this module deliberately ships
 * only the plumbing: compute the head, and hand it to an injected submitter.
 * Nothing is persisted and no dossier line claims "anchored" until a real
 * authority is wired. Only a hash ever leaves the box (safe to disclose).
 * ─────────────────────────────────────────────────────────────────────────── */

export interface ExternalAnchorReceipt {
  authority: string;    // e.g. 'opentimestamps' | 'rfc3161:freetsa.org'
  proof: string;        // opaque, authority-specific (base64 .ots / TSA token)
  anchored_at: string;  // the authority's asserted time, when it returns one
}

export type ExternalAnchorSubmitter = (headHash: string) => Promise<ExternalAnchorReceipt>;

export interface ChainHead {
  seq: number;
  head_record_sha256: string;
}

/** Current chain head (last record's hash), or genesis for an empty store. */
export function computeChainHead(records: EvidenceRecord[] = readLedger()): ChainHead {
  if (records.length === 0) return { seq: 0, head_record_sha256: GENESIS };
  const last = records[records.length - 1];
  return { seq: last.seq, head_record_sha256: last.record_sha256 };
}

/**
 * Submits the current chain head to an external timestamp authority via the
 * injected `submit`. There is intentionally no default submitter: callers must
 * supply a real authority. Returns the head plus the authority's receipt; the
 * caller decides how to persist/publish it. (Wiring a concrete authority — and
 * only then emitting an "anchored" claim — is the next Wave-1 step.)
 */
export async function anchorHead(
  submit: ExternalAnchorSubmitter,
  records: EvidenceRecord[] = readLedger(),
): Promise<ChainHead & { receipt: ExternalAnchorReceipt }> {
  const head = computeChainHead(records);
  const receipt = await submit(head.head_record_sha256);
  return { ...head, receipt };
}

/* ── Change detection ──────────────────────────────────────────────────────
 * Re-capturing a URL is how a reporter proves a silent edit or a quiet
 * un-publish. It needs no new storage: writeBlob dedupes identical bytes, so two
 * captures of the same URL share a content_sha256 when unchanged and differ when
 * the outlet altered the page. These are pure reads over the ledger — nothing
 * derived is written back into the immutable record. Matching is on requested_url
 * (the stable input), not source_url (which can vary by redirect).
 * ─────────────────────────────────────────────────────────────────────────── */

export interface CaptureHistoryEntry {
  seq: number;
  captured_at: string;
  content_sha256: string;
  content_bytes: number;
  changed_from_prev: boolean; // false for the first capture of the URL
}

export interface ChangeSummary {
  first_capture: boolean;
  changed: boolean | null;    // null on a first capture — nothing was checked
  capture_count: number;
  prior?: { seq: number; captured_at: string; content_sha256: string };
}

/** Every capture of `url`, oldest first, each flagged if its bytes differ from the prior one. */
export function captureHistoryForUrl(url: string, records: EvidenceRecord[] = readLedger()): CaptureHistoryEntry[] {
  const entries: CaptureHistoryEntry[] = [];
  let prevHash: string | null = null;
  for (const r of records) {
    if (r.requested_url !== url) continue;
    entries.push({
      seq: r.seq,
      captured_at: r.captured_at,
      content_sha256: r.content_sha256,
      content_bytes: r.content_bytes,
      changed_from_prev: prevHash !== null && prevHash !== r.content_sha256,
    });
    prevHash = r.content_sha256;
  }
  return entries;
}

/**
 * Summarizes what a freshly captured `newContentSha256` means for `url`, given the
 * records that existed BEFORE it was appended. First capture ⇒ changed:null (there
 * was nothing to compare against — never reported as "unchanged").
 */
export function summarizeChange(url: string, newContentSha256: string, priorRecords: EvidenceRecord[] = readLedger()): ChangeSummary {
  const priors = priorRecords.filter((r) => r.requested_url === url);
  if (priors.length === 0) {
    return { first_capture: true, changed: null, capture_count: 1 };
  }
  const prior = priors[priors.length - 1];
  return {
    first_capture: false,
    changed: prior.content_sha256 !== newContentSha256,
    capture_count: priors.length + 1,
    prior: { seq: prior.seq, captured_at: prior.captured_at, content_sha256: prior.content_sha256 },
  };
}

export function resetEvidenceForTests(dir?: string): void {
  // Tests point SENTRA_EVIDENCE_DIR at a temp dir; nothing to do here beyond doc.
  void dir;
}
