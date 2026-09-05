export type VesselTarget = {
  mmsi?: number | string | null;
  imo?: number | string | null;
  name?: string | null;
  callsign?: string | null;
  type?: string | null;
  lat?: number | null;
  lng?: number | null;
  speed?: number | null;
  heading?: number | null;
  destination?: string | null;
  flag?: string | null;
  draught?: number | null;
  navStatus?: string | null;
  eta?: string | null;
  length?: number | null;
  beam?: number | null;
  timestamp?: number | string | null;
};

export type VesselSnapshot = {
  mmsi: string;
  imo: string;
  name: string;
  callsign: string;
  type: string;
  lat: number | null;
  lng: number | null;
  speed: number | null;
  heading: number | null;
  destination: string;
  flag: string;
  draught: number | null;
  navStatus: string;
  eta: string;
  length: number | null;
  beam: number | null;
  lastSeenAt: string;
  stale: boolean;
  source: string;
};

export type VesselSourceLink = {
  id: 'marinetraffic' | 'vesselfinder' | 'myshiptracking';
  label: string;
  url: string;
};

function text(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed || /^(n\/a|unknown|null|undefined|unk)$/i.test(trimmed)) return '';
  return trimmed;
}

function numeric(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export function normalizeMmsi(value: unknown): string {
  const n = numeric(value);
  if (n && Number.isInteger(n) && n > 0) return String(n);
  const t = text(value).replace(/\D/g, '');
  return t.length >= 7 ? t : '';
}

export function findVesselInFeed(
  target: VesselTarget | null | undefined,
  ships: VesselTarget[] | null | undefined,
): VesselTarget | null {
  if (!target || !ships?.length) return null;
  const mmsi = normalizeMmsi(target.mmsi);
  if (mmsi) {
    const match = ships.find((ship) => normalizeMmsi(ship.mmsi) === mmsi);
    if (match) return match;
  }
  const imo = text(target.imo);
  if (imo) {
    const match = ships.find((ship) => text(ship.imo) === imo);
    if (match) return match;
  }
  return null;
}

export function buildVesselSnapshot(
  target: VesselTarget,
  ships?: VesselTarget[] | null,
): VesselSnapshot {
  const live = findVesselInFeed(target, ships);
  const ship = { ...target, ...(live || {}) };
  const timestamp = numeric(ship.timestamp);
  return {
    mmsi: normalizeMmsi(ship.mmsi),
    imo: text(ship.imo),
    name: text(ship.name),
    callsign: text(ship.callsign),
    type: text(ship.type),
    lat: numeric(ship.lat),
    lng: numeric(ship.lng),
    speed: numeric(ship.speed),
    heading: numeric(ship.heading),
    destination: text(ship.destination),
    flag: text(ship.flag),
    draught: numeric(ship.draught),
    navStatus: text(ship.navStatus),
    eta: text(ship.eta),
    length: numeric(ship.length),
    beam: numeric(ship.beam),
    lastSeenAt: timestamp ? new Date(timestamp).toISOString() : '',
    stale: !live,
    source: 'AISStream',
  };
}

export function buildVesselSourceLinks(snapshot: Partial<VesselSnapshot> | VesselTarget): VesselSourceLink[] {
  const mmsi = normalizeMmsi(snapshot.mmsi);
  const imo = text(snapshot.imo);
  const links: VesselSourceLink[] = [];
  if (mmsi) {
    links.push({
      id: 'marinetraffic',
      label: 'MarineTraffic',
      url: `https://www.marinetraffic.com/en/ais/details/ships/mmsi:${encodeURIComponent(mmsi)}`,
    });
    links.push({
      id: 'vesselfinder',
      label: 'VesselFinder',
      url: imo
        ? `https://www.vesselfinder.com/vessels/details/${encodeURIComponent(imo)}`
        : `https://www.vesselfinder.com/?mmsi=${encodeURIComponent(mmsi)}`,
    });
    links.push({
      id: 'myshiptracking',
      label: 'MyShipTracking',
      url: `https://www.myshiptracking.com/vessels/mmsi-${encodeURIComponent(mmsi)}`,
    });
  }
  return links;
}
