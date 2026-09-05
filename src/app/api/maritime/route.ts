import { NextResponse } from 'next/server';
import WebSocket from 'ws';
import {
  AIS_FEED_BOXES,
  AIS_FEED_IDS,
  AIS_SUBSCRIPTION_MESSAGE_TYPES,
  compactAisShipForMap,
  evictOverflowMmsis,
  hasValidAisCoordinates,
  mergeAisShipUpdate,
  normalizeAisMessage,
  type AisFeedId,
  type NormalizedAisShipUpdate,
} from '@/lib/ais';
import { getProviderEnv } from '@/lib/provider-config';
import { registerCacheReset } from '@/lib/cache-registry';

/**
 * Sentra Mi8 — Maritime Intelligence
 * Real-time AIS vessel tracking via aisstream.io + Static global ports.
 */

const PORTS = [
  // ── Top Container Ports ──
  { name: 'Shanghai', country: 'CN', lat: 31.23, lng: 121.47, type: 'container', volume: '47.3M TEU', rank: 1 },
  { name: 'Singapore', country: 'SG', lat: 1.26, lng: 103.84, type: 'container', volume: '37.2M TEU', rank: 2 },
  { name: 'Ningbo-Zhoushan', country: 'CN', lat: 29.87, lng: 121.55, type: 'container', volume: '33.3M TEU', rank: 3 },
  { name: 'Shenzhen', country: 'CN', lat: 22.54, lng: 114.05, type: 'container', volume: '30.0M TEU', rank: 4 },
  { name: 'Guangzhou', country: 'CN', lat: 23.08, lng: 113.32, type: 'container', volume: '24.2M TEU', rank: 5 },
  { name: 'Busan', country: 'KR', lat: 35.10, lng: 129.04, type: 'container', volume: '22.7M TEU', rank: 6 },
  { name: 'Qingdao', country: 'CN', lat: 36.07, lng: 120.38, type: 'container', volume: '22.0M TEU', rank: 7 },
  { name: 'Rotterdam', country: 'NL', lat: 51.90, lng: 4.50, type: 'container', volume: '14.5M TEU', rank: 8 },
  { name: 'Tokyo', country: 'JP', lat: 35.61, lng: 139.79, type: 'container', volume: '4.5M TEU' },
  { name: 'Yokohama', country: 'JP', lat: 35.45, lng: 139.66, type: 'container', volume: '2.9M TEU' },
  { name: 'Kobe', country: 'JP', lat: 34.67, lng: 135.21, type: 'container', volume: '2.8M TEU' },
  { name: 'Nagoya', country: 'JP', lat: 35.08, lng: 136.87, type: 'container', volume: '2.6M TEU' },
  { name: 'Osaka', country: 'JP', lat: 34.63, lng: 135.41, type: 'container', volume: '2.1M TEU' },
  { name: 'Hakata (Fukuoka)', country: 'JP', lat: 33.60, lng: 130.40, type: 'container', volume: '0.9M TEU' },
  { name: 'Kitakyushu', country: 'JP', lat: 33.91, lng: 130.93, type: 'container', volume: '0.5M TEU' },
  { name: 'Shimizu', country: 'JP', lat: 35.00, lng: 138.50, type: 'container', volume: '0.5M TEU' },
  { name: 'Tomakomai', country: 'JP', lat: 42.63, lng: 141.63, type: 'container', volume: '0.4M TEU' },
  { name: 'Niigata', country: 'JP', lat: 37.95, lng: 139.06, type: 'container', volume: '0.2M TEU' },
  { name: 'Sendai', country: 'JP', lat: 38.27, lng: 141.02, type: 'container', volume: '0.2M TEU' },
  { name: 'Mizushima', country: 'JP', lat: 34.50, lng: 133.72, type: 'energy', volume: 'Industrial' },
  { name: 'Yokkaichi', country: 'JP', lat: 34.95, lng: 136.65, type: 'energy', volume: 'Industrial' },
  { name: 'Dubai (Jebel Ali)', country: 'AE', lat: 25.01, lng: 55.06, type: 'container', volume: '14.0M TEU', rank: 9 },
  { name: 'Port Klang', country: 'MY', lat: 2.99, lng: 101.39, type: 'container', volume: '13.2M TEU', rank: 10 },
  { name: 'Antwerp', country: 'BE', lat: 51.30, lng: 4.40, type: 'container', volume: '12.0M TEU', rank: 11 },
  { name: 'Xiamen', country: 'CN', lat: 24.48, lng: 118.09, type: 'container', volume: '11.4M TEU', rank: 12 },
  { name: 'Hamburg', country: 'DE', lat: 53.55, lng: 9.97, type: 'container', volume: '8.7M TEU', rank: 14 },
  { name: 'Los Angeles', country: 'US', lat: 33.74, lng: -118.27, type: 'container', volume: '9.9M TEU', rank: 13 },
  { name: 'Long Beach', country: 'US', lat: 33.75, lng: -118.19, type: 'container', volume: '8.0M TEU', rank: 15 },
  { name: 'Tanjung Pelepas', country: 'MY', lat: 1.36, lng: 103.55, type: 'container', volume: '9.8M TEU', rank: 16 },
  { name: 'Savannah', country: 'US', lat: 32.08, lng: -81.09, type: 'container', volume: '5.6M TEU', rank: 20 },
  { name: 'Felixstowe', country: 'GB', lat: 51.96, lng: 1.35, type: 'container', volume: '3.8M TEU', rank: 25 },
  { name: 'Santos', country: 'BR', lat: -23.95, lng: -46.31, type: 'container', volume: '4.2M TEU', rank: 22 },
  { name: 'Colombo', country: 'LK', lat: 6.94, lng: 79.84, type: 'container', volume: '7.2M TEU', rank: 17 },

  // ── Energy/Oil Ports ──
  { name: 'Ras Tanura', country: 'SA', lat: 26.64, lng: 50.16, type: 'energy', volume: '6.5M bpd' },
  { name: 'Fujairah', country: 'AE', lat: 25.14, lng: 56.35, type: 'energy', volume: '3.5M bpd' },
  { name: 'Novorossiysk', country: 'RU', lat: 44.72, lng: 37.77, type: 'energy', volume: '2.8M bpd' },
  { name: 'Houston Ship Channel', country: 'US', lat: 29.73, lng: -95.27, type: 'energy', volume: '2.5M bpd' },
  { name: 'Kharg Island', country: 'IR', lat: 29.24, lng: 50.33, type: 'energy', volume: '2.0M bpd' },
  { name: 'Primorsk', country: 'RU', lat: 60.35, lng: 28.70, type: 'energy', volume: '1.6M bpd' },

  // ── Major Naval Bases ──
  { name: 'Norfolk Naval Station', country: 'US', lat: 36.95, lng: -76.33, type: 'naval', fleet: 'US Atlantic Fleet' },
  { name: 'San Diego Naval Base', country: 'US', lat: 32.69, lng: -117.15, type: 'naval', fleet: 'US Pacific Fleet' },
  { name: 'Pearl Harbor', country: 'US', lat: 21.35, lng: -157.97, type: 'naval', fleet: 'US Pacific Fleet' },
  { name: 'Yokosuka', country: 'JP', lat: 35.28, lng: 139.67, type: 'naval', fleet: 'US 7th Fleet' },
  { name: 'Severomorsk', country: 'RU', lat: 69.07, lng: 33.42, type: 'naval', fleet: 'Russian Northern Fleet' },
  { name: 'Tartus', country: 'SY', lat: 34.89, lng: 35.89, type: 'naval', fleet: 'Russian Mediterranean' },
  { name: 'Zhanjiang', country: 'CN', lat: 21.20, lng: 110.39, type: 'naval', fleet: 'PLA Navy South Sea Fleet' },
  { name: 'Qingdao Naval', country: 'CN', lat: 36.09, lng: 120.43, type: 'naval', fleet: 'PLA Navy North Sea Fleet' },
  { name: 'Portsmouth', country: 'GB', lat: 50.80, lng: -1.11, type: 'naval', fleet: 'Royal Navy' },
  { name: 'Toulon', country: 'FR', lat: 43.12, lng: 5.93, type: 'naval', fleet: 'French Navy Mediterranean' },
  { name: 'Changi Naval Base', country: 'SG', lat: 1.33, lng: 104.01, type: 'naval', fleet: 'Republic of Singapore Navy' },
  { name: 'Visakhapatnam', country: 'IN', lat: 17.69, lng: 83.30, type: 'naval', fleet: 'Indian Navy Eastern Command' },
  { name: 'Mumbai Naval', country: 'IN', lat: 18.93, lng: 72.84, type: 'naval', fleet: 'Indian Navy Western Command' },
];

