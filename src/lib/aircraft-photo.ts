export interface AircraftPhotoQuery {
  registration?: string | null;
  model?: string | null;
  icao24?: string | null;
}

export interface AircraftPhotoResult {
  imageUrl: string | null;
  sourceName: 'Wikimedia Commons';
  sourceUrl: string | null;
  attribution: string | null;
  license: string | null;
  query: string;
  fallback: boolean;
}

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
type JsonObject = Record<string, unknown>;

const COMMONS_API_URL = 'https://commons.wikimedia.org/w/api.php';

function clean(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim();
}

function normalizeRegistration(value: unknown): string {
  const cleaned = clean(value).toUpperCase();
  if (!cleaned || /^(N\/A|UNKNOWN|NULL|UNDEFINED)$/.test(cleaned)) return '';
  return cleaned;
}

function normalizeModel(value: unknown): string {
  const cleaned = clean(value).toUpperCase();
  if (!cleaned || /^(N\/A|UNKNOWN|NULL|UNDEFINED)$/.test(cleaned)) return '';
  return cleaned;
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

function fallback(query: string): AircraftPhotoResult {
  return {
    imageUrl: null,
    sourceName: 'Wikimedia Commons',
    sourceUrl: null,
    attribution: null,
    license: null,
    query,
    fallback: true,
  };
}

export function buildAircraftPhotoQueries(input: AircraftPhotoQuery): string[] {
  const queries: string[] = [];
  const registration = normalizeRegistration(input.registration);
  const model = normalizeModel(input.model);
  const icao24 = clean(input.icao24).toLowerCase();

  if (registration) queries.push(registration);
  if (model) queries.push(`${model} aircraft`);
  if (!registration && !model && icao24) queries.push(icao24);

  return Array.from(new Set(queries));
}

function objectValue(value: unknown): JsonObject | null {
  return value && typeof value === 'object' ? value as JsonObject : null;
}

export function selectCommonsImage(payload: unknown, query: string): AircraftPhotoResult {
  const root = objectValue(payload);
  const queryData = objectValue(root?.query);
  const pages = objectValue(queryData?.pages);
  if (!pages || typeof pages !== 'object') return fallback(query);

  for (const pageValue of Object.values(pages)) {
    const page = objectValue(pageValue);
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

    try {
      const response = await fetchImpl(`${apiUrl}?${params}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) continue;
      const selected = selectCommonsImage(await response.json(), query);
      if (selected.imageUrl) return selected;
    } catch {
      continue;
    }
  }

  return fallback(firstQuery);
}
