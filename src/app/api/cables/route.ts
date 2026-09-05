import { NextResponse } from 'next/server';
import {
  fetchSubmarineCables,
  CABLE_CACHE_TTL_MS,
  type CableFeedData,
} from '@/lib/submarine-cables';
import { getProviderEnv } from '@/lib/provider-config';
import { registerCacheReset } from '@/lib/cache-registry';

/**
 * Sentra Mi8 — Submarine fibre-optic cable network.
 * Keyless TeleGeography open data; statuses carry their own provenance.
 */

let cachedData: CableFeedData | null = null;
let lastFetchTime = 0;
let fetchPromise: Promise<CableFeedData> | null = null;

// The 24h cache would otherwise outlive a change to SUBMARINE_CABLE_BASE_URL.
registerCacheReset('cables', () => {
  cachedData = null;
  lastFetchTime = 0;
});

export async function GET() {
  const now = Date.now();

  if (cachedData && now - lastFetchTime < CABLE_CACHE_TTL_MS) {
    return NextResponse.json(cachedData, { headers: { 'Cache-Control': cacheHeader(cachedData) } });
  }

  if (fetchPromise) {
    try {
      const data = await fetchPromise;
      return NextResponse.json(data, { headers: { 'Cache-Control': cacheHeader(data) } });
    } catch {
      return serveStaleOrError();
    }
  }

  fetchPromise = fetchSubmarineCables({ env: getProviderEnv() });

  try {
    const data = await fetchPromise;
    cachedData = data;
    lastFetchTime = Date.now();
    return NextResponse.json(data, { headers: { 'Cache-Control': cacheHeader(data) } });
  } catch (error) {
    console.error('[Sentra Mi8] Submarine cable fetch error:', error);
    return serveStaleOrError();
  } finally {
    fetchPromise = null;
  }
}

/**
 * Cables change on a monthly cadence, so a previously fetched set stays useful
 * through an upstream outage — but it is labelled stale rather than passed off
 * as fresh, and a cold failure is an explicit error, never an empty map.
 */
function serveStaleOrError() {
  if (cachedData) {
    return NextResponse.json(
      { ...cachedData, degraded: true, stale: true, stale_since: new Date(lastFetchTime).toISOString() },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }
  return NextResponse.json(
    { error: 'Submarine cable source unavailable', source: 'TeleGeography Submarine Cable Map' },
    { status: 502, headers: { 'Cache-Control': 'no-store' } },
  );
}

function cacheHeader(data: CableFeedData): string {
  return data.degraded
    ? 'no-store, max-age=0'
    : 'public, s-maxage=86400, stale-while-revalidate=172800';
}
