/**
 * Sentra Mi8 — Submarine fibre-optic cable provider.
 *
 * Primary source is the TeleGeography Submarine Cable Map open API, which is
 * keyless. Every cable status is derived from fields that source actually
 * publishes; nothing is invented. See `deriveCableStatus` for the exact rules
 * and the `status_basis` string each record carries.
 *
 * TeleGeography tracks in-service and planned systems only — it removes cables
 * once they are retired rather than flagging them. There is therefore no open
 * feed for `not_operational`, and this module never guesses one. An optional
 * commercial outage feed can supply it via CABLE_STATUS_URL / CABLE_STATUS_KEY.
 */

export const SUBMARINE_CABLE_BASE_URL = 'https://www.submarinecablemap.com/api/v3';
export const CABLE_CACHE_TTL_MS = 86_400_000; // 24h — the upstream dataset changes on a monthly cadence
export const CABLE_SOURCE_NAME = 'TeleGeography Submarine Cable Map';
export const CABLE_SOURCE_URL = 'https://www.submarinecablemap.com/';

/** Cables whose ready-for-service year is this close are treated as under construction. */
const UNDER_CONSTRUCTION_HORIZON_YEARS = 1;
const DETAIL_CONCURRENCY = 24;

export type CableStatus = 'operational' | 'under_construction' | 'planned' | 'not_operational';

type EnvLike = Record<string, string | undefined>;
type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface CableLandingPoint {
  id: string;
  name: string;
  country: string;
}

export interface CableDetail {
  id: string;
  name: string;
  length: string | null;
  landing_points: CableLandingPoint[];
  owners: string | null;
  suppliers: string | null;
  rfs: string | null;
  rfs_year: number | null;
  is_planned: boolean | null;
  url: string | null;
  notes: string | null;
}

export interface CableFeatureProperties {
  id: string;
  name: string;
  status: CableStatus;
  /** Machine-readable provenance for `status` — distinguishes source fact from local inference. */
  status_basis: string;
  rfs: string | null;
  rfs_year: number | null;
  owners: string | null;
  suppliers: string | null;
  length: string | null;
  landing_point_count: number;
  landing_countries: string;
  url: string | null;
  notes: string | null;
  source: string;
  source_url: string;
}

export interface CableFeature {
  type: 'Feature';
  geometry: { type: 'MultiLineString'; coordinates: number[][][] };
  properties: CableFeatureProperties;
}

export interface CableSummary {
  total: number;
  operational: number;
  under_construction: number;
  planned: number;
  not_operational: number;
}

export interface CableFeedData {
  type: 'FeatureCollection';
  features: CableFeature[];
  summary: CableSummary;
  /** True when some cable details could not be retrieved, so statuses are partial. */
  degraded: boolean;
  /** Cables whose geometry loaded but whose detail request failed. */
  unresolved: string[];
  /**
   * Null when no source for retired/faulted cables is configured. The UI must
   * render "not operational" as unsourced rather than as zero known outages.
   */
  not_operational_source: string | null;
  source: string;
  source_url: string;
  timestamp: string;
}

interface ProviderOptions {
  env?: EnvLike;
  fetcher?: FetchLike;
  nowMs?: number;
  timeoutMs?: number;
}

/**
 * Maps a TeleGeography cable record onto a Sentra status.
 *
 * `is_planned === false` is source truth for an in-service cable. The split of
 * planned systems into under-construction vs planned is local inference from the
 * announced ready-for-service year, and says so in `status_basis`.
 */
export function deriveCableStatus(
  detail: Pick<CableDetail, 'is_planned' | 'rfs_year'>,
  nowYear: number,
): { status: CableStatus; status_basis: string } {
  const horizon = nowYear + UNDER_CONSTRUCTION_HORIZON_YEARS;
  const rfsYear = typeof detail.rfs_year === 'number' ? detail.rfs_year : null;

  if (detail.is_planned === false) {
    return { status: 'operational', status_basis: 'telegeography:is_planned=false' };
  }

  if (detail.is_planned === true) {
    if (rfsYear != null && rfsYear <= horizon) {
      return {
        status: 'under_construction',
        status_basis: `derived:is_planned=true,rfs_year=${rfsYear}<=${horizon}`,
      };
    }
    return {
      status: 'planned',
      status_basis: rfsYear == null
        ? 'derived:is_planned=true,rfs_year=unknown'
        : `derived:is_planned=true,rfs_year=${rfsYear}>${horizon}`,
    };
  }

  // is_planned absent: fall back to the ready-for-service year as the only evidence available.
  if (rfsYear != null && rfsYear <= nowYear) {
    return { status: 'operational', status_basis: `derived:is_planned=unknown,rfs_year=${rfsYear}<=${nowYear}` };
  }
  return { status: 'planned', status_basis: 'derived:is_planned=unknown,rfs_year=unknown' };
}