const CHOKEPOINTS = [
  { name: 'Strait of Hormuz', lat: 26.57, lng: 56.25, traffic: '21M bpd oil', risk: 'HIGH' },
  { name: 'Strait of Malacca', lat: 2.50, lng: 101.50, traffic: '16M bpd oil', risk: 'MODERATE' },
  { name: 'Suez Canal', lat: 30.43, lng: 32.34, traffic: '12% world trade', risk: 'ELEVATED' },
  { name: 'Bab el-Mandeb', lat: 12.58, lng: 43.33, traffic: '6.2M bpd oil', risk: 'CRITICAL' },
  { name: 'Panama Canal', lat: 9.08, lng: -79.68, traffic: '5% world trade', risk: 'LOW' },
  { name: 'Turkish Straits', lat: 41.12, lng: 29.07, traffic: '3M bpd oil', risk: 'MODERATE' },
  { name: 'Danish Straits', lat: 55.70, lng: 12.60, traffic: '3.2M bpd oil', risk: 'LOW' },
  { name: 'Cape of Good Hope', lat: -34.36, lng: 18.47, traffic: 'Alt route Suez', risk: 'LOW' },
  { name: 'Taiwan Strait', lat: 24.00, lng: 119.00, traffic: '88% large ships', risk: 'ELEVATED' },
  { name: 'Lombok Strait', lat: -8.47, lng: 115.72, traffic: 'Alt Malacca', risk: 'LOW' },
];

