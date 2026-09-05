import { createHash } from 'node:crypto';
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
  record_sha256: string;       // hash of this record (excluding this field)
}

function sha256(buf: Buffer | string): string {
  return createHash('sha256').update(buf).digest('hex');
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
  };
  const record: EvidenceRecord = { ...base, record_sha256: sha256(JSON.stringify(base)) };

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

export interface ChainVerification {
  ok: boolean;
  count: number;
  brokenAt: number | null;
  reason?: string;
}

/** Walks the chain, confirming each link and each record's own hash. */
export function verifyChain(records: EvidenceRecord[] = readLedger()): ChainVerification {
  let prev = GENESIS;
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    if (r.prev_record_sha256 !== prev) {
      return { ok: false, count: records.length, brokenAt: r.seq, reason: 'chain link mismatch' };
    }
    const { record_sha256, ...base } = r;
    if (sha256(JSON.stringify(base)) !== record_sha256) {
      return { ok: false, count: records.length, brokenAt: r.seq, reason: 'record hash mismatch (edited)' };
    }
    prev = record_sha256;
  }
  return { ok: true, count: records.length, brokenAt: null };
}

/** Human-readable citable dossier built from the ledger. */
export function buildDossier(records: EvidenceRecord[] = readLedger()): string {
  const v = verifyChain(records);
  const lines: string[] = [
    '# Sentra Mi8 — Evidence Dossier',
    '',
    `Generated: ${new Date().toISOString()}`,
    `Records: ${records.length}`,
    `Chain integrity: ${v.ok ? 'VERIFIED — unbroken' : `BROKEN at seq ${v.brokenAt} (${v.reason})`}`,
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

export function resetEvidenceForTests(dir?: string): void {
  // Tests point SENTRA_EVIDENCE_DIR at a temp dir; nothing to do here beyond doc.
  void dir;
}
