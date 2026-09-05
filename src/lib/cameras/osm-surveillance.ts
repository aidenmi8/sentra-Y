import type {
  BoundingBox,
  CameraProviderOptions,
  CameraProviderResult,
  CameraRecord,
} from './types';
import { bboxArea } from './types';

/**
 * Sentra Mi8 — OpenStreetMap surveillance camera positions via Overpass.
 *
 * Keyless and worldwide. These records are camera LOCATIONS, not feeds: a probe
 * of the Greater London bbox returned 2,426 nodes of which only 16 carried any
 * URL tag at all. Every record is therefore emitted as `kind: 'location'` and
 * the UI must not present them as watchable.
 *
 * Queries are viewport-bounded by necessity — an unbounded global Overpass query
 * for man_made=surveillance times out (HTTP 504).
 */

export const OVERPASS_ENDPOINT = 'https://overpass-api.de/api/interpreter';
export const OSM_ATTRIBUTION = '© OpenStreetMap contributors (ODbL)';
export const OSM_CACHE_TTL_MS = 3_600_000; // 1h — surveillance nodes change slowly

/** Overpass refuses very large areas; beyond this we ask the user to zoom in. */
export const MAX_BBOX_AREA_DEGREES = 25;
const DEFAULT_LIMIT = 3000;

interface OverpassElement {
  type?: string;
  id?: number;
  lat?: number;
  lon?: number;
  center?: { lat?: number; lon?: number };
  tags?: Record<string, string>;
}

export function buildOverpassQuery(bbox: BoundingBox, limit: number): string {
  const area = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
  // nwr covers nodes, ways and relations; `center` gives ways a single point.
  return `[out:json][timeout:50];nwr["man_made"="surveillance"](${area});out center ${limit};`;
}

export function normalizeOsmCamera(element: OverpassElement): CameraRecord | null {
  const lat = typeof element.lat === 'number' ? element.lat : element.center?.lat;
  const lng = typeof element.lon === 'number' ? element.lon : element.center?.lon;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (element.id == null) return null;

  const tags = element.tags || {};
  const surveillanceType = tags['surveillance:type'] || null;
  const zone = tags['surveillance:zone'] || tags.surveillance || null;
  const operator = tags.operator || tags['operator:short'] || null;

  const descriptor = surveillanceType === 'ALPR'
    ? 'ANPR / plate reader'
    : surveillanceType === 'guard'
      ? 'Guard post'
      : 'Surveillance camera';
  const name = tags.name || (zone ? `${descriptor} — ${zone}` : descriptor);

  const direction = Number(tags['camera:direction'] ?? tags.direction);

  return {
    id: `osm-${element.type || 'node'}-${element.id}`,
    name,
    lat,
    lng,
    source: 'osm',
    provider_label: 'OpenStreetMap',
    // No viewable feed. See the module comment.
    kind: 'location',
    city: null,
    country: null,
    operator,
    camera_type: tags['camera:type'] || null,
    surveillance_type: surveillanceType,
    direction: Number.isFinite(direction) ? direction : null,
    preview_url: null,
    stream_url: null,
    stream_type: null,
    external_url: `https://www.openstreetmap.org/${element.type || 'node'}/${element.id}`,
    attribution: OSM_ATTRIBUTION,
  };
}

export async function fetchOsmSurveillanceCameras(
  options: CameraProviderOptions = {},
): Promise<CameraProviderResult> {
  const fetcher = options.fetcher ?? fetch;
  const timeoutMs = options.timeoutMs ?? 60_000;
  const limit = options.limit ?? DEFAULT_LIMIT;
  const bbox = options.bbox;

  if (!bbox) {
    return { cameras: [], degraded: true, message: 'A viewport is required for OpenStreetMap surveillance data.' };
  }
  if (bboxArea(bbox) > MAX_BBOX_AREA_DEGREES) {
    return {
      cameras: [],
      degraded: false,
      message: 'Zoom in to load OpenStreetMap camera positions for this area.',
    };
  }

  const endpoint = options.env?.OVERPASS_ENDPOINT || OVERPASS_ENDPOINT;
  const query = buildOverpassQuery(bbox, limit);

  const res = await fetcher(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'Sentra Mi8/1.0',
      Accept: 'application/json',
    },
    body: `data=${encodeURIComponent(query)}`,
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) {
    throw new Error(`Overpass request failed with HTTP ${res.status}`);
  }

  const payload = await res.json();
  const elements: OverpassElement[] = Array.isArray(payload?.elements) ? payload.elements : [];
  const cameras = elements
    .map(normalizeOsmCamera)
    .filter((camera): camera is CameraRecord => camera !== null);

  return { cameras, degraded: false };
}
