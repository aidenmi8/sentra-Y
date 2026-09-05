import { NextResponse } from 'next/server';
import { fetchOsmSurveillanceCameras, OSM_CACHE_TTL_MS } from '@/lib/cameras/osm-surveillance';
import { fetchWindyWebcams } from '@/lib/cameras/windy-webcams';
import { parseBoundingBox, type CameraRecord } from '@/lib/cameras/types';
import { getProviderEnv } from '@/lib/provider-config';
import { registerCacheReset } from '@/lib/cache-registry';

export const dynamic = 'force-dynamic';

/**
 * Sentra Mi8 — worldwide camera coverage.
 *
 * Merges two deliberately different sources:
 *   OpenStreetMap  — keyless worldwide camera POSITIONS (no viewable feed)
 *   Windy Webcams  — optional keyed WATCHABLE public webcams
 *
 * Every record carries `kind` so the client can tell a mapped position from a
 * feed, and `attribution`, which both licences require to be displayed.
 */

interface CacheEntry {
  payload: unknown;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const MAX_CACHE_ENTRIES = 60;

registerCacheReset('cameras-worldwide', () => cache.clear());

export async function GET(request: Request) {
  const url = new URL(request.url);
  const bbox = parseBoundingBox(url.searchParams.get('bbox'));

  if (!bbox) {
    return NextResponse.json(
      { error: 'A bbox query parameter is required, formatted south,west,north,east.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const cacheKey = [bbox.south, bbox.west, bbox.north, bbox.east].map((v) => v.toFixed(2)).join(',');
  const now = Date.now();
  const hit = cache.get(cacheKey);
  if (hit && hit.expiresAt > now) {
    return NextResponse.json(hit.payload, { headers: { 'Cache-Control': 'public, s-maxage=600' } });
  }

  const env = getProviderEnv();
  const [osmResult, windyResult] = await Promise.allSettled([
    fetchOsmSurveillanceCameras({ env, bbox }),
    fetchWindyWebcams({ env, bbox }),
  ]);

  const cameras: CameraRecord[] = [];
  const providers: Record<string, { count: number; state: string; message?: string }> = {};

  if (osmResult.status === 'fulfilled') {
    cameras.push(...osmResult.value.cameras);
    providers.osm = {
      count: osmResult.value.cameras.length,
      state: osmResult.value.degraded ? 'degraded' : 'ok',
      message: osmResult.value.message,
    };
  } else {
    providers.osm = { count: 0, state: 'failed', message: safeMessage(osmResult.reason) };
  }

  if (windyResult.status === 'fulfilled') {
    cameras.push(...windyResult.value.cameras);
    providers.windy = {
      count: windyResult.value.cameras.length,
      state: windyResult.value.degraded ? 'degraded' : 'ok',
      message: windyResult.value.message,
    };
  } else {
    providers.windy = { count: 0, state: 'failed', message: safeMessage(windyResult.reason) };
  }

  const attributions = [...new Set(cameras.map((c) => c.attribution))];
  const payload = {
    cameras,
    total: cameras.length,
    watchable: cameras.filter((c) => c.kind === 'stream').length,
    positions: cameras.filter((c) => c.kind === 'location').length,
    providers,
    attributions,
    bbox,
    degraded: Object.values(providers).some((p) => p.state !== 'ok'),
    timestamp: new Date().toISOString(),
  };

  // Only cache a clean result; a degraded one should be retried, not pinned.
  if (!payload.degraded) {
    if (cache.size >= MAX_CACHE_ENTRIES) {
      const oldest = cache.keys().next().value;
      if (oldest) cache.delete(oldest);
    }
    cache.set(cacheKey, { payload, expiresAt: now + OSM_CACHE_TTL_MS });
  }

  return NextResponse.json(payload, {
    headers: { 'Cache-Control': payload.degraded ? 'no-store' : 'public, s-maxage=600' },
  });
}

function safeMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : 'unknown error';
}
