export type IptvStreamType = 'hls' | 'video' | 'iframe' | 'external';

export interface IptvChannel {
  id: string;
  name: string;
  countryCode: string;
  logo?: string;
  group: string;
  streamUrl: string;
  streamType: IptvStreamType;
  source: 'iptv-org';
  sourceUrl: string;
}

export interface IptvCountry {
  name: string;
  code: string;
  languages: string[];
  flag: string;
}

interface CacheEntry<T> {
  data: T;
  fetchedAt: number;
  sourceUrl: string;
}

interface ParseOptions {
  countryCode: string;
  sourceUrl: string;
}

const DEFAULT_BASE_URL = 'https://iptv-org.github.io';
const COUNTRY_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CHANNEL_CACHE_TTL_MS = 60 * 60 * 1000;
const countriesCache: { entry?: CacheEntry<IptvCountry[]> } = {};
const channelCache = new Map<string, CacheEntry<IptvChannel[]>>();

const ADULT_MARKERS = ['xxx', 'adult', 'porn', 'erotic', 'nsfw'];
const VIDEO_EXTENSIONS = /\.(mp4|m4v|webm|ogv|ogg|mov|ts)(?:[?#].*)?$/i;
const HLS_EXTENSION = /\.m3u8(?:[?#].*)?$/i;
const IFRAME_HOSTS = /(?:youtube(?:-nocookie)?\.com\/embed|player\.vimeo\.com|rumble\.com\/embed)/i;

export function normalizeCountryCode(input: string | null | undefined): string | null {
  const code = (input || '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : null;
}

export function inferIptvStreamType(url: string): IptvStreamType {
  if (HLS_EXTENSION.test(url)) return 'hls';
  if (VIDEO_EXTENSIONS.test(url)) return 'video';
  if (IFRAME_HOSTS.test(url)) return 'iframe';
  return 'external';
}

export function getIptvBaseUrl(): string {
  return (process.env.IPTV_ORG_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

export function getIptvCountriesUrl(): string {
  return `${getIptvBaseUrl()}/api/countries.json`;
}

export function getIptvCountryPlaylistUrl(countryCode: string): string {
  return `${getIptvBaseUrl()}/iptv/countries/${countryCode.toLowerCase()}.m3u`;
}

export function parseIptvPlaylist(m3u: string, options: ParseOptions): IptvChannel[] {
  const countryCode = normalizeCountryCode(options.countryCode);
  if (!countryCode) return [];

  const channels: IptvChannel[] = [];
  const seenUrls = new Set<string>();
  let pending: { attrs: Record<string, string>; title: string } | null = null;

  for (const rawLine of m3u.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith('#EXTINF')) {
      pending = parseExtinf(line);
      continue;
    }

    if (line.startsWith('#') || !pending) continue;
    const streamUrl = normalizeHttpUrl(line);
    if (!streamUrl || seenUrls.has(streamUrl)) {
      pending = null;
      continue;
    }

    const attrs = pending.attrs;
    const name = cleanText(attrs['tvg-name'] || pending.title || attrs.name || 'IPTV Channel');
    const group = cleanText(attrs['group-title'] || 'Uncategorized');
    if (isAdultChannel(name, group)) {
      pending = null;
      continue;
    }

    const logo = normalizeHttpUrl(attrs['tvg-logo']);
    const idSeed = attrs['tvg-id'] || `${name}-${streamUrl}`;
    const channel: IptvChannel = {
      id: `iptv-${countryCode.toLowerCase()}-${slugify(name)}-${hashString(idSeed + streamUrl)}`,
      name,
      countryCode,
      ...(logo ? { logo } : {}),
      group,
      streamUrl,
      streamType: inferIptvStreamType(streamUrl),
      source: 'iptv-org',
      sourceUrl: options.sourceUrl,
    };

    channels.push(channel);
    seenUrls.add(streamUrl);
    pending = null;
  }

  return channels;
}

export async function fetchIptvCountries(options: { refresh?: boolean } = {}) {
  const now = Date.now();
  if (
    !options.refresh &&
    countriesCache.entry &&
    now - countriesCache.entry.fetchedAt < COUNTRY_CACHE_TTL_MS
  ) {
    return { countries: countriesCache.entry.data, cached: true, sourceUrl: countriesCache.entry.sourceUrl };
  }

  const sourceUrl = getIptvCountriesUrl();
  try {
    const res = await fetchWithTimeout(sourceUrl, 10000);
    if (!res.ok) throw new Error(`iptv-org countries returned ${res.status}`);
    const raw = await res.json();
    const countries = normalizeCountries(raw);
    countriesCache.entry = { data: countries, fetchedAt: now, sourceUrl };
    return { countries, cached: false, sourceUrl };
  } catch (error) {
    if (countriesCache.entry) {
      return {
        countries: countriesCache.entry.data,
        cached: true,
        stale: true,
        sourceUrl: countriesCache.entry.sourceUrl,
        warning: error instanceof Error ? error.message : 'Failed to refresh countries',
      };
    }
    throw error;
  }
}

export async function fetchIptvChannels(countryCode: string, options: { refresh?: boolean } = {}) {
  const normalized = normalizeCountryCode(countryCode);
  if (!normalized) throw new Error('Invalid country code');

  const now = Date.now();
  const cached = channelCache.get(normalized);
  if (!options.refresh && cached && now - cached.fetchedAt < CHANNEL_CACHE_TTL_MS) {
    return { channels: cached.data, cached: true, sourceUrl: cached.sourceUrl };
  }

  const sourceUrl = getIptvCountryPlaylistUrl(normalized);
  try {
    const res = await fetchWithTimeout(sourceUrl, 12000);
    if (!res.ok) throw new Error(`iptv-org playlist returned ${res.status}`);
    const m3u = await res.text();
    const channels = parseIptvPlaylist(m3u, { countryCode: normalized, sourceUrl });
    channelCache.set(normalized, { data: channels, fetchedAt: now, sourceUrl });
    return { channels, cached: false, sourceUrl };
  } catch (error) {
    if (cached) {
      return {
        channels: cached.data,
        cached: true,
        stale: true,
        sourceUrl: cached.sourceUrl,
        warning: error instanceof Error ? error.message : 'Failed to refresh playlist',
      };
    }
    throw error;
  }
}

function parseExtinf(line: string) {
  const attrs: Record<string, string> = {};
  const attrPattern = /([\w-]+)="([^"]*)"/g;
  let match: RegExpExecArray | null;
  while ((match = attrPattern.exec(line)) !== null) {
    attrs[match[1]] = decodeEntities(match[2]);
  }
  const commaIndex = findExtinfTitleComma(line);
  const title = commaIndex >= 0 ? decodeEntities(line.slice(commaIndex + 1).trim()) : '';
  return { attrs, title };
}

function findExtinfTitleComma(line: string): number {
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') inQuotes = !inQuotes;
    if (char === ',' && !inQuotes) return i;
  }
  return -1;
}

function normalizeHttpUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

function normalizeCountries(raw: unknown): IptvCountry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry: unknown) => {
      const country = asRecord(entry);
      const name = typeof country.name === 'string' ? country.name : '';
      const code = typeof country.code === 'string' ? country.code : '';
      return {
        name: cleanText(name),
        code: normalizeCountryCode(code) || '',
        languages: Array.isArray(country.languages) ? country.languages.filter((item: unknown) => typeof item === 'string') : [],
        flag: typeof country.flag === 'string' ? country.flag : '',
      };
    })
    .filter((country) => country.name && country.code)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
}

function isAdultChannel(name: string, group: string): boolean {
  const haystack = `${name} ${group}`.toLowerCase();
  return ADULT_MARKERS.some((marker) => haystack.includes(marker));
}

function cleanText(value: string): string {
  return decodeEntities(value).replace(/\s+/g, ' ').trim();
}

function decodeEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return slug || 'channel';
}

function hashString(value: string): string {
  let hash = 5381;
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  return fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    cache: 'no-store',
    headers: {
      Accept: 'application/json,text/plain,*/*',
      'User-Agent': 'Sentra Mi8 IPTV country feed loader',
    },
  });
}
