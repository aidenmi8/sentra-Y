export const OPENSKY_BASE_URL = 'https://opensky-network.org/api';
export const OPENSKY_TOKEN_URL = 'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';
export const FLIGHT_CACHE_TTL_MS = 90_000;

type EnvLike = Record<string, string | undefined>;
type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
type AdsbAircraft = {
  hex?: string;
  flight?: string;
  lat?: number;
  lon?: number;
  alt_baro?: number;
  gs?: number;
  track?: number;
  t?: string;
  r?: string;
  squawk?: string;
  nac_p?: number;
  dbFlags?: number;
  seen_pos?: number;
};

export interface FlightFeedData {
  commercial_flights: AircraftRecord[];
  private_flights: AircraftRecord[];
  private_jets: AircraftRecord[];
  military_flights: AircraftRecord[];
  gps_jamming: Array<{ lat: number; lng: number; severity: number; count: number }>;
  total: number;
  timestamp: string;
}

export interface AircraftRecord {
  callsign: string;
  lat: number;
  lng: number;
  alt: number;
  heading: number;
  speed_knots: number | null;
  model: string;
  icao24: string;
  registration: string;
  squawk: string;
  airline_code?: string;
  aircraft_category: 'plane' | 'heli' | 'unknown';
  category: 'commercial' | 'private' | 'jet' | 'military';
  grounded: boolean;
  nac_p?: number;
  type: 'flight';
  feed_timestamp?: string;
  feedTimestamp?: string;
  source: string;
  origin_country?: string;
  opensky_category?: number | null;
}

interface ProviderOptions {
  env?: EnvLike;
  fetcher?: FetchLike;
  nowMs?: number;
  timeoutMs?: number;
}

const REGIONS = [
  { lat: 39.8, lon: -98.5, dist: 2000 },
  { lat: 50.0, lon: 15.0, dist: 2000 },
  { lat: 35.0, lon: 105.0, dist: 2000 },
  { lat: -25.0, lon: 133.0, dist: 2000 },
  { lat: 0.0, lon: 20.0, dist: 2500 },
  { lat: -15.0, lon: -60.0, dist: 2000 },
];

const HELI_TYPES = new Set([
  'R22', 'R44', 'R66', 'B06', 'B06T', 'B204', 'B205', 'B206', 'B212', 'B222', 'B230',
  'B407', 'B412', 'B427', 'B429', 'B430', 'B505', 'B525',
  'AS32', 'AS35', 'AS50', 'AS55', 'AS65',
  'EC20', 'EC25', 'EC30', 'EC35', 'EC45', 'EC55', 'EC75',
  'H125', 'H130', 'H135', 'H145', 'H155', 'H160', 'H175', 'H215', 'H225',
  'S55', 'S58', 'S61', 'S64', 'S70', 'S76', 'S92',
  'A109', 'A119', 'A139', 'A169', 'A189', 'AW09',
  'MD52', 'MD60', 'MDHI', 'MD90', 'NOTR',
  'B47G', 'HUEY', 'GAMA', 'CABR', 'EXE',
]);

const PRIVATE_JET_TYPES = new Set([
  'G150', 'G200', 'G280', 'GLEX', 'G500', 'G550', 'G600', 'G650', 'G700',
  'GLF2', 'GLF3', 'GLF4', 'GLF5', 'GLF6', 'GL5T', 'GL7T', 'GV', 'GIV',
  'CL30', 'CL35', 'CL60', 'BD70', 'BD10',
  'C25A', 'C25B', 'C25C', 'C500', 'C510', 'C525', 'C550', 'C560', 'C56X', 'C680', 'C700', 'C750',
  'E35L', 'E50P', 'E55P', 'E545', 'E550',
  'FA50', 'FA7X', 'FA8X', 'F900', 'F2TH',
  'LJ35', 'LJ40', 'LJ45', 'LJ60', 'LJ70', 'LJ75',
  'PC12', 'PC24', 'TBM7', 'TBM8', 'TBM9',
  'PRM1', 'SF50', 'EA50', 'VLJ',
]);

