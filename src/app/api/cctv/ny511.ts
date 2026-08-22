/**
 * Sentra Mi8 — New York State DOT traffic cameras (511NY).
 *
 * 511ny.org runs the same Castle Rock list platform as FL511, so the camera
 * list comes from the identical keyless `/List/GetData/Cameras` endpoint the
 * public site uses, paged 100 rows at a time.
 *
 * Unlike FL511/DIVAS, NY video is Skyline/skyvdn HLS with `isVideoAuthRequired`
 * false, and both the playlist and its segments return `Access-Control-Allow-Origin: *`.
 * The browser can therefore play the stream directly with hls.js — no token
 * mint and no same-origin proxy. Each record is emitted with `stream_url` +
 * `stream_type: 'hls'` so the first-party CameraViewer plays it as-is.
 */

import { registerCacheReset } from '@/lib/cache-registry';

const NY511_BASE = 'https://511ny.org';
const NY511_PAGE_SIZE = 100;
const NY511_MAX_PAGES = 80; // backstop; ~3,000 cameras today
const NY511_CONCURRENCY = 6;
const NY511_CACHE_TTL_MS = 60 * 60 * 1000;

export const NY511_SOURCE = 'NYSDOT 511NY';

const NY511_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/javascript, */*; q=0.01',
  'X-Requested-With': 'XMLHttpRequest',
  'Referer': `${NY511_BASE}/List/Cameras`,
};

export interface Ny511Camera {
  id: string;
  lat: number;
  lng: number;
  name: string;
  city: string;
  country: string;
  feed_url: string;
  source: string;
  county?: string;
  roadway?: string;
  direction?: string;
  region?: string;
  external_url?: string;
  refresh_ms?: number;
  stream_url?: string | null;
  stream_type?: 'hls' | null;
  video_url?: string | null;
  video_auth_required?: boolean;
}

interface Ny511Image {
  imageUrl?: string;
  videoUrl?: string;
  isVideoAuthRequired?: boolean;
  disabled?: boolean;
  blocked?: boolean;
}

interface Ny511Row {
  id?: number | string;
  images?: Ny511Image[];
  location?: string;
  roadway?: string;
  direction?: string;
  county?: string;
  city?: string;
  region?: string;
  source?: string;
  latLng?: { geography?: { wellKnownText?: string } };
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

let cachedCameras: Ny511Camera[] | null = null;
let cacheExpiresAt = 0;

/** Parses the `POINT (lng lat)` WKT the endpoint returns. Longitude comes first. */
export function parseWktPoint(wkt: string | undefined | null): { lat: number; lng: number } | null {
  if (!wkt) return null;
  const m = /POINT\s*\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)/i.exec(wkt);
  if (!m) return null;
  const lng = Number(m[1]);
  const lat = Number(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

export function normalizeNy511Camera(row: Ny511Row): Ny511Camera | null {
  const coords = parseWktPoint(row?.latLng?.geography?.wellKnownText);
  if (!coords || row?.id == null) return null;

  const image = row.images?.[0];
  if (!image || image.disabled || image.blocked || !image.imageUrl) return null;

  const feedUrl = image.imageUrl.startsWith('http')
    ? image.imageUrl
    : `${NY511_BASE}${image.imageUrl}`;

  const rawVideo = image.videoUrl?.trim() || '';
  // NY video is unauthenticated CORS-open HLS, so it can be played directly.
  const playable = rawVideo && image.isVideoAuthRequired === false;

  const name = row.location
    || [row.roadway, row.direction].filter(Boolean).join(' ')
    || '511NY Camera';

  return {
    id: `ny511-${row.id}`,
    lat: coords.lat,
    lng: coords.lng,
    name,
    city: row.city || row.county || row.region || 'New York',
    country: 'US',
    feed_url: feedUrl,
    source: NY511_SOURCE,
    county: row.county || undefined,
    roadway: row.roadway || undefined,
    direction: row.direction || undefined,
    region: row.region || undefined,
    external_url: `${NY511_BASE}/map#camera-${row.id}`,
    refresh_ms: 60000,
    stream_url: playable ? rawVideo : null,
    stream_type: playable ? 'hls' : null,
    video_url: rawVideo || null,
    video_auth_required: image.isVideoAuthRequired !== false,
  };
}

function buildQuery(start: number, length: number): string {
  return JSON.stringify({
    columns: [
      { data: null, name: '' },
      { name: 'sortOrder', s: true },
      { name: 'region', s: true },
      { name: 'county', s: true },
      { name: 'roadway', s: true },
      { name: 'location' },
      { name: 'direction', s: true },
      { data: 7, name: '' },
    ],
    order: [{ column: 1, dir: 'asc' }],
    start,
    length,
    search: { value: '' },
  });
}

export function buildNy511PageUrl(start: number, length = NY511_PAGE_SIZE): string {
  return `${NY511_BASE}/List/GetData/Cameras?query=${encodeURIComponent(buildQuery(start, length))}&lang=en-US`;
}

async function fetchPage(start: number, fetcher: FetchLike): Promise<{ rows: Ny511Row[]; total: number }> {
  const res = await fetcher(buildNy511PageUrl(start), {
    headers: NY511_HEADERS,
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`511NY page ${start} failed with HTTP ${res.status}`);
  const payload = await res.json();
  return {
    rows: Array.isArray(payload?.data) ? payload.data : [],
    total: Number(payload?.recordsTotal) || 0,
  };
}

export async function fetchNy511Cameras(options: { fetcher?: FetchLike; force?: boolean } = {}): Promise<Ny511Camera[]> {
  const fetcher = options.fetcher ?? fetch;

  if (!options.force && cachedCameras && cacheExpiresAt > Date.now()) return cachedCameras;

  const first = await fetchPage(0, fetcher);
  if (first.total === 0 && first.rows.length === 0) return cachedCameras ?? [];

  const pageCount = Math.min(Math.ceil(first.total / NY511_PAGE_SIZE), NY511_MAX_PAGES);
  const starts: number[] = [];
  for (let p = 1; p < pageCount; p++) starts.push(p * NY511_PAGE_SIZE);

  const collected: Ny511Row[] = [...first.rows];
  let cursor = 0;
  const worker = async () => {
    while (cursor < starts.length) {
      const start = starts[cursor++];
      try {
        const page = await fetchPage(start, fetcher);
        collected.push(...page.rows);
      } catch {
        // A single lost page costs those cameras, not the whole state.
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(NY511_CONCURRENCY, starts.length || 1) }, worker));

  const seen = new Set<string>();
  const cameras: Ny511Camera[] = [];
  for (const row of collected) {
    const cam = normalizeNy511Camera(row);
    if (!cam || seen.has(cam.id)) continue;
    seen.add(cam.id);
    cameras.push(cam);
  }

  if (cameras.length > 0) {
    cachedCameras = cameras;
    cacheExpiresAt = Date.now() + NY511_CACHE_TTL_MS;
  }
  return cameras;
}

export function resetNy511Caches(): void {
  cachedCameras = null;
  cacheExpiresAt = 0;
}

registerCacheReset('ny511', resetNy511Caches);
