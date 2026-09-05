export interface AircraftPhotoQuery {
  registration?: string | null;
  model?: string | null;
  icao24?: string | null;
  callsign?: string | null;
}

export type AircraftPhotoSource = 'Planespotters.net' | 'Wikimedia Commons';

export interface AircraftPhotoResult {
  imageUrl: string | null;
  sourceName: AircraftPhotoSource;
  sourceUrl: string | null;
  attribution: string | null;
  license: string | null;
  query: string;
  fallback: boolean;
}

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
type JsonObject = Record<string, unknown>;

const COMMONS_API_URL = 'https://commons.wikimedia.org/w/api.php';
const PLANESPOTTERS_HEX_URL = 'https://api.planespotters.net/pub/photos/hex/';
const PLANESPOTTERS_REG_URL = 'https://api.planespotters.net/pub/photos/reg/';
const PLANESPOTTERS_UA = 'SentraMi8/1.0 (+https://github.com/aidenmi8/sentra-Y)';

function clean(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim();
}

function normalizeIcao24(value: unknown): string {
  const hex = clean(value).toLowerCase().replace(/[^0-9a-f]/g, '');
  return hex.length >= 4 && hex.length <= 8 ? hex : '';
}

function normalizeModel(value: unknown): string {
  const cleaned = clean(value).toUpperCase();
  if (!cleaned || /^(N\/A|UNKNOWN|NULL|UNDEFINED)$/.test(cleaned)) return '';
  return cleaned;
}

function inferRegistration(registration?: string | null, callsign?: string | null): string {
  const fromField = clean(registration).toUpperCase();
  if (fromField && !/^(N\/A|UNKNOWN|NULL|UNDEFINED)$/.test(fromField)) return fromField;
  const fromCallsign = clean(callsign).toUpperCase().replace(/\s+/g, '');
  if (/^N[1-9][A-Z0-9]{0,4}$/.test(fromCallsign)) return fromCallsign;
  if (/^[A-Z]{1,2}-[A-Z0-9]{3,5}$/.test(fromCallsign)) return fromCallsign;
  if (/^[A-Z]{3}\d/.test(fromCallsign)) return '';
  return '';
}

function stripHtml(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const stripped = value
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
  return stripped || null;
}

function safeHttpUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function fallback(query: string, sourceName: AircraftPhotoSource = 'Wikimedia Commons'): AircraftPhotoResult {
  return {
    imageUrl: null,
    sourceName,
    sourceUrl: null,
    attribution: null,
    license: null,
    query,
    fallback: true,
  };
}

export function buildAircraftPhotoQueries(input: AircraftPhotoQuery): string[] {
  const queries: string[] = [];
  const registration = inferRegistration(input.registration, input.callsign);
  const model = normalizeModel(input.model);

  if (registration) queries.push(registration);
  if (model) queries.push(`${model} aircraft`);
  // Never search Commons with a raw ICAO hex: "a2653c aircraft" misses, and
  // "N25315" without an aircraft filter has returned unrelated historical photos.

  return Array.from(new Set(queries));
}

function objectValue(value: unknown): JsonObject | null {
  return value && typeof value === 'object' ? value as JsonObject : null;
}

function looksLikeAircraftCommonsHit(page: JsonObject | null, query: string): boolean {
  const title = clean(page?.title).toLowerCase();
  if (!title) return false;
  const needle = query.toLowerCase().replace(/\s+aircraft$/, '');
  if (needle && title.includes(needle.toLowerCase())) return true;
  return /\b(aircraft|airplane|airliner|boeing|airbus|cessna|piper|embraer|bombardier|gulfstream|helicopter|socata)\b/i.test(title);
}

export function selectPlanespottersPhoto(payload: unknown, query: string): AircraftPhotoResult {
  const root = objectValue(payload);
  const photos = Array.isArray(root?.photos) ? root.photos : [];
  for (const raw of photos) {
    const photo = objectValue(raw);
    const large = objectValue(photo?.thumbnail_large);
    const thumb = objectValue(photo?.thumbnail);
    const imageUrl = safeHttpUrl(large?.src) || safeHttpUrl(thumb?.src);
    if (!imageUrl) continue;
    const photographer = clean(photo?.photographer) || null;
    return {
      imageUrl,
      sourceName: 'Planespotters.net',
      sourceUrl: safeHttpUrl(photo?.link),
      attribution: photographer,
      license: photographer ? `Photo © ${photographer}` : null,
      query,
      fallback: false,
    };
  }
  return fallback(query, 'Planespotters.net');
}

