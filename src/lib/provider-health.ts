export type ProviderState = 'configured' | 'missing_optional' | 'keyless' | 'disabled' | 'planned';

export interface ProviderStatus {
  id: string;
  name: string;
  category: 'ai' | 'data' | 'scanner' | 'ingest' | 'webhook' | 'analytics' | 'runtime';
  state: ProviderState;
  required: boolean;
  env: string[];
  routes: string[];
  message: string;
}

export interface ProviderHealthSummary {
  total: number;
  configured: number;
  keyless: number;
  disabled: number;
  missing_optional: number;
  planned: number;
}

export interface ProviderHealthResponse {
  platform: 'Sentra Mi8';
  timestamp: string;
  summary: ProviderHealthSummary;
  providers: ProviderStatus[];
}

type EnvLike = Record<string, string | undefined>;

const DEFAULT_TELEGRAM_CHANNELS = ['OSINTtechnical', 'Faytuks', 'Liveuamap', 'CyberKnow'];

export function parseTelegramChannels(env: EnvLike = process.env): string[] {
  const raw = env.SENTRA_MI8_TELEGRAM_CHANNELS || env.OSIRIS_TELEGRAM_CHANNELS || '';
  if (!raw.trim()) return [...DEFAULT_TELEGRAM_CHANNELS];
  const channels = raw
    .split(',')
    .map((channel) => channel.trim().replace(/^@+/, ''))
    .filter(Boolean);
  return channels.length > 0 ? channels : [...DEFAULT_TELEGRAM_CHANNELS];
}

