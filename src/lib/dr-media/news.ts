/**
 * Sentra Mi8 — Dominican Republic news normalizer (Phase 1: Diario Libre).
 *
 * Reads the outlet's public RSS. DR feeds date items in Spanish (RFC-822 shape
 * but "Ago" not "Aug"), which JS Date parses as Invalid — so every item carries
 * an explicit `published_basis` and `published_utc` is null rather than a
 * fabricated timestamp when the date cannot be parsed. The clock we attest to is
 * the capture time, recorded later by the evidence layer; the feed's own date is
 * a claim, labelled as such.
 */

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface DrNewsItem {
  id: string;
  title: string;
  link: string;
  summary: string;
  published_raw: string | null;
  published_utc: string | null;
  published_basis: 'rfc822-spanish-month' | 'rfc822' | 'iso' | 'unparseable';
  source: string;
  source_url: string;
}

export interface DrNewsSource {
  id: string;
  name: string;
  url: string;
}

/** Diario Libre front page. Additional sections/outlets arrive in Phase 2. */
export const DR_NEWS_SOURCES: DrNewsSource[] = [
  { id: 'diariolibre', name: 'Diario Libre', url: 'https://www.diariolibre.com/rss/portada.xml' },
];

export const DR_NEWS_CACHE_TTL_MS = 5 * 60 * 1000;

const DR_NEWS_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Accept: 'application/rss+xml, application/xml, text/xml, */*',
};

const SPANISH_MONTHS: Record<string, string> = {
  ene: 'Jan', feb: 'Feb', mar: 'Mar', abr: 'Apr', may: 'May', jun: 'Jun',
  jul: 'Jul', ago: 'Aug', sep: 'Sep', set: 'Sep', oct: 'Oct', nov: 'Nov', dic: 'Dec',
};

/**
 * Parses a feed date. Returns the UTC ISO string plus how it was derived — or
 * null with `unparseable` rather than inventing a time.
 */
export function parseDrDate(raw: string | null | undefined): { iso: string | null; basis: DrNewsItem['published_basis'] } {
  if (!raw || !raw.trim()) return { iso: null, basis: 'unparseable' };
  const value = raw.trim();

  // Plain attempt first (handles ISO and English RFC-822).
  const direct = Date.parse(value);
  if (!Number.isNaN(direct)) {
    return { iso: new Date(direct).toISOString(), basis: /^\d{4}-\d{2}-\d{2}/.test(value) ? 'iso' : 'rfc822' };
  }

  // Replace a Spanish month token with its English equivalent and retry.
  const swapped = value.replace(/\b([A-Za-zÁÉÍÓÚáéíóú]{3,4})\b/g, (m) => {
    const key = m.toLowerCase().replace(/\.$/, '').slice(0, 3);
    return SPANISH_MONTHS[key] ?? m;
  });
  if (swapped !== value) {
    const retry = Date.parse(swapped);
    if (!Number.isNaN(retry)) return { iso: new Date(retry).toISOString(), basis: 'rfc822-spanish-month' };
  }

  return { iso: null, basis: 'unparseable' };
}