// --- Global AIS Stream Client (In-Memory Cache) ---
// Note: In a true serverless environment, this state would reset per invocation.
// For Next.js dev server or Node.js Docker container, this will persist.

const MAX_SHIPS = 80_000;
const STALE_MS = 30 * 60 * 1000;
const AIS_STREAM_URL = 'wss://stream.aisstream.io/v0/stream';

type AisFeedState = {
  socket: WebSocket | null;
  connecting: boolean;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  backoffMs: number;
};

function emptyFeedState(): AisFeedState {
  return { socket: null, connecting: false, reconnectTimer: null, backoffMs: 1000 };
}

const globalForAis = globalThis as unknown as {
  shipsCache: Map<number, CachedAisShip>;
  aisFeeds: Record<AisFeedId, AisFeedState>;
};

export type CachedAisShip = NormalizedAisShipUpdate & {
  id: number;
  lat: number;
  lng: number;
  timestamp: number;
};

if (!globalForAis.shipsCache) {
  globalForAis.shipsCache = new Map();
}
if (!globalForAis.aisFeeds) {
  globalForAis.aisFeeds = {
    europe: emptyFeedState(),
    americas: emptyFeedState(),
    indopacific: emptyFeedState(),
  };
}

const shipsCache = globalForAis.shipsCache;
const aisFeeds = globalForAis.aisFeeds;

function decodeAisFrame(data: WebSocket.RawData): string {
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  return String(data);
}

function pruneShipCache(now = Date.now()) {
  for (const [mmsi, ship] of shipsCache.entries()) {
    if (now - ship.timestamp > STALE_MS) shipsCache.delete(mmsi);
  }
  if (shipsCache.size <= MAX_SHIPS) return;
  for (const mmsi of evictOverflowMmsis(shipsCache.values(), MAX_SHIPS)) {
    shipsCache.delete(mmsi);
  }
}