const MILITARY_INDICATORS = new Set([
  'C17', 'C5M', 'C130', 'C30J', 'KC10', 'KC46', 'KC35', 'E3CF', 'E3TF', 'E8A',
  'B1B', 'B2', 'B52', 'F16', 'F15', 'F18', 'F22', 'F35', 'A10', 'F117',
  'RC135', 'E6B', 'P8A', 'P3', 'MQ9', 'RQ4', 'U2', 'EP3', 'RC12',
  'V22', 'CH47', 'UH60', 'AH64', 'AH1Z', 'MV22',
  'EUFI', 'RFAL', 'TORD', 'TYP', 'GR4',
]);

const COMMERCIAL_TYPES = new Set([
  'A319', 'A320', 'A321', 'A332', 'A333', 'A339', 'A343', 'A359', 'A388',
  'B737', 'B738', 'B739', 'B38M', 'B39M', 'B752', 'B753', 'B763', 'B764',
  'B772', 'B77L', 'B77W', 'B788', 'B789', 'B78X',
  'E170', 'E175', 'E190', 'E195', 'CRJ7', 'CRJ9', 'AT43', 'AT72', 'DH8D',
]);

const AIRLINE_CODE_RE = /^([A-Z]{3})\d/;
/** Military airlift/tanker/medevac callsign prefixes shared by both providers. */
const MILITARY_CALLSIGN_RE = /^(RCH|KING|DUKE|EVAC|JAKE|REACH|CONVOY)\d/i;
const JAMMING_NACAP_THRESHOLD = 4;
const MPS_TO_KNOTS = 1.943844492;

let openSkyTokenCache: { token: string; expiresAtMs: number } | null = null;

/** Drops the cached OAuth token so the next request re-authenticates. */
export function resetOpenSkyTokenCache() {
  openSkyTokenCache = null;
}

/** @deprecated Use {@link resetOpenSkyTokenCache}. Retained for existing tests. */
export const resetOpenSkyTokenCacheForTests = resetOpenSkyTokenCache;

export function createOpenSkyTokenRequest(clientId: string, clientSecret: string) {
  const body = new URLSearchParams();
  body.set('grant_type', 'client_credentials');
  body.set('client_id', clientId);
  body.set('client_secret', clientSecret);

  return {
    url: OPENSKY_TOKEN_URL,
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    },
  };
}

export async function fetchOpenSkyFlightData(options: ProviderOptions = {}): Promise<FlightFeedData> {
  const aircraft = await fetchOpenSkyAircraft(options);
  return buildFlightFeed(aircraft, new Date(options.nowMs ?? Date.now()).toISOString());
}