export function selectCommonsImage(payload: unknown, query: string): AircraftPhotoResult {
  const root = objectValue(payload);
  const queryData = objectValue(root?.query);
  const pages = queryData?.pages;
  const pageList = Array.isArray(pages)
    ? pages
    : pages && typeof pages === 'object'
      ? Object.values(pages as JsonObject)
      : [];

  for (const pageValue of pageList) {
    const page = objectValue(pageValue);
    if (!looksLikeAircraftCommonsHit(page, query)) continue;
    const imageInfo = Array.isArray(page?.imageinfo) ? page.imageinfo : [];
    const info = objectValue(imageInfo[0]);
    const extmetadata = objectValue(info?.extmetadata);
    const artist = objectValue(extmetadata?.Artist);
    const license = objectValue(extmetadata?.LicenseShortName);
    const imageUrl = safeHttpUrl(info?.url);
    if (!imageUrl) continue;

    return {
      imageUrl,
      sourceName: 'Wikimedia Commons',
      sourceUrl: safeHttpUrl(info?.descriptionurl),
      attribution: stripHtml(artist?.value),
      license: stripHtml(license?.value),
      query,
      fallback: false,
    };
  }

  return fallback(query);
}

async function fetchJson(fetchImpl: FetchLike, url: string, headers: Record<string, string>): Promise<unknown | null> {
  try {
    const response = await fetchImpl(url, {
      headers,
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

async function fetchPlanespottersPhoto(
  kind: 'hex' | 'reg',
  value: string,
  fetchImpl: FetchLike,
): Promise<AircraftPhotoResult | null> {
  const base = kind === 'hex' ? PLANESPOTTERS_HEX_URL : PLANESPOTTERS_REG_URL;
  const payload = await fetchJson(fetchImpl, `${base}${encodeURIComponent(value)}`, {
    Accept: 'application/json',
    'User-Agent': PLANESPOTTERS_UA,
  });
  if (!payload) return null;
  const selected = selectPlanespottersPhoto(payload, value);
  return selected.imageUrl ? selected : null;
}

export async function fetchWikimediaAircraftPhoto(
  input: AircraftPhotoQuery,
  fetchImpl: FetchLike = fetch,
  apiUrl = COMMONS_API_URL,
): Promise<AircraftPhotoResult> {
  const queries = buildAircraftPhotoQueries(input);
  const firstQuery = queries[0] || '';
  if (queries.length === 0) return fallback('');

  for (const query of queries) {
    const searchTerm = /\baircraft\b/i.test(query) ? query : `${query} aircraft`;
    const params = new URLSearchParams({
      action: 'query',
      generator: 'search',
      gsrnamespace: '6',
      gsrlimit: '5',
      gsrsearch: searchTerm,
      prop: 'imageinfo',
      iiprop: 'url|extmetadata',
      format: 'json',
      formatversion: '2',
    });

    const payload = await fetchJson(fetchImpl, `${apiUrl}?${params}`, {
      Accept: 'application/json',
      'User-Agent': PLANESPOTTERS_UA,
    });
    if (!payload) continue;
    const selected = selectCommonsImage(payload, query);
    if (selected.imageUrl) return selected;
  }

  return fallback(firstQuery);
}

export async function fetchAircraftPhoto(
  input: AircraftPhotoQuery,
  fetchImpl: FetchLike = fetch,
): Promise<AircraftPhotoResult> {
  const icao24 = normalizeIcao24(input.icao24);
  const registration = inferRegistration(input.registration, input.callsign);

  if (icao24) {
    const byHex = await fetchPlanespottersPhoto('hex', icao24, fetchImpl);
    if (byHex) return byHex;
  }
  if (registration) {
    const byReg = await fetchPlanespottersPhoto('reg', registration, fetchImpl);
    if (byReg) return byReg;
  }

  return fetchWikimediaAircraftPhoto(input, fetchImpl);
}
