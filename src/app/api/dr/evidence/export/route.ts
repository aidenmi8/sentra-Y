import { NextResponse } from 'next/server';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { readLedger, verifyChain, buildDossier, EVIDENCE_DIR } from '@/lib/dr-media/evidence';
import { EVIDENCE_VERIFIER_MJS, buildBundleReadme } from '@/lib/dr-media/evidence-verifier';
import { guardEvidenceRequest } from '@/lib/dr-media/evidence-guard';

export const dynamic = 'force-dynamic';

const BUNDLE_ROOT = 'sentra-evidence-bundle';

/**
 * Export the evidence ledger as JSON, a human-readable dossier (?format=dossier),
 * or a self-contained, independently verifiable ZIP bundle (?format=bundle):
 * ledger + every referenced blob + public key + a dependency-free verify.mjs, so a
 * newsroom or court can re-check chain, blob, and signature integrity offline.
 */
export async function GET(request: Request) {
  const guard = guardEvidenceRequest(request);
  if (!guard.allowed) {
    return NextResponse.json({ error: guard.message, reason: guard.reason }, { status: guard.status ?? 403, headers: { 'Cache-Control': 'no-store' } });
  }

  const format = new URL(request.url).searchParams.get('format');
  const records = readLedger();
  const verification = verifyChain(records);

  if (format === 'dossier') {
    return new Response(buildDossier(records), {
      status: 200,
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition': 'attachment; filename="sentra-dossier.md"',
        'Cache-Control': 'no-store',
      },
    });
  }

  if (format === 'bundle') {
    const files: Record<string, Uint8Array> = {};

    const ledgerPath = join(EVIDENCE_DIR, 'ledger.jsonl');
    files[`${BUNDLE_ROOT}/ledger.jsonl`] = existsSync(ledgerPath)
      ? new Uint8Array(readFileSync(ledgerPath))
      : strToU8('');
    files[`${BUNDLE_ROOT}/dossier.md`] = strToU8(buildDossier(records));

    // Public key (present only when the store is signed).
    const metaPath = join(EVIDENCE_DIR, 'meta.json');
    let signed = false;
    let keyId: string | undefined;
    if (existsSync(metaPath)) {
      const metaBuf = readFileSync(metaPath);
      files[`${BUNDLE_ROOT}/meta.json`] = new Uint8Array(metaBuf);
      signed = true;
      try { keyId = JSON.parse(metaBuf.toString('utf8')).key_id; } catch { /* label optional */ }
    }

    // Every UNIQUE referenced blob (identical captures dedupe to one file).
    const seen = new Set<string>();
    for (const r of records) {
      if (seen.has(r.content_sha256)) continue;
      seen.add(r.content_sha256);
      const blobPath = join(EVIDENCE_DIR, 'blobs', r.content_sha256);
      if (existsSync(blobPath)) files[`${BUNDLE_ROOT}/blobs/${r.content_sha256}`] = new Uint8Array(readFileSync(blobPath));
    }

    files[`${BUNDLE_ROOT}/verify.mjs`] = strToU8(EVIDENCE_VERIFIER_MJS);
    files[`${BUNDLE_ROOT}/README.md`] = strToU8(buildBundleReadme({ records: records.length, signed, keyId }));

    const zip = zipSync(files, { level: 6 });
    const stamp = new Date().toISOString().slice(0, 10);
    return new Response(Buffer.from(zip), {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="sentra-evidence-bundle-${stamp}.zip"`,
        'Cache-Control': 'no-store',
      },
    });
  }

  return NextResponse.json(
    { verification, count: records.length, records },
    { headers: { 'Cache-Control': 'no-store', 'Content-Disposition': 'attachment; filename="sentra-evidence.json"' } },
  );
}
