/**
 * Sentra Mi8 — Florida DOT traffic cameras (FL511).
 *
 * Source is the same endpoint fl511.com's own public camera list uses. It needs
 * no API key; the documented `/api/v2/...` surface does (it answers
 * `{"Message":"Invalid Key"}`), and FDOT's DIVAS_Cameras ArcGIS service is
 * render-only with query disabled, so this is the one open path to the full set.
 *
 * The server caps a page at 100 rows regardless of the requested length, so the
 * ~4,900 cameras are paged through with bounded concurrency.
 *
 * Live video is HLS on DIVAS, origin-locked to fl511.com. Click-to-play goes
 * through /api/cctv/fl511-live (token mint) and /api/cctv/fl511-hls (playlist
 * rewrite) so the first-party CameraViewer can play it with hls.js.
 */

const FL511_BASE = 'https://fl511.com';
const FL511_PAGE_SIZE = 100;
const FL511_MAX_PAGES = 80; // ~8,000 cameras; a backstop against a runaway loop
const FL511_CONCURRENCY = 6;
const FL511_CACHE_TTL_MS = 60 * 60 * 1000;
const FL511_STREAM_CACHE_TTL_MS = 5 * 60 * 1000;
const FL511_HLS_PROXY_PATH = '/api/cctv/fl511-hls';
const DIVAS_TOKEN_URL = 'https://divas.cloud/VDS-API/SecureTokenUri/GetSecureTokenUriBySourceId';

export const FL511_SOURCE = 'FDOT FL511';

const FL511_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/javascript, */*; q=0.01',
  'X-Requested-With': 'XMLHttpRequest',
  'Referer': `${FL511_BASE}/List/Cameras`,
};

const DIVAS_PLAY_HEADERS = {
  'User-Agent': FL511_HEADERS['User-Agent'],
  'Accept': '*/*',
  'Origin': FL511_BASE,
  'Referer': `${FL511_BASE}/List/Cameras`,
};

export interface CctvCamera {
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
  district?: string;
  external_url?: string;
  /** FDOT snapshots change once a minute; polling faster only wastes requests. */
  refresh_ms?: number;
  /** Present when FDOT publishes an HLS stream. Playback needs a DIVAS token. */
  video_url?: string | null;
  video_auth_required?: boolean;
}

interface Fl511Image {
  imageUrl?: string;
  disabled?: boolean;
  blocked?: boolean;
  videoUrl?: string;
  isVideoAuthRequired?: boolean;
}

interface Fl511Row {
  id?: number | string;
  images?: Fl511Image[];
  location?: string;
  roadway?: string;
  direction?: string;
  county?: string;
  city?: string;
  region?: string;
  source?: string;
  dotDistrict?: string;
  latLng?: { geography?: { wellKnownText?: string } };
}

let cachedCameras: CctvCamera[] | null = null;
let cacheExpiresAt = 0;
const streamCache = new Map<string, { payload: Fl511LiveStream; expiresAt: number }>();

export interface Fl511LiveStream {
  id: string;
  imageId: string;
  name: string;
  feed_url: string;
  video_url: string;
  play_url: string;
  proxy_url: string;
}

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

