import { NextResponse } from 'next/server';
import { buildProviderHealth } from '@/lib/provider-health';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(buildProviderHealth(), {
    headers: {
      'Cache-Control': 'no-store',
    },
  });
}
