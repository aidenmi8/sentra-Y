import { NextResponse } from 'next/server';
import { fetchIptvChannels, normalizeCountryCode } from '@/lib/iptv';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const country = normalizeCountryCode(searchParams.get('country'));
  const refresh = searchParams.get('refresh') === '1';

  if (!country) {
    return NextResponse.json({
      channels: [],
      total: 0,
      error: 'Invalid country code. Use a two-letter ISO country code such as DO or US.',
      source: 'iptv-org',
      timestamp: new Date().toISOString(),
    }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }

  try {
    const result = await fetchIptvChannels(country, { refresh });
    return NextResponse.json({
      country,
      channels: result.channels,
      total: result.channels.length,
      cached: result.cached,
      refreshed: refresh && !result.cached,
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
      country,
      channels: [],
      total: 0,
      error: error instanceof Error ? error.message : 'Failed to fetch IPTV channels',
      source: 'iptv-org',
      timestamp: new Date().toISOString(),
    }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
}