export function normalizeFl511Camera(row: Fl511Row): CctvCamera | null {
  const coords = parseWktPoint(row?.latLng?.geography?.wellKnownText);
  if (!coords || row?.id == null) return null;

  const image = row.images?.[0];
  // A blocked or disabled camera has no viewable image; omit rather than ship a dead tile.
  if (!image || image.disabled || image.blocked || !image.imageUrl) return null;

  const feedUrl = image.imageUrl.startsWith('http')
    ? image.imageUrl
    : `${FL511_BASE}${image.imageUrl}`;

  const name = row.location
    || [row.roadway, row.direction].filter(Boolean).join(' ')
    || 'FDOT Camera';

  return {
    id: `fl511-${row.id}`,
    lat: coords.lat,
    lng: coords.lng,
    name,
    city: row.city || row.county || row.region || 'Florida',
    country: 'US',
    feed_url: feedUrl,
    source: FL511_SOURCE,
    county: row.county || undefined,
    roadway: row.roadway || undefined,
    direction: row.direction || undefined,
    district: row.dotDistrict || row.source || undefined,
    external_url: `${FL511_BASE}/map#camera-${row.id}`,
    refresh_ms: 60000,
    // Carried through so the stream is ready the moment a credential path
    // exists; it is NOT set as stream_url because DIVAS returns 401 without a
    // per-session token minted from FDOT's own application credential.
    video_url: image.videoUrl?.trim() || null,
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

export function buildFl511PageUrl(start: number, length = FL511_PAGE_SIZE): string {
  return `${FL511_BASE}/List/GetData/Cameras?query=${encodeURIComponent(buildQuery(start, length))}&lang=en-US`;
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

async function fetchPage(start: number, fetcher: FetchLike): Promise<{ rows: Fl511Row[]; total: number }> {
  const res = await fetcher(buildFl511PageUrl(start), {
    headers: FL511_HEADERS,
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`FL511 page ${start} failed with HTTP ${res.status}`);
  const payload = await res.json();
  return {
    rows: Array.isArray(payload?.data) ? payload.data : [],
    total: Number(payload?.recordsTotal) || 0,
  };
}

export async function fetchFl511Cameras(options: { fetcher?: FetchLike; force?: boolean } = {}): Promise<CctvCamera[]> {
  const fetcher = options.fetcher ?? fetch;

  if (!options.force && cachedCameras && cacheExpiresAt > Date.now()) return cachedCameras;

  // The first page also tells us how many there are in total.
  const first = await fetchPage(0, fetcher);
  if (first.total === 0 && first.rows.length === 0) return cachedCameras ?? [];

  const pageCount = Math.min(Math.ceil(first.total / FL511_PAGE_SIZE), FL511_MAX_PAGES);
  const starts: number[] = [];
  for (let p = 1; p < pageCount; p++) starts.push(p * FL511_PAGE_SIZE);

  const collected: Fl511Row[] = [...first.rows];
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
  await Promise.all(Array.from({ length: Math.min(FL511_CONCURRENCY, starts.length || 1) }, worker));

  const seen = new Set<string>();
  const cameras: CctvCamera[] = [];
  for (const row of collected) {
    const cam = normalizeFl511Camera(row);
    if (!cam || seen.has(cam.id)) continue;
    seen.add(cam.id);
    cameras.push(cam);
  }

  if (cameras.length > 0) {
    cachedCameras = cameras;
    cacheExpiresAt = Date.now() + FL511_CACHE_TTL_MS;
  }
  return cameras;
}

export function resetFl511Caches(): void {
  cachedCameras = null;
  cacheExpiresAt = 0;
  streamCache.clear();
}

/** `fl511-435` or `435` → the numeric image id FL511's GetVideoUrl expects. */
export function parseFl511ImageId(id: string | undefined | null): string | null {
  if (!id) return null;
  const m = /^(?:fl511-)?(\d+)$/i.exec(String(id).trim());
  return m ? m[1] : null;
}

export function isFl511CameraId(id: string | undefined | null): boolean {
  return parseFl511ImageId(id) !== null && String(id).toLowerCase().startsWith('fl511-');
}

/**
 * DIVAS HLS is origin-locked to fl511.com. The only hosts we will mint tokens
 * for or proxy are the DIVAS API and its playback edges.
 */
export function isAllowedDivasUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:') return false;
  if (u.username || u.password) return false;
  const host = u.hostname.toLowerCase();
  return host === 'divas.cloud' || host.endsWith('.divas.cloud');
}

export function buildFl511HlsProxyUrl(absoluteUrl: string, proxyPath = FL511_HLS_PROXY_PATH): string {
  return `${proxyPath}?u=${encodeURIComponent(absoluteUrl)}`;
}

function rewritePlaylistUri(uri: string, playlistUrl: string, proxyPath: string): string {
  let absolute: string;
  try {
    absolute = new URL(uri, playlistUrl).href;
  } catch {
    return uri;
  }
  if (!isAllowedDivasUrl(absolute)) return uri;
  return buildFl511HlsProxyUrl(absolute, proxyPath);
}

/**
 * Rewrites every playable URI in an HLS playlist through our DIVAS proxy so
 * the browser never sends Origin: <our app> to a host that 401s anything
 * other than fl511.com.
 */
export function rewriteHlsPlaylist(playlist: string, playlistUrl: string, proxyPath = FL511_HLS_PROXY_PATH): string {
  return playlist.split(/\r?\n/).map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return line;
    if (trimmed.startsWith('#')) {
      return trimmed.replace(/URI="([^"]+)"/gi, (_m, uri: string) => `URI="${rewritePlaylistUri(uri, playlistUrl, proxyPath)}"`);
    }
    return rewritePlaylistUri(trimmed, playlistUrl, proxyPath);
  }).join('\n');
}

export function isHlsPlaylistBody(contentType: string | undefined, body: string): boolean {
  if (/mpegurl|x-mpegurl|vnd\.apple\.mpegurl/i.test(contentType || '')) return true;
  return /^\s*#EXTM3U/m.test(body);
}

function appendTokenQuery(videoUrl: string, token: string): string {
  const qs = token.startsWith('?') || token.startsWith('&') ? token : `?${token}`;
  if (videoUrl.includes('?')) {
    return `${videoUrl}${qs.replace(/^\?/, '&')}`;
  }
  return `${videoUrl}${qs.startsWith('?') ? qs : `?${qs}`}`;
}