function getTag(itemXml: string, tag: string): string {
  const m = itemXml.match(
    new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>|<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'),
  );
  return (m ? (m[1] ?? m[2] ?? '') : '').trim();
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&#0*39;/g, "'").replace(/&apos;/gi, "'")
    .replace(/&nbsp;/gi, ' ')
    // Numeric character references — essential for Spanish accents (&#243; = ó,
    // &#241; = ñ). Decimal and hex forms; invalid/out-of-range code points are
    // left verbatim rather than throwing.
    .replace(/&#x([0-9a-f]+);/gi, (m, hex) => codePointOrLiteral(parseInt(hex, 16), m))
    .replace(/&#(\d+);/g, (m, dec) => codePointOrLiteral(parseInt(dec, 10), m))
    // &amp; is decoded last so a double-encoded &amp;lt; / &amp;#243; stays literal.
    .replace(/&amp;/gi, '&');
}

function codePointOrLiteral(code: number, original: string): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return original;
  try {
    return String.fromCodePoint(code);
  } catch {
    return original;
  }
}

function stripHtml(s: string): string {
  // Decode entity-encoded markup first (DR feeds ship &lt;p&gt;… in descriptions),
  // then strip real tags. Diario Libre's CMS routinely DOUBLE-encodes — e.g.
  // `64 &#38;#37;` for a literal `%` (the `&` itself entity-encoded). One extra
  // decode pass resolves that; capped at two passes so it can never loop, and
  // tags are stripped only after the final decode so a double-encoded <tag>
  // cannot survive as markup.
  let decoded = decodeEntities(s);
  const second = decodeEntities(decoded);
  if (second !== decoded) decoded = second;
  return decoded.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

export function parseDrNews(xml: string, source: DrNewsSource): DrNewsItem[] {
  const items: DrNewsItem[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match: RegExpExecArray | null;
  while ((match = itemRegex.exec(xml)) !== null) {
    const itemXml = match[1];
    const link = getTag(itemXml, 'link');
    const title = stripHtml(getTag(itemXml, 'title'));
    if (!link || !title) continue;

    const raw = getTag(itemXml, 'pubDate') || getTag(itemXml, 'dc:date') || null;
    const { iso, basis } = parseDrDate(raw);

    items.push({
      // Stable id from the durable identity of the article (link), not its date.
      id: `drnews-${source.id}-${hashId(link)}`,
      title,
      link,
      summary: stripHtml(getTag(itemXml, 'description')).slice(0, 500),
      published_raw: raw,
      published_utc: iso,
      published_basis: basis,
      source: source.name,
      source_url: source.url,
    });
  }
  return items;
}

/** Small deterministic id — avoids importing crypto into the pure-parse path. */
function hashId(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(16);
}

let cache: { items: DrNewsItem[]; expiresAt: number } | null = null;

export interface DrNewsFeed {
  items: DrNewsItem[];
  sources: Array<{ id: string; name: string; state: 'ok' | 'degraded'; count: number; status?: number; error?: string }>;
  degraded: boolean;
  timestamp: string;
}

export async function fetchDrNews(options: { fetcher?: FetchLike; force?: boolean } = {}): Promise<DrNewsFeed> {
  const fetcher = options.fetcher ?? fetch;
  if (!options.force && cache && cache.expiresAt > Date.now()) {
    return { items: cache.items, sources: [], degraded: false, timestamp: new Date().toISOString() };
  }

  const items: DrNewsItem[] = [];
  const sources: DrNewsFeed['sources'] = [];

  await Promise.all(
    DR_NEWS_SOURCES.map(async (src) => {
      try {
        const res = await fetcher(src.url, { headers: DR_NEWS_HEADERS, signal: AbortSignal.timeout(15000) });
        if (!res.ok) {
          // A dead feed is reported with its real status, never dropped to a fake zero.
          sources.push({ id: src.id, name: src.name, state: 'degraded', count: 0, status: res.status });
          return;
        }
        const parsed = parseDrNews(await res.text(), src);
        items.push(...parsed);
        sources.push({ id: src.id, name: src.name, state: 'ok', count: parsed.length });
      } catch (error) {
        sources.push({
          id: src.id, name: src.name, state: 'degraded', count: 0,
          error: error instanceof Error ? error.message : 'fetch failed',
        });
      }
    }),
  );

  // Newest first where we have a parsed time; undated items sink to the end.
  items.sort((a, b) => (b.published_utc || '').localeCompare(a.published_utc || ''));

  if (items.length > 0) cache = { items, expiresAt: Date.now() + DR_NEWS_CACHE_TTL_MS };
  return { items, sources, degraded: sources.some((s) => s.state === 'degraded'), timestamp: new Date().toISOString() };
}

export function resetDrNewsCache(): void {
  cache = null;
}