export function buildProviderHealth(env: EnvLike = process.env): ProviderHealthResponse {
  const geminiCount = countGeminiKeys(env);
  const telegramConfigured = hasValue(env.SENTRA_MI8_TELEGRAM_CHANNELS) || hasValue(env.OSIRIS_TELEGRAM_CHANNELS);
  const openSkyConfigured = hasValue(env.OPENSKY_CLIENT_ID) && hasValue(env.OPENSKY_CLIENT_SECRET);
  const openSkyPartial = hasValue(env.OPENSKY_CLIENT_ID) || hasValue(env.OPENSKY_CLIENT_SECRET);
  const providers: ProviderStatus[] = [
    {
      id: 'public-feeds',
      name: 'Keyless Public Data Feeds',
      category: 'data',
      state: 'keyless',
      required: false,
      env: [],
      routes: [
        '/api/flights',
        '/api/aircraft/photo',
        '/api/satellites',
        '/api/earthquakes',
        '/api/fires',
        '/api/weather',
        '/api/news',
        '/api/gdelt',
        '/api/markets',
      ],
      message: 'Core map and intelligence feeds use public sources without subscription keys.',
    },
    {
      id: 'gemini',
      name: 'Gemini AI Intelligence',
      category: 'ai',
      state: geminiCount > 0 ? 'configured' : 'missing_optional',
      required: false,
      env: Array.from({ length: 8 }, (_, index) => `GEMINI_API_KEY_${index + 1}`),
      routes: ['/api/ai/analyze', '/api/ai/briefing'],
      message: geminiCount > 0
        ? `${geminiCount} Gemini key${geminiCount === 1 ? '' : 's'} configured for server-side AI rotation.`
        : 'No server Gemini key configured; users may still provide a key in the AI panel.',
    },
    {
      id: 'aisstream',
      name: 'AISStream Maritime Live Feed',
      category: 'data',
      state: hasValue(env.AIS_API_KEY) ? 'configured' : 'missing_optional',
      required: false,
      env: ['AIS_API_KEY'],
      routes: ['/api/maritime'],
      message: hasValue(env.AIS_API_KEY)
        ? 'Live AIS WebSocket subscription key is configured.'
        : 'AIS key is not configured; maritime route falls back to static ports and cached live data if present.',
    },
    {
      id: 'scanner',
      name: 'Sentra Mi8 RECON Scanner',
      category: 'scanner',
      state: hasValue(env.SCANNER_URL) && hasValue(env.SCANNER_KEY)
        ? 'configured'
        : hasValue(env.SCANNER_URL) || hasValue(env.SCANNER_KEY)
          ? 'missing_optional'
          : 'disabled',
      required: false,
      env: ['SCANNER_URL', 'SCANNER_KEY'],
      routes: ['/api/scanner'],
      message: hasValue(env.SCANNER_URL) && hasValue(env.SCANNER_KEY)
        ? 'RECON scanner proxy is configured.'
        : 'RECON scanner is disabled until both scanner URL and shared key are set.',
    },
    {
      id: 'iptv-org',
      name: 'IPTV-org Country Playlists',
      category: 'data',
      state: hasValue(env.IPTV_ORG_BASE_URL) ? 'configured' : 'keyless',
      required: false,
      env: ['IPTV_ORG_BASE_URL'],
      routes: ['/api/iptv/countries', '/api/iptv/channels'],
      message: hasValue(env.IPTV_ORG_BASE_URL)
        ? 'Custom IPTV-org-compatible source override is configured.'
        : 'Using the default public IPTV-org source.',
    },
    {
      id: 'sdk-ingest',
      name: 'External SDK Ingest',
      category: 'ingest',
      state: hasValue(env.SDK_INGEST_KEY) ? 'configured' : 'missing_optional',
      required: false,
      env: ['SDK_INGEST_KEY'],
      routes: ['/api/sdk/ingest', '/api/sdk/stream'],
      message: hasValue(env.SDK_INGEST_KEY)
        ? 'SDK ingest shared key is configured.'
        : 'SDK ingest rejects writes until SDK_INGEST_KEY is set.',
    },
    {
      id: 'github-webhook',
      name: 'GitHub Webhook Bridge',
      category: 'webhook',
      state: hasValue(env.GITHUB_WEBHOOK_SECRET) && hasValue(env.GITHUB_WEBHOOK_FORWARD_URL)
        ? 'configured'
        : hasValue(env.GITHUB_WEBHOOK_SECRET) || hasValue(env.GITHUB_WEBHOOK_FORWARD_URL)
          ? 'missing_optional'
          : 'disabled',
      required: false,
      env: ['GITHUB_WEBHOOK_SECRET', 'GITHUB_WEBHOOK_FORWARD_URL'],
      routes: ['/api/github-webhook'],
      message: hasValue(env.GITHUB_WEBHOOK_SECRET) && hasValue(env.GITHUB_WEBHOOK_FORWARD_URL)
        ? 'Webhook signature verification and forward target are configured.'
        : 'Webhook bridge is disabled until both signature secret and forward URL are set.',
    },
    {
      id: 'umami',
      name: 'Umami Analytics',
      category: 'analytics',
      state: hasValue(env.UMAMI_ENDPOINT) && hasValue(env.UMAMI_WEBSITE_ID)
        ? 'configured'
        : hasValue(env.UMAMI_ENDPOINT) || hasValue(env.UMAMI_WEBSITE_ID)
          ? 'missing_optional'
          : 'disabled',
      required: false,
      env: ['UMAMI_ENDPOINT', 'UMAMI_WEBSITE_ID'],
      routes: ['middleware'],
      message: hasValue(env.UMAMI_ENDPOINT) && hasValue(env.UMAMI_WEBSITE_ID)
        ? 'Analytics event forwarding is configured.'
        : 'Analytics forwarding is disabled until endpoint and website ID are set.',
    },
    {
      id: 'intel-service',
      name: 'Sentra Mi8 Intel Service',
      category: 'runtime',
      state: hasValue(env.SENTRA_MI8_INTEL_URL) || hasValue(env.INTEL_URL) || hasValue(env.OSIRIS_INTEL_URL)
        ? 'configured'
        : 'missing_optional',
      required: false,
      env: ['SENTRA_MI8_INTEL_URL', 'INTEL_URL', 'OSIRIS_INTEL_URL'],
      routes: ['/api/entity/expand'],
      message: hasValue(env.SENTRA_MI8_INTEL_URL) || hasValue(env.INTEL_URL) || hasValue(env.OSIRIS_INTEL_URL)
        ? 'Intel service override is configured.'
        : 'Entity intel uses local fallback data when the optional intel service is unavailable.',
    },
    {
      id: 'telegram-osint',
      name: 'Telegram OSINT Preview Channels',
      category: 'data',
      state: telegramConfigured ? 'configured' : 'keyless',
      required: false,
      env: ['SENTRA_MI8_TELEGRAM_CHANNELS', 'OSIRIS_TELEGRAM_CHANNELS'],
      routes: ['/api/news'],
      message: telegramConfigured
        ? `${parseTelegramChannels(env).length} Telegram preview channel${parseTelegramChannels(env).length === 1 ? '' : 's'} configured.`
        : 'Using curated public Telegram preview channels.',
    },
    {
      id: 'opensky',
      name: 'OpenSky OAuth Aviation',
      category: 'data',
      state: openSkyConfigured ? 'configured' : 'missing_optional',
      required: false,
      env: ['OPENSKY_CLIENT_ID', 'OPENSKY_CLIENT_SECRET'],
      routes: ['/api/flights'],
      message: openSkyConfigured
        ? 'OpenSky OAuth primary aviation provider is configured; adsb.lol remains the keyless fallback.'
        : openSkyPartial
          ? 'OpenSky primary aviation requires both OPENSKY_CLIENT_ID and OPENSKY_CLIENT_SECRET; adsb.lol remains the fallback.'
          : 'OpenSky primary aviation is not configured; /api/flights uses the keyless adsb.lol fallback.',
    },
    {
      id: 'adsb-lol',
      name: 'adsb.lol Aviation Fallback',
      category: 'data',
      state: 'keyless',
      required: false,
      env: [],
      routes: ['/api/flights'],
      message: 'Keyless secondary aviation fallback used when OpenSky is unavailable, empty, rate-limited, or timed out.',
    },
    {
      id: 'dr-news',
      name: 'Dominican Republic News (RSS)',
      category: 'data',
      state: 'keyless',
      required: false,
      env: [],
      routes: ['/api/dr/news'],
      message: 'Keyless DR newspaper RSS across outlets (Diario Libre, El Día, N Digital). Per-source health is reported; a down outlet is flagged degraded, never a silent zero. Unparseable Spanish dates are labelled, never fabricated.',
    },
    {
      id: 'evidence-store',
      name: 'Evidence Capture Store',
      category: 'runtime',
      state: hasValue(env.ENABLE_EVIDENCE_CAPTURE) ? 'configured' : 'disabled',
      required: false,
      env: ['ENABLE_EVIDENCE_CAPTURE', 'SENTRA_EVIDENCE_DIR'],
      routes: ['/api/dr/evidence/capture', '/api/dr/evidence/export'],
      message: hasValue(env.ENABLE_EVIDENCE_CAPTURE)
        ? 'Local tamper-evident evidence store enabled (loopback-only; hash-chained JSONL + content-addressed blobs).'
        : 'Evidence capture is disabled; set ENABLE_EVIDENCE_CAPTURE=true (loopback-only) to record citable snapshots.',
    },
    {
      id: 'osm-surveillance',
      name: 'OpenStreetMap Surveillance Positions',
      category: 'data',
      state: 'keyless',
      required: false,
      env: ['OVERPASS_ENDPOINT'],
      routes: ['/api/cameras/worldwide'],
      message: 'Keyless worldwide camera positions via Overpass. These are mapped camera locations under ODbL, not viewable feeds; queries are viewport-bounded because a global query times out.',
    },
    {
      id: 'windy-webcams',
      name: 'Windy Webcams',
      category: 'data',
      state: hasValue(env.WINDY_API_KEY) ? 'configured' : 'missing_optional',
      required: false,
      env: ['WINDY_API_KEY'],
      routes: ['/api/cameras/worldwide'],
      message: hasValue(env.WINDY_API_KEY)
        ? 'Watchable worldwide public webcams are enabled.'
        : 'No Windy key configured; worldwide cameras fall back to OpenStreetMap positions and existing traffic-authority feeds. Get a free key at https://api.windy.com/keys.',
    },
    {
      id: 'submarine-cables',
      name: 'TeleGeography Submarine Cable Map',
      category: 'data',
      state: 'keyless',
      required: false,
      env: ['SUBMARINE_CABLE_BASE_URL'],
      routes: ['/api/cables'],
      message: 'Keyless open cable geometry and lifecycle data. Operational, under-construction and planned states are sourced; retired/faulted cables are not published by any open feed.',
    },
    {
      id: 'n2yo',
      name: 'N2YO Satellite API',
      category: 'data',
      state: 'planned',
      required: false,
      env: ['N2YO_API_KEY'],
      routes: ['/api/satellites'],
      message: 'Reserved for a later satellite pass-prediction adapter; current satellite route uses public TLE sources.',
    },
    {
      id: 'firms-keyed',
      name: 'NASA FIRMS Keyed API',
      category: 'data',
      state: 'planned',
      required: false,
      env: ['FIRMS_API_KEY'],
      routes: ['/api/fires'],
      message: 'Reserved for a later keyed FIRMS adapter; current fire route uses public FIRMS CSV feeds.',
    },
  ];

  const summary = summarizeProviders(providers);
  return {
    platform: 'Sentra Mi8',
    timestamp: new Date().toISOString(),
    summary,
    providers,
  };
}

function countGeminiKeys(env: EnvLike): number {
  let count = 0;
  for (let i = 1; i <= 8; i++) {
    if (hasValue(env[`GEMINI_API_KEY_${i}`])) count++;
  }
  return count;
}

function hasValue(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function summarizeProviders(providers: ProviderStatus[]): ProviderHealthSummary {
  const summary: ProviderHealthSummary = {
    total: providers.length,
    configured: 0,
    keyless: 0,
    disabled: 0,
    missing_optional: 0,
    planned: 0,
  };

  for (const provider of providers) {
    summary[provider.state]++;
  }

  return summary;
}
