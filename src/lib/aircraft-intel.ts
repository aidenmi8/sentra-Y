export type AircraftMatchKey = 'icao24' | 'callsign' | 'registration';

export interface AircraftTarget {
  callsign?: string | null;
  registration?: string | null;
  icao24?: string | null;
  model?: string | null;
  altitude?: number | null;
  alt?: number | null;
  speedKnots?: number | null;
  speed_knots?: number | null;
  speed?: number | null;
  heading?: number | null;
  squawk?: string | null;
  category?: string | null;
  aircraftCategory?: string | null;
  aircraft_category?: string | null;
  lat?: number | null;
  lng?: number | null;
  grounded?: boolean | null;
  nacP?: number | null;
  nac_p?: number | null;
  feedTimestamp?: string | null;
  feed_timestamp?: string | null;
  source?: string | null;
}

export interface FlightFeed {
  timestamp?: string;
  commercial_flights?: AircraftTarget[];
  private_flights?: AircraftTarget[];
  private_jets?: AircraftTarget[];
  military_flights?: AircraftTarget[];
}

export interface AircraftMatch {
  aircraft: AircraftTarget;
  matchKey: AircraftMatchKey;
}

export interface AircraftSnapshot {
  callsign: string;
  registration: string;
  icao24: string;
  model: string;
  altitude: number | null;
  speedKnots: number | null;
  heading: number | null;
  squawk: string;
  category: string;
  aircraftCategory: string;
  lat: number | null;
  lng: number | null;
  grounded: boolean | null;
  nacP: number | null;
  feedTimestamp: string;
  lastSeenAt: string;
  offFeedSince?: string;
  source: string;
  stale: boolean;
  matchKey?: AircraftMatchKey;
}

export interface AircraftSourceLink {
  id: 'flightaware' | 'adsbexchange' | 'radarbox' | 'faa-registry';
  label: string;
  url: string;
}

const DEFAULT_SOURCE = 'ADS-B / adsb.lol';
const EMPTY_FEED_TIMESTAMP = '';
const AIRLINE_CALLSIGN_RE = /^[A-Z]{3}\d/;
const US_N_NUMBER_RE = /^N[1-9][A-Z0-9]{0,4}$/;
const HYPHENATED_REG_RE = /^[A-Z]{1,2}-[A-Z0-9]{3,5}$/;

function text(value: unknown): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed || /^(n\/a|unknown|null|undefined)$/i.test(trimmed)) return '';
  return trimmed;
}

function upper(value: unknown): string {
  return text(value).toUpperCase();
}

function lower(value: unknown): string {
  return text(value).toLowerCase();
}