/** Fetches and normalises OpenSky states without bucketing them into a feed. */
export async function fetchOpenSkyAircraft(options: ProviderOptions = {}): Promise<AircraftRecord[]> {
  const env = options.env ?? process.env;
  const fetcher = options.fetcher ?? fetch;
  const nowMs = options.nowMs ?? Date.now();
  const timeoutMs = options.timeoutMs ?? 20_000;
  const baseUrl = normalizeBaseUrl(env.OPENSKY_BASE_URL || OPENSKY_BASE_URL);
  const token = await getOpenSkyAccessToken({ env, fetcher, nowMs, timeoutMs });
  const requestUrl = `${baseUrl}/states/all?extended=1`;

  let res = await fetcher(requestUrl, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (res.status === 401) {
    openSkyTokenCache = null;
    const refreshedToken = await getOpenSkyAccessToken({ env, fetcher, nowMs, timeoutMs, forceRefresh: true });
    res = await fetcher(requestUrl, {
      headers: { Authorization: `Bearer ${refreshedToken}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
  }

  if (!res.ok) {
    throw new Error(`OpenSky request failed with HTTP ${res.status}`);
  }

  const payload = await res.json();
  const responseTime = typeof payload?.time === 'number' ? payload.time : Math.floor(nowMs / 1000);
  const aircraft = Array.isArray(payload?.states)
    ? payload.states
        .map((state: unknown) => normalizeOpenSkyState(state, responseTime))
        .filter((state: AircraftRecord | null): state is AircraftRecord => Boolean(state))
    : [];

  return aircraft;
}

export async function fetchAdsbLolFlightData(options: ProviderOptions = {}): Promise<FlightFeedData> {
  const fetcher = options.fetcher ?? fetch;
  const timeoutMs = options.timeoutMs ?? 20_000;
  const regionResults = await Promise.allSettled(
    REGIONS.map((region) => fetchAdsbRegion(region, fetcher, timeoutMs)),
  );

  const allRaw: AdsbAircraft[] = [];
  const seenHex = new Set<string>();

  for (const result of regionResults) {
    if (result.status !== 'fulfilled') continue;
    for (const ac of result.value) {
      const hex = String(ac?.hex || '').toLowerCase().trim();
      if (!hex || seenHex.has(hex)) continue;
      seenHex.add(hex);
      allRaw.push(ac);
    }
  }

  const aircraft = allRaw
    .map(classifyAdsbFlight)
    .filter((flight: AircraftRecord | null): flight is AircraftRecord => Boolean(flight));

  return buildFlightFeed(aircraft, new Date(options.nowMs ?? Date.now()).toISOString(), allRaw.length);
}

/**
 * Builds a hex-keyed index of adsb.lol records used to enrich OpenSky states.
 *
 * OpenSky gives near-global coverage but publishes no aircraft type code and no
 * registration, so on its own almost every aircraft classifies as `commercial`.
 * adsb.lol carries a type code for ~96% and a registration for ~98% of the
 * aircraft it sees, plus an explicit military bit, which is what makes the
 * military, jet and private layers populate at all.
 */
export async function fetchAdsbEnrichmentIndex(options: ProviderOptions = {}): Promise<Map<string, AdsbAircraft>> {
  const fetcher = options.fetcher ?? fetch;
  const timeoutMs = options.timeoutMs ?? 20_000;

  const results = await Promise.allSettled([
    ...REGIONS.map((region) => fetchAdsbRegion(region, fetcher, timeoutMs)),
    // Dedicated worldwide military feed — these aircraft are frequently outside
    // the regional circles and are the whole point of the military layer.
    fetchAdsbMilitary(fetcher, timeoutMs),
  ]);

  const index = new Map<string, AdsbAircraft>();
  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    for (const ac of result.value) {
      const hex = String(ac?.hex || '').toLowerCase().trim();
      if (hex) index.set(hex, ac);
    }
  }
  return index;
}

/** Copies adsb.lol metadata onto an OpenSky record and re-classifies it. */
export function enrichWithAdsb(record: AircraftRecord, adsb: AdsbAircraft | undefined): AircraftRecord {
  if (!adsb) return record;

  const typeCode = typeof adsb.t === 'string' ? adsb.t.trim() : '';
  const registration = typeof adsb.r === 'string' ? adsb.r.trim() : '';
  const dbFlags = Number(adsb.dbFlags || 0);

  return {
    ...record,
    model: typeCode || record.model,
    registration: registration || record.registration,
    category: classifyByTypeCode(record.callsign, record.airline_code ?? '', typeCode, dbFlags),
    aircraft_category: HELI_TYPES.has(typeCode.toUpperCase()) ? 'heli' : record.aircraft_category,
    // OpenSky states carry no navigation accuracy, so GPS-jamming detection
    // depends entirely on this field arriving from adsb.lol.
    nac_p: typeof adsb.nac_p === 'number' ? adsb.nac_p : record.nac_p,
    source: 'OpenSky Network + adsb.lol',
  };
}

export async function fetchFlightData(options: ProviderOptions = {}): Promise<FlightFeedData> {
  const env = options.env ?? process.env;
  const nowMs = options.nowMs ?? Date.now();
  const hasOpenSkyCredentials = hasValue(env.OPENSKY_CLIENT_ID) && hasValue(env.OPENSKY_CLIENT_SECRET);

  if (hasOpenSkyCredentials) {
    try {
      const aircraft = await fetchOpenSkyAircraft(options);
      if (aircraft.length > 0) {
        // Enrichment is best-effort: losing it costs metadata and category
        // precision, never coverage, so a failure here must not drop the feed.
        let enriched = aircraft;
        try {
          const index = await fetchAdsbEnrichmentIndex(options);
          if (index.size > 0) {
            enriched = aircraft.map((record) => enrichWithAdsb(record, index.get(record.icao24)));
          }
        } catch (error) {
          console.warn('[Sentra Mi8] adsb.lol enrichment unavailable; serving unenriched OpenSky data:', safeErrorMessage(error));
        }
        return buildFlightFeed(enriched, new Date(nowMs).toISOString());
      }
    } catch (error) {
      console.warn('[Sentra Mi8] OpenSky primary unavailable; falling back to adsb.lol:', safeErrorMessage(error));
    }
  }

  try {
    return await fetchAdsbLolFlightData(options);
  } catch (error) {
    console.warn('[Sentra Mi8] adsb.lol fallback unavailable:', safeErrorMessage(error));
    return emptyFlightData(options.nowMs);
  }
}

export function normalizeOpenSkyState(state: unknown, responseTime: number): AircraftRecord | null {
  if (!Array.isArray(state)) return null;
  const longitude = toFiniteNumber(state[5]);
  const latitude = toFiniteNumber(state[6]);
  if (longitude == null || latitude == null) return null;

  const icao24 = String(state[0] || '').trim().toLowerCase();
  const callsign = String(state[1] || '').trim() || icao24 || 'UNKNOWN';
  const velocity = toFiniteNumber(state[9]);
  const heading = toFiniteNumber(state[10]);
  const altitude = toFiniteNumber(state[7]);
  const categoryCode = toFiniteNumber(state[17]);
  const aircraftCategory = categoryCode === OPENSKY_CATEGORY.ROTORCRAFT ? 'heli' : 'plane';
  const airlineCode = extractAirlineCode(callsign);

  return {
    callsign,
    lat: roundCoordinate(latitude),
    lng: roundCoordinate(longitude),
    alt: altitude == null ? 0 : Math.round(altitude),
    heading: heading == null ? 0 : Math.round(heading),
    speed_knots: velocity == null ? null : Math.round(velocity * MPS_TO_KNOTS),
    model: 'Unknown',
    icao24,
    registration: 'N/A',
    squawk: String(state[14] || ''),
    airline_code: airlineCode,
    aircraft_category: aircraftCategory,
    category: classifyOpenSkyFlight(callsign, airlineCode, categoryCode),
    grounded: Boolean(state[8]),
    type: 'flight',
    feed_timestamp: new Date(responseTime * 1000).toISOString(),
    feedTimestamp: new Date(responseTime * 1000).toISOString(),
    source: 'OpenSky Network',
    origin_country: String(state[2] || ''),
    opensky_category: categoryCode,
  };
}

/** ADS-B emitter category codes as published in the OpenSky state vector. */
const OPENSKY_CATEGORY = {
  LIGHT: 2,
  SMALL: 3,
  LARGE: 4,
  HIGH_VORTEX_LARGE: 5,
  HEAVY: 6,
  HIGH_PERFORMANCE: 7,
  ROTORCRAFT: 8,
} as const;

/**
 * Classifies an OpenSky record from the signals that feed actually carries.
 *
 * OpenSky publishes no aircraft type code, so classification rests on the ADS-B
 * emitter category plus the callsign. Every record used to be hardcoded to
 * `commercial`, which left the military, private and jet layers empty whenever
 * OpenSky was the active provider.
 */
export function classifyOpenSkyFlight(
  callsign: string,
  airlineCode: string,
  categoryCode: number | null,
): AircraftRecord['category'] {
  if (MILITARY_CALLSIGN_RE.test(callsign)) return 'military';
  // >5g / >400kt performance envelope: effectively only military fast jets.
  if (categoryCode === OPENSKY_CATEGORY.HIGH_PERFORMANCE) return 'military';

  // An ICAO airline prefix is a positive commercial signal on its own.
  if (airlineCode) return 'commercial';

  switch (categoryCode) {
    case OPENSKY_CATEGORY.LIGHT:
      return 'private';
    // 15,500–75,000 lb with no airline callsign is the business-jet weight class.
    case OPENSKY_CATEGORY.SMALL:
      return 'jet';
    case OPENSKY_CATEGORY.LARGE:
    case OPENSKY_CATEGORY.HIGH_VORTEX_LARGE:
    case OPENSKY_CATEGORY.HEAVY:
      return 'commercial';
    default:
      return 'commercial';
  }
}

/**
 * Categorises an aircraft from its ICAO type code plus operator signals.
 *
 * Shared by the adsb.lol path and by OpenSky enrichment: OpenSky publishes no
 * type code at all, so records sourced from it can only be classified once
 * adsb.lol has supplied one.
 */
export function classifyByTypeCode(
  callsign: string,
  airlineCode: string,
  typeCode: string,
  dbFlags: number,
): AircraftRecord['category'] {
  const modelUpper = String(typeCode || '').toUpperCase();
  if ((dbFlags & 1) || MILITARY_INDICATORS.has(modelUpper) || MILITARY_CALLSIGN_RE.test(callsign)) {
    return 'military';
  }
  if (PRIVATE_JET_TYPES.has(modelUpper)) return 'jet';
  if (!airlineCode && modelUpper && !COMMERCIAL_TYPES.has(modelUpper)) return 'private';
  return 'commercial';
}

function classifyAdsbFlight(f: AdsbAircraft): AircraftRecord | null {
  const modelUpper = String(f?.t || '').toUpperCase();
  const flightStr = String(f?.flight || '').trim().toUpperCase();
  const dbFlags = Number(f?.dbFlags || 0);

  if (modelUpper === 'TWR') return null;

  const lat = toFiniteNumber(f?.lat);
  const lon = toFiniteNumber(f?.lon);
  if (lat == null || lon == null) return null;

  const callsign = flightStr || f?.hex || 'UNKNOWN';
  const altRaw = toFiniteNumber(f?.alt_baro);
  const altMeters = altRaw == null ? 0 : altRaw * 0.3048;
  const speedKnots = toFiniteNumber(f?.gs);
  const heading = toFiniteNumber(f?.track) || 0;
  const isHeli = HELI_TYPES.has(modelUpper);
  const isGrounded = typeof altRaw === 'number' && altRaw < 100;
  const airlineCode = extractAirlineCode(callsign);

  const category = classifyByTypeCode(String(f?.flight || ''), airlineCode, modelUpper, dbFlags);

  return {
    callsign,
    lat: roundCoordinate(lat),
    lng: roundCoordinate(lon),
    alt: Math.round(altMeters),
    heading: Math.round(heading),
    speed_knots: speedKnots == null ? null : Math.round(speedKnots * 10) / 10,
    model: f?.t || 'Unknown',
    icao24: f?.hex || '',
    registration: f?.r || 'N/A',
    squawk: f?.squawk || '',
    airline_code: airlineCode,
    aircraft_category: isHeli ? 'heli' : 'plane',
    category,
    grounded: isGrounded,
    nac_p: f?.nac_p,
    type: 'flight',
    feed_timestamp: f?.seen_pos == null ? undefined : new Date(Date.now() - Number(f.seen_pos) * 1000).toISOString(),
    feedTimestamp: f?.seen_pos == null ? undefined : new Date(Date.now() - Number(f.seen_pos) * 1000).toISOString(),
    source: 'ADS-B / adsb.lol',
  };
}

function buildFlightFeed(aircraft: AircraftRecord[], timestamp: string, totalOverride?: number): FlightFeedData {
  const commercial: AircraftRecord[] = [];
  const privateFlights: AircraftRecord[] = [];
  const jets: AircraftRecord[] = [];
  const military: AircraftRecord[] = [];
  const gpsJammingCandidates: Array<{ lat: number; lng: number; nac_p: number; callsign: string }> = [];

  for (const flight of aircraft) {
    if (typeof flight.nac_p === 'number' && flight.nac_p <= JAMMING_NACAP_THRESHOLD && !flight.grounded) {
      gpsJammingCandidates.push({
        lat: flight.lat,
        lng: flight.lng,
        nac_p: flight.nac_p,
        callsign: flight.callsign,
      });
    }

    switch (flight.category) {
      case 'military':
        military.push(flight);
        break;
      case 'jet':
        jets.push(flight);
        break;
      case 'private':
        privateFlights.push(flight);
        break;
      default:
        commercial.push(flight);
        break;
    }
  }

  return {
    commercial_flights: commercial,
    private_flights: privateFlights,
    private_jets: jets,
    military_flights: military,
    gps_jamming: aggregateJamming(gpsJammingCandidates),
    total: totalOverride ?? aircraft.length,
    timestamp,
  };
}

function emptyFlightData(nowMs: number = Date.now()): FlightFeedData {
  return {
    commercial_flights: [],
    private_flights: [],
    private_jets: [],
    military_flights: [],
    gps_jamming: [],
    total: 0,
    timestamp: new Date(nowMs).toISOString(),
  };
}

async function getOpenSkyAccessToken(options: ProviderOptions & { forceRefresh?: boolean }): Promise<string> {
  const env = options.env ?? process.env;
  const fetcher = options.fetcher ?? fetch;
  const nowMs = options.nowMs ?? Date.now();
  const timeoutMs = options.timeoutMs ?? 20_000;
  const clientId = env.OPENSKY_CLIENT_ID?.trim();
  const clientSecret = env.OPENSKY_CLIENT_SECRET?.trim();

  if (!clientId || !clientSecret) {
    throw new Error('OpenSky credentials are not configured');
  }

  if (!options.forceRefresh && openSkyTokenCache && openSkyTokenCache.expiresAtMs > nowMs + 30_000) {
    return openSkyTokenCache.token;
  }

  const { url, init } = createOpenSkyTokenRequest(clientId, clientSecret);
  const res = await fetcher(url, {
    ...init,
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) {
    throw new Error(`OpenSky token request failed with HTTP ${res.status}`);
  }

  const payload = await res.json();
  const token = typeof payload?.access_token === 'string' ? payload.access_token : '';
  if (!token) throw new Error('OpenSky token response did not include an access token');

  const expiresInSeconds = typeof payload?.expires_in === 'number' ? payload.expires_in : 1800;
  openSkyTokenCache = {
    token,
    expiresAtMs: nowMs + Math.max(60, expiresInSeconds - 30) * 1000,
  };
  return token;
}

async function fetchAdsbRegion(region: typeof REGIONS[number], fetcher: FetchLike, timeoutMs: number): Promise<AdsbAircraft[]> {
  return fetchAdsbUrl(`https://api.adsb.lol/v2/lat/${region.lat}/lon/${region.lon}/dist/${region.dist}`, fetcher, timeoutMs);
}

/** adsb.lol's worldwide military feed, independent of the regional circles. */
async function fetchAdsbMilitary(fetcher: FetchLike, timeoutMs: number): Promise<AdsbAircraft[]> {
  return fetchAdsbUrl('https://api.adsb.lol/v2/mil', fetcher, timeoutMs);
}

async function fetchAdsbUrl(url: string, fetcher: FetchLike, timeoutMs: number): Promise<AdsbAircraft[]> {
  const res = await fetcher(url, {
    headers: { 'User-Agent': 'Sentra Mi8/1.0' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`adsb.lol request failed with HTTP ${res.status}`);
  const data = await res.json();
  return Array.isArray(data?.ac) ? data.ac as AdsbAircraft[] : [];
}

function aggregateJamming(points: Array<{ lat: number; lng: number; nac_p: number }>) {
  if (points.length === 0) return [];
  const grid = new Map<string, { lat: number; lng: number; count: number; total_nac_p: number }>();
  const gridSize = 2;

  for (const p of points) {
    const gLat = Math.floor(p.lat / gridSize) * gridSize;
    const gLng = Math.floor(p.lng / gridSize) * gridSize;
    const key = `${gLat},${gLng}`;

    if (!grid.has(key)) {
      grid.set(key, { lat: gLat + gridSize / 2, lng: gLng + gridSize / 2, count: 0, total_nac_p: 0 });
    }
    const cell = grid.get(key)!;
    cell.count++;
    cell.total_nac_p += p.nac_p;
  }

  return Array.from(grid.values())
    .filter((zone) => zone.count >= 3)
    .map((zone) => ({
      lat: zone.lat,
      lng: zone.lng,
      severity: Math.round((1 - (zone.total_nac_p / zone.count) / JAMMING_NACAP_THRESHOLD) * 100),
      count: zone.count,
    }));
}

function extractAirlineCode(callsign: string): string {
  const airlineMatch = AIRLINE_CODE_RE.exec(callsign);
  return airlineMatch ? airlineMatch[1] : '';
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value;
}

function roundCoordinate(value: number): number {
  return Math.round(value * 100000) / 100000;
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, '');
}

function hasValue(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return 'unknown error';
}
