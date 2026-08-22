import type {
  CameraProviderOptions,
  CameraProviderResult,
  CameraRecord,
} from './types';

/**
 * Sentra Mi8 — Windy Webcams (watchable public webcams worldwide).
 *
 * Optional and keyed: without WINDY_API_KEY this provider reports itself absent
 * rather than failing, so the worldwide camera route still serves OpenStreetMap
 * positions and the existing traffic-authority feeds.
 *
 * These are webcams whose operators publish them deliberately, which is the
 * distinction that matters — this platform does not index cameras that were
 * never meant to be public.
 */

export const WINDY_API_BASE = 'https://api.windy.com/webcams/api/v3';
export const WINDY_ATTRIBUTION = 'Webcams provided by windy.com';
export const WINDY_CACHE_TTL_MS = 900_000; // 15m

const DEFAULT_LIMIT = 50;
/** Windy caps `limit`; requesting more is rejected outright. */
const MAX_LIMIT = 50;

interface WindyWebcam {
  webcamId?: number | string;
  title?: string;
  status?: string;
  location?: { latitude?: number; longitude?: number; city?: string; country?: string };
  images?: { current?: { preview?: string; thumbnail?: string } };
  player?: { day?: string; live?: string };
  urls?: { detail?: string; edit?: string };
  categories?: Array<{ id?: string; name?: string }>;
}

export function hasWindyKey(env: Record<string, string | undefined> = process.env): boolean {
  const key = env.WINDY_API_KEY;
  return typeof key === 'string' && key.trim().length > 0;
}

export function normalizeWindyWebcam(webcam: WindyWebcam): CameraRecord | null {
  const lat = webcam.location?.latitude;
  const lng = webcam.location?.longitude;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (webcam.webcamId == null) return null;

  // Windy marks cameras that have gone dark; those are not watchable.
  if (typeof webcam.status === 'string' && webcam.status !== 'active') return null;

  const preview = webcam.images?.current?.preview || webcam.images?.current?.thumbnail || null;
  const player = webcam.player?.live || webcam.player?.day || null;

  return {
    id: `windy-${webcam.webcamId}`,
    name: webcam.title || 'Windy webcam',
    lat,
    lng,
    source: 'windy',
    provider_label: 'Windy Webcams',
    kind: player ? 'stream' : 'location',
    city: webcam.location?.city || null,
    country: webcam.location?.country || null,
    operator: null,
    camera_type: webcam.categories?.[0]?.name || null,
    surveillance_type: null,
    direction: null,
    preview_url: preview,
    stream_url: player,
    // Windy serves an embeddable player page rather than a raw media URL.
    stream_type: player ? 'iframe' : null,
    external_url: webcam.urls?.detail || null,
    attribution: WINDY_ATTRIBUTION,
  };
}

export async function fetchWindyWebcams(
  options: CameraProviderOptions = {},
): Promise<CameraProviderResult> {
  const env = options.env ?? process.env;
  const fetcher = options.fetcher ?? fetch;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const limit = Math.min(options.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  const apiKey = env.WINDY_API_KEY?.trim();

  if (!apiKey) {
    return {
      cameras: [],
      degraded: false,
      message: 'Windy webcams are not configured; add WINDY_API_KEY to enable watchable feeds.',
    };
  }

  const base = env.WINDY_API_BASE || WINDY_API_BASE;
  const params = new URLSearchParams({
    limit: String(limit),
    // `include` is what makes the response carry positions, images and players.
    include: 'location,images,player,urls,categories',
  });
  if (options.bbox) {
    const { north, west, south, east } = options.bbox;
    params.set('nearby', `${(north + south) / 2},${(east + west) / 2},250`);
  }

  const res = await fetcher(`${base}/webcams?${params.toString()}`, {
    headers: {
      'x-windy-api-key': apiKey,
      Accept: 'application/json',
      'User-Agent': 'Sentra Mi8/1.0',
    },
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (res.status === 401 || res.status === 403) {
    return { cameras: [], degraded: true, message: 'Windy rejected the configured API key.' };
  }
  if (!res.ok) {
    throw new Error(`Windy request failed with HTTP ${res.status}`);
  }

  const payload = await res.json();
  const list: WindyWebcam[] = Array.isArray(payload?.webcams) ? payload.webcams : [];
  const cameras = list
    .map(normalizeWindyWebcam)
    .filter((camera): camera is CameraRecord => camera !== null);

  return { cameras, degraded: false };
}