function numeric(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function booleanish(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

/**
 * GA flights often put the tail number in the ADS-B callsign field.
 * OpenSky then publishes registration as "N/A", so the intel panel would
 * otherwise show REG -- and the photo lookup would search the hex.
 */
export function looksLikeAircraftRegistration(value: unknown): boolean {
  const v = upper(value).replace(/\s+/g, '');
  if (!v || v.length < 3 || v.length > 8) return false;
  if (AIRLINE_CALLSIGN_RE.test(v)) return false;
  return US_N_NUMBER_RE.test(v) || HYPHENATED_REG_RE.test(v);
}

export function inferAircraftRegistration(
  registration?: string | null,
  callsign?: string | null,
): string {
  const fromField = upper(registration);
  if (fromField) return fromField;
  const fromCallsign = upper(callsign).replace(/\s+/g, '');
  return looksLikeAircraftRegistration(fromCallsign) ? fromCallsign : '';
}

export function collectAircraftFeed(feed: FlightFeed | null | undefined): AircraftTarget[] {
  if (!feed) return [];
  return [
    ...(feed.commercial_flights || []),
    ...(feed.private_flights || []),
    ...(feed.private_jets || []),
    ...(feed.military_flights || []),
  ];
}

export function findAircraftInFlightFeed(
  target: AircraftTarget | null | undefined,
  feed: FlightFeed | null | undefined,
): AircraftMatch | null {
  const aircraft = collectAircraftFeed(feed);
  if (!target || aircraft.length === 0) return null;

  const targetIcao = lower(target.icao24);
  if (targetIcao) {
    const match = aircraft.find((candidate) => lower(candidate.icao24) === targetIcao);
    if (match) return { aircraft: match, matchKey: 'icao24' };
  }

  const targetCallsign = upper(target.callsign);
  if (targetCallsign) {
    const match = aircraft.find((candidate) => upper(candidate.callsign) === targetCallsign);
    if (match) return { aircraft: match, matchKey: 'callsign' };
  }

  const targetRegistration = upper(target.registration);
  if (targetRegistration) {
    const match = aircraft.find((candidate) => upper(candidate.registration) === targetRegistration);
    if (match) return { aircraft: match, matchKey: 'registration' };
  }

  return null;
}

function snapshotFromAircraft(
  aircraft: AircraftTarget,
  feedTimestamp: string | undefined,
  matchKey: AircraftMatchKey | undefined,
  stale: boolean,
): AircraftSnapshot {
  const timestamp = feedTimestamp || text(aircraft.feedTimestamp) || text(aircraft.feed_timestamp) || EMPTY_FEED_TIMESTAMP;
  return {
    callsign: upper(aircraft.callsign),
    registration: inferAircraftRegistration(aircraft.registration, aircraft.callsign),
    icao24: lower(aircraft.icao24),
    model: upper(aircraft.model),
    altitude: numeric(aircraft.altitude) ?? numeric(aircraft.alt),
    speedKnots: numeric(aircraft.speedKnots) ?? numeric(aircraft.speed_knots) ?? numeric(aircraft.speed),
    heading: numeric(aircraft.heading),
    squawk: upper(aircraft.squawk),
    category: lower(aircraft.category),
    aircraftCategory: lower(aircraft.aircraftCategory) || lower(aircraft.aircraft_category),
    lat: numeric(aircraft.lat),
    lng: numeric(aircraft.lng),
    grounded: booleanish(aircraft.grounded),
    nacP: numeric(aircraft.nacP) ?? numeric(aircraft.nac_p),
    feedTimestamp: timestamp,
    lastSeenAt: timestamp,
    source: text(aircraft.source) || DEFAULT_SOURCE,
    stale,
    matchKey,
  };
}

export function overlayAircraftLookup(
  snapshot: AircraftSnapshot,
  lookup: AircraftTarget | null | undefined,
): AircraftSnapshot {
  if (!lookup) return snapshot;
  return {
    ...snapshot,
    registration: snapshot.registration || inferAircraftRegistration(lookup.registration, lookup.callsign),
    model: snapshot.model || upper(lookup.model),
    squawk: snapshot.squawk || upper(lookup.squawk),
    nacP: snapshot.nacP ?? numeric(lookup.nacP) ?? numeric(lookup.nac_p),
    category: snapshot.category || lower(lookup.category),
    aircraftCategory: snapshot.aircraftCategory || lower(lookup.aircraftCategory) || lower(lookup.aircraft_category),
  };
}

export function adsbRecordToLookupTarget(record: {
  hex?: string;
  flight?: string;
  r?: string;
  t?: string;
  squawk?: string;
  nac_p?: number;
} | null | undefined): AircraftTarget | null {
  if (!record) return null;
  return {
    icao24: record.hex,
    callsign: record.flight,
    registration: record.r,
    model: record.t,
    squawk: record.squawk,
    nac_p: record.nac_p,
  };
}

export function buildAircraftSnapshot(
  target: AircraftTarget,
  feed: FlightFeed | null | undefined,
  previous?: AircraftSnapshot | null,
): AircraftSnapshot {
  const match = findAircraftInFlightFeed(target, feed);
  if (match) {
    return snapshotFromAircraft(
      { ...target, ...match.aircraft },
      feed?.timestamp,
      match.matchKey,
      false,
    );
  }

  const fallback = previous || snapshotFromAircraft(target, text(target.feedTimestamp), undefined, true);
  return {
    ...fallback,
    stale: true,
    matchKey: undefined,
    offFeedSince: fallback.offFeedSince || feed?.timestamp || new Date().toISOString(),
  };
}

export function buildAircraftSourceLinks(snapshot: Partial<AircraftSnapshot> | AircraftTarget): AircraftSourceLink[] {
  const callsign = upper(snapshot.callsign);
  const registration = upper(snapshot.registration);
  const icao24 = lower(snapshot.icao24);
  const flightIdentifier = callsign || registration;
  const links: AircraftSourceLink[] = [];

  if (flightIdentifier) {
    links.push({
      id: 'flightaware',
      label: 'FlightAware',
      url: `https://www.flightaware.com/live/flight/${encodeURIComponent(flightIdentifier)}`,
    });
  }

  if (icao24) {
    links.push({
      id: 'adsbexchange',
      label: 'ADS-B Exchange',
      url: `https://globe.adsbexchange.com/?icao=${encodeURIComponent(icao24)}`,
    });
  }

  if (flightIdentifier) {
    links.push({
      id: 'radarbox',
      label: 'RadarBox',
      url: `https://www.radarbox.com/data/flights/${encodeURIComponent(flightIdentifier)}`,
    });
  }

  if (/^N[A-Z0-9]+$/.test(registration)) {
    links.push({
      id: 'faa-registry',
      label: 'FAA Registry',
      url: `https://registry.faa.gov/AircraftInquiry/Search/NNumberResult?nNumberTxt=${encodeURIComponent(registration.slice(1))}`,
    });
  }

  return links;
}
