import { NextResponse } from 'next/server';
import { buildLocalEntityGraph } from '@/lib/entity-intel';
import { isRateLimited, getClientIp } from '@/lib/ssrf-guard';

export const dynamic = 'force-dynamic';

/**
 * Thin proxy to the Sentra Mi8 Intelligence Layer.
 *
 * In Docker: fetches from http://sentra-mi8-intel:4000/resolve
 * In dev:    fetches from http://localhost:4000/resolve
 * Deprecated compatibility alias: http://osiris-intel:4000
 *
 * All intelligence logic lives in the intel container — this route
 * just validates the request and forwards it.
 */

const DEPRECATED_OSIRIS_INTEL_URL = process.env.OSIRIS_INTEL_URL;
const INTEL_URL = process.env.SENTRA_MI8_INTEL_URL || process.env.INTEL_URL || DEPRECATED_OSIRIS_INTEL_URL || (
  process.env.NODE_ENV === 'production'
    ? 'http://sentra-mi8-intel:4000'
    : 'http://localhost:4000'
);

const ALLOWED_TYPES = new Set(['aircraft', 'vessel', 'company', 'person', 'ip', 'country']);

export async function GET(req: Request) {
  const clientIp = getClientIp(req);
  if (isRateLimited(clientIp, 30, 60_000)) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
  }

  const { searchParams } = new URL(req.url);
  const type = (searchParams.get('type') || '').toLowerCase().trim();
  const id = (searchParams.get('id') || '').trim();

  if (!type || !ALLOWED_TYPES.has(type)) {
    return NextResponse.json(
      { error: `Invalid type. Allowed: ${[...ALLOWED_TYPES].join(', ')}` },
      { status: 400 },
    );
  }
  if (!id || id.length < 2 || id.length > 200) {
    return NextResponse.json({ error: 'Invalid id (2-200 chars)' }, { status: 400 });
  }

  const properties: Record<string, string> = {};
  for (const key of ['registration', 'model', 'icao24', 'flag', 'destination']) {
    const value = searchParams.get(key);
    if (value) properties[key] = value;
  }

  try {
    const params = new URLSearchParams({ type, id });
    // Forward extra aircraft properties to the intel brain
    for (const [key, value] of Object.entries(properties)) {
      params.set(key, value);
    }

    const res = await fetch(`${INTEL_URL}/resolve?${params}`, {
      signal: AbortSignal.timeout(15000),
      headers: { 'X-Forwarded-For': clientIp },
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      if (res.status >= 500) {
        return localFallback(type, id, properties);
      }
      return NextResponse.json(
        { error: body.error || `Intel layer returned ${res.status}`, nodes: [], links: [] },
        { status: res.status },
      );
    }

    const data = await res.json();
    return NextResponse.json(data, {
      headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=7200' },
    });
  } catch (e) {
    console.warn('[Sentra Mi8] Intel service unavailable; using local fallback:', e instanceof Error ? e.message : e);
    return localFallback(type, id, properties);
  }
}

function localFallback(type: string, id: string, properties: Record<string, string>) {
  const graph = buildLocalEntityGraph({ type, id, properties });
  return NextResponse.json(graph, {
    headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=900' },
  });
}
