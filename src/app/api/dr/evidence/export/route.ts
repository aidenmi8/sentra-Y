import { NextResponse } from 'next/server';
import { readLedger, verifyChain, buildDossier } from '@/lib/dr-media/evidence';
import { guardEvidenceRequest } from '@/lib/dr-media/evidence-guard';

export const dynamic = 'force-dynamic';

/** Export the evidence ledger as JSON, or a human-readable dossier (?format=dossier). */
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

  return NextResponse.json(
    { verification, count: records.length, records },
    { headers: { 'Cache-Control': 'no-store', 'Content-Disposition': 'attachment; filename="sentra-evidence.json"' } },
  );
}