function scheduleAisReconnect(feedId: AisFeedId) {
  const feed = aisFeeds[feedId];
  if (feed.reconnectTimer) return;
  const delay = feed.backoffMs + Math.floor(Math.random() * 400);
  feed.reconnectTimer = setTimeout(() => {
    feed.reconnectTimer = null;
    connectAisFeed(feedId);
  }, delay);
  feed.backoffMs = Math.min(60_000, feed.backoffMs * 2);
}

function disconnectAisFeed(feedId: AisFeedId) {
  const feed = aisFeeds[feedId];
  if (feed.reconnectTimer) {
    clearTimeout(feed.reconnectTimer);
    feed.reconnectTimer = null;
  }
  const ws = feed.socket;
  feed.socket = null;
  feed.connecting = false;
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    try { ws.terminate(); } catch { /* already closed */ }
  }
}

function disconnectAisStream() {
  for (const feedId of AIS_FEED_IDS) disconnectAisFeed(feedId);
}

function ingestAisFrame(data: WebSocket.RawData) {
  try {
    const parsed = JSON.parse(decodeAisFrame(data));
    if (parsed?.MessageType === 'SubscriptionConfirmation') return;
    const update = normalizeAisMessage(parsed);
    if (!update) return;

    const existing = shipsCache.get(update.mmsi);
    const merged = mergeAisShipUpdate(existing, update);
    const ship = { id: update.mmsi, ...merged };
    if (isMappableShip(ship)) shipsCache.set(update.mmsi, ship);
    if (shipsCache.size > MAX_SHIPS) pruneShipCache();
  } catch {
    // ignore parse errors and keep draining the socket
  }
}

function connectAisFeed(feedId: AisFeedId) {
  const feed = aisFeeds[feedId];
  if (feed.connecting || feed.socket) return;
  const apiKey = getProviderEnv().AIS_API_KEY;
  if (!apiKey) return;

  feed.connecting = true;
  let ws: WebSocket;
  try {
    ws = new WebSocket(AIS_STREAM_URL, { perMessageDeflate: true });
  } catch {
    feed.connecting = false;
    scheduleAisReconnect(feedId);
    return;
  }
  feed.socket = ws;

  const openWatchdog = setTimeout(() => {
    if (ws.readyState !== WebSocket.OPEN) ws.terminate();
  }, 8_000);

  ws.on('open', () => {
    clearTimeout(openWatchdog);
    feed.connecting = false;
    feed.backoffMs = 1000;
    ws.send(JSON.stringify({
      APIKey: apiKey,
      BoundingBoxes: AIS_FEED_BOXES[feedId],
      FilterMessageTypes: AIS_SUBSCRIPTION_MESSAGE_TYPES,
    }));
  });

  ws.on('message', ingestAisFrame);

  ws.on('close', () => {
    clearTimeout(openWatchdog);
    if (feed.socket === ws) feed.socket = null;
    feed.connecting = false;
    scheduleAisReconnect(feedId);
  });

  ws.on('error', () => {
    ws.terminate();
  });
}

function connectAisStream() {
  AIS_FEED_IDS.forEach((feedId, index) => {
    setTimeout(() => connectAisFeed(feedId), index * 300);
  });
}

registerCacheReset('maritime', () => {
  shipsCache.clear();
  disconnectAisStream();
  for (const feedId of AIS_FEED_IDS) aisFeeds[feedId].backoffMs = 1000;
  connectAisStream();
});

connectAisStream();

export function getCachedAisShip(mmsi: number): CachedAisShip | undefined {
  return shipsCache.get(mmsi);
}

function isMappableShip(ship: NormalizedAisShipUpdate & { id: number }): ship is CachedAisShip {
  return hasValidAisCoordinates(ship.lat, ship.lng) && typeof ship.timestamp === 'number';
}