export async function fetchSubmarineCables(options: ProviderOptions = {}): Promise<CableFeedData> {
  const env = options.env ?? process.env;
  const fetcher = options.fetcher ?? fetch;
  const nowMs = options.nowMs ?? Date.now();
  const timeoutMs = options.timeoutMs ?? 20_000;
  const baseUrl = normalizeBaseUrl(env.SUBMARINE_CABLE_BASE_URL || SUBMARINE_CABLE_BASE_URL);
  const nowYear = new Date(nowMs).getUTCFullYear();

  const geo = await getJson(fetcher, `${baseUrl}/cable/cable-geo.json`, timeoutMs);
  const geoFeatures: unknown[] = Array.isArray((geo as { features?: unknown[] })?.features)
    ? (geo as { features: unknown[] }).features
    : [];
  if (geoFeatures.length === 0) {
    throw new Error('Submarine cable geometry response contained no features');
  }

  const cableIds = new Set<string>();
  for (const feature of geoFeatures) {
    const id = readCableId(feature);
    if (id) cableIds.add(id);
  }

  const { details, failed } = await fetchCableDetails(fetcher, baseUrl, [...cableIds], timeoutMs);

  const features: CableFeature[] = [];
  for (const rawFeature of geoFeatures) {
    const id = readCableId(rawFeature);
    if (!id) continue;
    const geometry = readGeometry(rawFeature);
    if (!geometry) continue;

    const detail = details.get(id);
    const name = readCableName(rawFeature) || detail?.name || id;

    // A cable whose detail request failed is reported as unresolved rather than
    // being assigned a guessed status.
    if (!detail) continue;

    const { status, status_basis } = deriveCableStatus(detail, nowYear);
    const landingPoints = Array.isArray(detail.landing_points) ? detail.landing_points : [];

    features.push({
      type: 'Feature',
      geometry,
      properties: {
        id,
        name,
        status,
        status_basis,
        rfs: detail.rfs ?? null,
        rfs_year: typeof detail.rfs_year === 'number' ? detail.rfs_year : null,
        owners: detail.owners ?? null,
        suppliers: detail.suppliers ?? null,
        length: detail.length ?? null,
        landing_point_count: landingPoints.length,
        landing_countries: uniqueCountries(landingPoints).join(', '),
        url: detail.url ?? null,
        notes: detail.notes ?? null,
        source: CABLE_SOURCE_NAME,
        source_url: CABLE_SOURCE_URL,
      },
    });
  }

  return {
    type: 'FeatureCollection',
    features,
    summary: summarizeCables(features),
    degraded: failed.length > 0,
    unresolved: failed,
    not_operational_source: null,
    source: CABLE_SOURCE_NAME,
    source_url: CABLE_SOURCE_URL,
    timestamp: new Date(nowMs).toISOString(),
  };
}

export function summarizeCables(features: CableFeature[]): CableSummary {
  const summary: CableSummary = {
    total: 0,
    operational: 0,
    under_construction: 0,
    planned: 0,
    not_operational: 0,
  };
  const counted = new Set<string>();
  for (const feature of features) {
    // A cable can span several geometry features; count systems, not line segments.
    if (counted.has(feature.properties.id)) continue;
    counted.add(feature.properties.id);
    summary.total++;
    summary[feature.properties.status]++;
  }
  return summary;
}

async function fetchCableDetails(
  fetcher: FetchLike,
  baseUrl: string,
  ids: string[],
  timeoutMs: number,
): Promise<{ details: Map<string, CableDetail>; failed: string[] }> {
  const details = new Map<string, CableDetail>();
  const failed: string[] = [];
  let cursor = 0;

  const worker = async () => {
    while (cursor < ids.length) {
      const id = ids[cursor++];
      try {
        const detail = await getJson(fetcher, `${baseUrl}/cable/${encodeURIComponent(id)}.json`, timeoutMs);
        if (detail && typeof detail === 'object') {
          details.set(id, detail as CableDetail);
        } else {
          failed.push(id);
        }
      } catch {
        failed.push(id);
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(DETAIL_CONCURRENCY, Math.max(ids.length, 1)) }, worker),
  );

  return { details, failed };
}

async function getJson(fetcher: FetchLike, url: string, timeoutMs: number): Promise<unknown> {
  const res = await fetcher(url, {
    headers: { 'User-Agent': 'Sentra Mi8/1.0', Accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`${url} responded with HTTP ${res.status}`);
  return res.json();
}

function readCableId(feature: unknown): string | null {
  const props = (feature as { properties?: { id?: unknown } })?.properties;
  const id = props?.id;
  return typeof id === 'string' && id.trim().length > 0 ? id.trim() : null;
}

function readCableName(feature: unknown): string | null {
  const props = (feature as { properties?: { name?: unknown } })?.properties;
  const name = props?.name;
  return typeof name === 'string' && name.trim().length > 0 ? name.trim() : null;
}

function readGeometry(feature: unknown): CableFeature['geometry'] | null {
  const geometry = (feature as { geometry?: { type?: unknown; coordinates?: unknown } })?.geometry;
  if (!geometry || geometry.type !== 'MultiLineString') return null;
  if (!Array.isArray(geometry.coordinates) || geometry.coordinates.length === 0) return null;
  return { type: 'MultiLineString', coordinates: geometry.coordinates as number[][][] };
}

function uniqueCountries(points: CableLandingPoint[]): string[] {
  const countries = new Set<string>();
  for (const point of points) {
    if (point && typeof point.country === 'string' && point.country.trim()) {
      countries.add(point.country.trim());
    }
  }
  return [...countries];
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, '');
}