async function fetchFl511VideoCredentials(imageId: string, fetcher: FetchLike): Promise<unknown> {
  const res = await fetcher(`${FL511_BASE}/Camera/GetVideoUrl?imageId=${encodeURIComponent(imageId)}`, {
    headers: FL511_HEADERS,
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`FL511 GetVideoUrl failed with HTTP ${res.status}`);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return text.trim();
  }
}

async function fetchDivasTokenQuery(credentials: object, fetcher: FetchLike): Promise<string> {
  const res = await fetcher(DIVAS_TOKEN_URL, {
    method: 'POST',
    headers: {
      ...FL511_HEADERS,
      'Content-Type': 'application/json',
      'Origin': FL511_BASE,
      'Referer': `${FL511_BASE}/`,
    },
    body: JSON.stringify(credentials),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`DIVAS token request failed with HTTP ${res.status}`);
  const payload = await res.json();
  if (typeof payload === 'string' && payload.trim()) return payload.trim();
  if (payload && typeof payload === 'object' && typeof (payload as { token?: string }).token === 'string') {
    const token = (payload as { token: string }).token.trim();
    return token.startsWith('?') ? token : `?token=${token}`;
  }
  throw new Error('DIVAS token response was empty');
}

export async function resolveFl511LiveStream(
  cameraId: string,
  options: {
    fetcher?: FetchLike;
    force?: boolean;
    cameras?: CctvCamera[];
    videoUrl?: string;
    feedUrl?: string;
    name?: string;
  } = {},
): Promise<Fl511LiveStream> {
  const imageId = parseFl511ImageId(cameraId);
  if (!imageId) throw new Error('Invalid FL511 camera id');

  const fetcher = options.fetcher ?? fetch;
  if (!options.force) {
    const hit = streamCache.get(imageId);
    if (hit && hit.expiresAt > Date.now()) return hit.payload;
  }

  const cameras = options.cameras ?? cachedCameras ?? [];
  let camera = cameras.find((c) => parseFl511ImageId(c.id) === imageId) ?? null;
  if (!camera?.video_url && options.videoUrl && isAllowedDivasUrl(options.videoUrl)) {
    camera = {
      id: `fl511-${imageId}`,
      lat: 0,
      lng: 0,
      name: options.name || 'FDOT Camera',
      city: 'Florida',
      country: 'US',
      feed_url: options.feedUrl || '',
      source: FL511_SOURCE,
      video_url: options.videoUrl,
      video_auth_required: true,
    };
  }
  if (!camera?.video_url) {
    camera = (options.cameras ?? await fetchFl511Cameras({ fetcher }))
      .find((c) => parseFl511ImageId(c.id) === imageId) ?? null;
  }
  if (!camera?.video_url) throw new Error('FL511 camera has no live stream');
  if (!isAllowedDivasUrl(camera.video_url)) throw new Error('FL511 video URL is not a DIVAS host');

  let playUrl = camera.video_url;
  if (camera.video_auth_required !== false) {
    const creds = await fetchFl511VideoCredentials(imageId, fetcher);
    if (typeof creds === 'string' && creds) {
      playUrl = /^https?:/i.test(creds) ? creds : appendTokenQuery(camera.video_url, creds);
    } else if (creds && typeof creds === 'object') {
      const tokenQs = await fetchDivasTokenQuery(creds as object, fetcher);
      playUrl = appendTokenQuery(camera.video_url, tokenQs);
    } else {
      throw new Error('FL511 GetVideoUrl returned no credentials');
    }
    if (!isAllowedDivasUrl(playUrl)) throw new Error('Resolved FL511 stream is not a DIVAS host');
  }

  const payload: Fl511LiveStream = {
    id: camera.id,
    imageId,
    name: camera.name,
    feed_url: camera.feed_url,
    video_url: camera.video_url,
    play_url: playUrl,
    proxy_url: buildFl511HlsProxyUrl(playUrl),
  };
  streamCache.set(imageId, { payload, expiresAt: Date.now() + FL511_STREAM_CACHE_TTL_MS });
  return payload;
}

export async function fetchDivasMedia(url: string, options: { fetcher?: FetchLike; hops?: number } = {}): Promise<Response> {
  if (!isAllowedDivasUrl(url)) throw new Error('Refusing to proxy a non-DIVAS URL');
  const hops = options.hops ?? 0;
  if (hops > 3) throw new Error('Too many DIVAS redirects');
  const fetcher = options.fetcher ?? fetch;
  const res = await fetcher(url, {
    redirect: 'manual',
    headers: DIVAS_PLAY_HEADERS,
    signal: AbortSignal.timeout(20000),
  });
  if (res.status >= 300 && res.status < 400) {
    const location = res.headers.get('location');
    if (!location) throw new Error('DIVAS redirect without Location');
    const next = new URL(location, url).href;
    return fetchDivasMedia(next, { fetcher, hops: hops + 1 });
  }
  return res;
}
