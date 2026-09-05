import { NextResponse } from 'next/server';
import { isAdminEnabled, isLoopbackHost } from '@/lib/admin-guard';

export const dynamic = 'force-dynamic';

/**
 * Whether the provider admin surface is reachable for this request. Returns a
 * pair of booleans and nothing else, so the dashboard can decide whether to
 * render the link without probing the guarded endpoint itself.
 */
export async function GET(request: Request) {
  const enabled = isAdminEnabled();
  const local = isLoopbackHost(request.headers.get('host'));
  return NextResponse.json(
    { enabled, local, available: enabled && local },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
