import { NextResponse } from 'next/server';
import { isEvidenceEnabled } from '@/lib/dr-media/evidence-guard';
import { isLoopbackHost } from '@/lib/admin-guard';

export const dynamic = 'force-dynamic';

/** Whether the evidence capture surface is reachable for this request. */
export async function GET(request: Request) {
  const enabled = isEvidenceEnabled();
  const local = isLoopbackHost(request.headers.get('host'));
  return NextResponse.json({ enabled, local, available: enabled && local }, { headers: { 'Cache-Control': 'no-store' } });
}
