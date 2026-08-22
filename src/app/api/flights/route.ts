import { NextResponse } from 'next/server';
import {
  fetchFlightData,
  resetOpenSkyTokenCache,
  FLIGHT_CACHE_TTL_MS,
  type FlightFeedData,
} from '@/lib/flight-providers';
import { getProviderEnv } from '@/lib/provider-config';
import { registerCacheReset } from '@/lib/cache-registry';

/**
 * Sentra Mi8 - Flight Data API
 * Uses OpenSky OAuth as the primary provider and adsb.lol as keyless fallback.
 */

let cachedData: FlightFeedData | null = null;
let lastFetchTime = 0;
let fetchPromise: Promise<FlightFeedData> | null = null;

// Both the response cache and the OpenSky OAuth token are credential-dependent,
// so an updated key must clear them or it appears to have no effect.
registerCacheReset('flights', () => {
  cachedData = null;
  lastFetchTime = 0;
  resetOpenSkyTokenCache();
});

export async function GET() {
  const now = Date.now();

  if (cachedData && now - lastFetchTime < FLIGHT_CACHE_TTL_MS) {
    return NextResponse.json(cachedData, {
      headers: { 'Cache-Control': cacheHeader(cachedData) },
    });
  }

  if (fetchPromise) {
    try {
      const data = await fetchPromise;
      return NextResponse.json(data, {
        headers: { 'Cache-Control': cacheHeader(data) },
      });
    } catch {
      return NextResponse.json({ error: 'Failed to fetch flight data' }, { status: 500 });
    }
  }

  fetchPromise = fetchFlightData({ env: getProviderEnv() });

  try {
    const data = await fetchPromise;
    cachedData = data;
    lastFetchTime = Date.now();
    return NextResponse.json(data, {
      headers: { 'Cache-Control': cacheHeader(data) },
    });
  } catch (error) {
    console.error('Flight fetch error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch flight data' },
      { status: 500 },
    );
  } finally {
    fetchPromise = null;
  }
}

function cacheHeader(data: FlightFeedData): string {
  return data.total < 100
    ? 'no-store, max-age=0'
    : 'public, s-maxage=90, stale-while-revalidate=180';
}
