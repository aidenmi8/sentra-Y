import { NextResponse } from 'next/server';
import { buildProviderHealth } from '@/lib/provider-health';
import { getProviderEnv } from '@/lib/provider-config';

export const dynamic = 'force-dynamic';

export async function GET() {
  // Reads the merged view so credentials set through the admin surface are
  // reflected here without a restart.
  return NextResponse.json(buildProviderHealth(getProviderEnv()), {
    headers: {
      'Cache-Control': 'no-store',
    },
  });
}
