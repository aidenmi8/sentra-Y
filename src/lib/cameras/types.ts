/**
 * Sentra Mi8 — worldwide camera record.
 *
 * Two genuinely different things share this shape, and `kind` is what separates
 * them. A `stream` camera has a feed you can watch. A `location` camera is a
 * mapped position with no public feed — OpenStreetMap records where cameras are
 * installed, which is useful intelligence in itself, but it is not a webcam.
 * Conflating the two would promise video that does not exist.
 */
export interface CameraRecord {
  id: string;
  name: string;
  lat: number;
  lng: number;
  source: string;
  provider_label: string;
  kind: 'location' | 'stream';
  city?: string | null;
  country?: string | null;
  operator?: string | null;
  camera_type?: string | null;
  surveillance_type?: string | null;
  direction?: number | null;
  preview_url?: string | null;
  stream_url?: string | null;
  stream_type?: 'hls' | 'video' | 'iframe' | 'image' | null;
  external_url?: string | null;
  attribution: string;
}

export interface CameraProviderResult {
  cameras: CameraRecord[];
  /** True when the provider was asked for data but could not supply it. */
  degraded: boolean;
  message?: string;
}

export interface BoundingBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

export type EnvLike = Record<string, string | undefined>;
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface CameraProviderOptions {
  env?: EnvLike;
  fetcher?: FetchLike;
  timeoutMs?: number;
  bbox?: BoundingBox;
  limit?: number;
}

/** Rejects malformed or oversized viewports before they reach a provider. */
export function parseBoundingBox(raw: string | null): BoundingBox | null {
  if (!raw) return null;
  const parts = raw.split(',').map((v) => Number(v.trim()));
  if (parts.length !== 4 || parts.some((v) => !Number.isFinite(v))) return null;
  const [south, west, north, east] = parts;
  if (south < -90 || north > 90 || south >= north) return null;
  if (west < -180 || east > 180 || west >= east) return null;
  return { south, west, north, east };
}

/** Area in square degrees — used to refuse queries an upstream would time out on. */
export function bboxArea(bbox: BoundingBox): number {
  return (bbox.north - bbox.south) * (bbox.east - bbox.west);
}
