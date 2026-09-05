export interface VesselPhotoQuery {
  name?: string | null;
  imo?: string | number | null;
  mmsi?: string | number | null;
  type?: string | null;
}

export interface VesselPhotoResult {
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
const UA = 'SentraMi8/1.0 (+https://github.com/aidenmi8/sentra-Y)';

function clean(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return '';
  return value.replace(/@+$/g, '').trim();
}

function objectValue(value: unknown): JsonObject | null {
  return value && typeof value === 'object' ? value as JsonObject : null;
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

function stripHtml(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const stripped = value.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').trim();
  return stripped || null;
}

function fallback(query: string): VesselPhotoResult {
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

export function buildVesselPhotoQueries(input: VesselPhotoQuery): string[] {
  const queries: string[] = [];
  const name = clean(input.name);
  const imo = clean(input.imo);
  if (name && !/^(unidentified|unknown|vessel)$/i.test(name) && !/^\d+$/.test(name)) {
    queries.push(`${name} ship`);
    queries.push(`${name} vessel`);
  }
  if (imo && /^\d{7}$/.test(imo)) queries.push(`IMO ${imo}`);
  const type = clean(input.type).toLowerCase();
  if (type === 'tanker') queries.push('oil tanker ship');
  else if (type === 'passenger') queries.push('cruise ship');
  else if (type === 'fishing') queries.push('fishing vessel');
  else if (type === 'military') queries.push('naval warship');
  else if (type === 'cargo' || type === 'other' || type === 'high-speed') queries.push('container ship');
  return Array.from(new Set(queries));
}

const PHOTO_STOP_WORDS = new Set([
  'ship', 'ships', 'vessel', 'vessels', 'oil', 'tanker', 'cruise', 'container',
  'the', 'a', 'an', 'of', 'and', 'imo',
]);

function looksLikeVesselCommonsHit(page: JsonObject | null, query: string): boolean {
  const title = clean(page?.title).toLowerCase();
  if (!title) return false;
  const needle = query.toLowerCase().replace(/\s+(ship|vessel)$/, '').trim();
  if (!needle) return false;
  const imo = needle.match(/^imo\s+(\d{7})$/);
  if (imo) return title.includes(imo[1]);
  if (!/\b(ship|vessel|tanker|ferry|freighter|container|imo|bulk|carrier|lng|cruise|mv|ms)\b/i.test(title)) {
    return false;
  }
  const tokens = needle.split(/\s+/).filter((token) => token.length > 1 && !PHOTO_STOP_WORDS.has(token));
  if (tokens.length === 0) return false;
  return tokens.every((token) => title.includes(token));
}

export function selectVesselCommonsImage(payload: unknown, query: string): VesselPhotoResult {
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
    if (!looksLikeVesselCommonsHit(page, query)) continue;
    const imageInfo = Array.isArray(page?.imageinfo) ? page.imageinfo : [];
    const info = objectValue(imageInfo[0]);
    const imageUrl = safeHttpUrl(info?.url);
    if (!imageUrl) continue;
    const extmetadata = objectValue(info?.extmetadata);
    const artist = objectValue(extmetadata?.Artist);
    const license = objectValue(extmetadata?.LicenseShortName);
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

export async function fetchVesselPhoto(
  input: VesselPhotoQuery,
  fetchImpl: FetchLike = fetch,
): Promise<VesselPhotoResult> {
  const queries = buildVesselPhotoQueries(input);
  const first = queries[0] || '';
  if (!first) return fallback('');

  for (const query of queries) {
    const params = new URLSearchParams({
      action: 'query',
      generator: 'search',
      gsrnamespace: '6',
      gsrlimit: '5',
      gsrsearch: query,
      prop: 'imageinfo',
      iiprop: 'url|extmetadata',
      format: 'json',
      formatversion: '2',
    });
    try {
      const response = await fetchImpl(`${COMMONS_API_URL}?${params}`, {
        headers: { Accept: 'application/json', 'User-Agent': UA },
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) continue;
      const selected = selectVesselCommonsImage(await response.json(), query);
      if (selected.imageUrl) return selected;
    } catch {
      continue;
    }
  }
  return fallback(first);
}
