import { NextResponse } from 'next/server';
import { fetchIptvCountries } from '@/lib/iptv';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const refresh = searchParams.get('refresh') === '1';

  try {
    const result = await fetchIptvCountries({ refresh });
    return NextResponse.json({
      countries: result.countries,
      total: result.countries.length,
      cached: result.cached,
      stale: Boolean(result.stale),
      warning: result.warning || null,
      source: 'iptv-org',
      sourceUrl: result.sourceUrl,
      timestamp: new Date().toISOString(),
    }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return NextResponse.json({
      countries: [],
      total: 0,
      error: error instanceof Error ? error.message : 'Failed to fetch IPTV countries',
      source: 'iptv-org',
      timestamp: new Date().toISOString(),
    }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
}