export async function GET(request: Request) {
  connectAisStream();
  pruneShipCache();

  const url = new URL(request.url);
  const mmsiParam = url.searchParams.get('mmsi');
  if (mmsiParam) {
    const mmsi = Number(mmsiParam);
    const ship = Number.isInteger(mmsi) ? shipsCache.get(mmsi) : undefined;
    return NextResponse.json(
      { found: Boolean(ship), ship: ship || null, timestamp: new Date().toISOString() },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const ships = Array.from(shipsCache.values());

  // Dynamically calculate live traffic (Fast approximation of Haversine)
  const getDistanceKm = (lat1: number, lng1: number, lat2: number, lng2: number) => {
    const dx = (lng1 - lng2) * Math.cos((lat1 + lat2) / 2 * Math.PI / 180);
    const dy = lat1 - lat2;
    return Math.sqrt(dx * dx + dy * dy) * 111.32;
  };

  // Congestion and dwell time are only meaningful with live AIS. Without it,
  // they are reported as unknown rather than defaulted to "NORMAL / 1-2 Days",
  // which previously read as a measurement when nothing had been measured.
  const hasLiveVessels = ships.length > 0;

  const dynamicPorts = PORTS.map(port => {
    let nearbyCount = 0;
    let waitingCount = 0;

    for (const ship of ships) {
      if (getDistanceKm(port.lat, port.lng, ship.lat, ship.lng) < 50) {
        nearbyCount++;
        // Under 0.5 knots reads as anchored/waiting. An unreported speed is not
        // evidence of anchoring, so it is not counted either way.
        if (typeof ship.speed === 'number' && ship.speed < 0.5 && ship.type !== 'military') waitingCount++;
      }
    }

    let congestionStatus: string | null = null;
    let estDwellTime: string | null = null;

    if (hasLiveVessels && nearbyCount > 0) {
      const congestionRatio = waitingCount / nearbyCount;
      if (congestionRatio > 0.6 || waitingCount > 30) {
        congestionStatus = 'SEVERE';
        estDwellTime = '7+ Days';
      } else if (congestionRatio > 0.4 || waitingCount > 15) {
        congestionStatus = 'CONGESTED';
        estDwellTime = '3-5 Days';
      } else {
        congestionStatus = 'NORMAL';
        estDwellTime = '1-2 Days';
      }
    }

    return {
      ...port,
      // Static reference throughput stays separate from live counts so the
      // "LIVE" label can never end up attached to a published annual figure.
      volume: port.volume,
      volume_basis: 'static reference throughput',
      live_vessels: hasLiveVessels ? nearbyCount : null,
      waiting_vessels: hasLiveVessels ? waitingCount : null,
      congestion: congestionStatus,
      dwell_time: estDwellTime,
    };
  });

  const dynamicChokepoints = CHOKEPOINTS.map(choke => {
    let nearbyCount = 0;
    for (const ship of ships) {
      if (getDistanceKm(choke.lat, choke.lng, ship.lat, ship.lng) < 100) nearbyCount++;
    }

    // The per-chokepoint risk shipped in CHOKEPOINTS is a standing assessment,
    // not a live reading. Only a live vessel concentration can raise it, and
    // consumers can tell the two apart via risk_basis.
    let risk = choke.risk;
    let riskBasis = 'baseline standing assessment';

    if (hasLiveVessels) {
      if (nearbyCount > 50) {
        risk = 'CRITICAL';
        riskBasis = `live AIS concentration (${nearbyCount} vessels within 100km)`;
      } else if (nearbyCount > 20 && risk !== 'CRITICAL') {
        risk = 'HIGH';
        riskBasis = `live AIS concentration (${nearbyCount} vessels within 100km)`;
      } else if (nearbyCount > 5 && risk === 'LOW') {
        risk = 'ELEVATED';
        riskBasis = `live AIS concentration (${nearbyCount} vessels within 100km)`;
      }
    }

    return {
      ...choke,
      traffic: choke.traffic,
      traffic_basis: 'static reference throughput',
      live_vessels: hasLiveVessels ? nearbyCount : null,
      risk,
      risk_basis: riskBasis,
    };
  });

  const full = url.searchParams.get('full') === '1';
  return NextResponse.json({
    ports: dynamicPorts,
    chokepoints: dynamicChokepoints,
    ships: full ? ships : ships.map(compactAisShipForMap),
    total_ports: dynamicPorts.length,
    total_chokepoints: dynamicChokepoints.length,
    total_ships: ships.length,
    timestamp: new Date().toISOString(),
  }, {
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Pragma': 'no-cache'
    },
  });
}
