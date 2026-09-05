type EntityType = 'aircraft' | 'vessel' | 'company' | 'person' | 'country' | 'event' | 'sanction' | 'ip';

export type EntityIntelNode = {
  id: string;
  label: string;
  type: EntityType;
  properties?: Record<string, unknown>;
};

export type EntityIntelLink = {
  source: string;
  target: string;
  label: string;
};

export type EntityIntelGraph = {
  nodes: EntityIntelNode[];
  links: EntityIntelLink[];
  entity: {
    type: string;
    id: string;
  };
  source: string;
  fallback: boolean;
  timestamp: string;
};

type BuildLocalEntityGraphInput = {
  type: string;
  id: string;
  properties?: Record<string, unknown>;
};

const AIRCRAFT_REGISTRATION_PREFIXES: Record<string, string> = {
  A6: 'United Arab Emirates',
  A7: 'Qatar',
  B: 'China',
  C: 'Canada',
  CS: 'Portugal',
  D: 'Germany',
  EC: 'Spain',
  EI: 'Ireland',
  F: 'France',
  G: 'United Kingdom',
  HA: 'Hungary',
  HB: 'Switzerland',
  HL: 'South Korea',
  HS: 'Thailand',
  I: 'Italy',
  JA: 'Japan',
  N: 'United States',
  OE: 'Austria',
  OO: 'Belgium',
  OK: 'Czech Republic',
  OY: 'Denmark',
  PH: 'Netherlands',
  PK: 'Pakistan',
  PP: 'Brazil',
  PR: 'Brazil',
  PT: 'Brazil',
  RA: 'Russia',
  SE: 'Sweden',
  SP: 'Poland',
  SU: 'Russia',
  SX: 'Greece',
  TC: 'Turkey',
  UR: 'Ukraine',
  VH: 'Australia',
  VT: 'India',
  YR: 'Romania',
  '4X': 'Israel',
  '9M': 'Malaysia',
  '9V': 'Singapore',
};

const VESSEL_FLAG_CODES: Record<string, string> = {
  BS: 'Bahamas',
  CN: 'China',
  CY: 'Cyprus',
  DK: 'Denmark',
  GB: 'United Kingdom',
  GR: 'Greece',
  HK: 'Hong Kong',
  JP: 'Japan',
  KR: 'South Korea',
  LR: 'Liberia',
  MH: 'Marshall Islands',
  MT: 'Malta',
  NL: 'Netherlands',
  NO: 'Norway',
  PA: 'Panama',
  SG: 'Singapore',
  US: 'United States',
};

export function buildLocalEntityGraph(input: BuildLocalEntityGraphInput): EntityIntelGraph {
  const type = cleanText(input.type).toLowerCase();
  const id = cleanText(input.id);
  const properties = input.properties || {};
  const rootId = `${type}:${id}`;
  const nodes: EntityIntelNode[] = [];
  const links: EntityIntelLink[] = [];

  if (type === 'aircraft') {
    const registration = cleanText(properties.registration) || id;
    const model = cleanText(properties.model);
    const country = getAircraftRegistrationCountry(registration);

    if (country) {
      const countryId = `country:${country}`;
      nodes.push({
        id: countryId,
        label: country,
        type: 'country',
        properties: { source: 'Registration prefix', registration },
      });
      links.push({ source: rootId, target: countryId, label: 'REGISTERED IN' });
    }

    if (model) {
      const modelId = `aircraft:model:${model}`;
      nodes.push({
        id: modelId,
        label: model,
        type: 'aircraft',
        properties: { role: 'model', source: 'ADS-B' },
      });
      links.push({ source: rootId, target: modelId, label: 'AIRCRAFT TYPE' });
    }

  }

  if (type === 'vessel') {
    const flag = cleanText(properties.flag);
    const flagCountry = getVesselFlagCountry(flag);
    const destination = cleanText(properties.destination);

    if (flagCountry) {
      const countryId = `country:${flagCountry}`;
      nodes.push({
        id: countryId,
        label: flagCountry,
        type: 'country',
        properties: { source: 'AIS flag', flag },
      });
      links.push({ source: rootId, target: countryId, label: 'FLAG STATE' });
    }

    if (destination) {
      const destinationId = `event:destination:${destination}`;
      nodes.push({
        id: destinationId,
        label: destination,
        type: 'event',
        properties: { role: 'destination', source: 'AIS' },
      });
      links.push({ source: rootId, target: destinationId, label: 'DESTINATION' });
    }
  }

  return {
    ...dedupeGraph(nodes, links),
    entity: { type, id },
    source: 'Sentra Mi8 Local Intelligence Fallback',
    fallback: true,
    timestamp: new Date().toISOString(),
  };
}

function getAircraftRegistrationCountry(registration: string): string | undefined {
  const normalized = registration.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return AIRCRAFT_REGISTRATION_PREFIXES[normalized.slice(0, 2)] ||
    AIRCRAFT_REGISTRATION_PREFIXES[normalized.slice(0, 1)];
}

function getVesselFlagCountry(flag: string): string | undefined {
  const normalized = flag.toUpperCase().trim();
  return VESSEL_FLAG_CODES[normalized] || cleanText(flag);
}

function dedupeGraph(nodes: EntityIntelNode[], links: EntityIntelLink[]) {
  const nodeMap = new Map<string, EntityIntelNode>();
  for (const node of nodes) {
    if (!nodeMap.has(node.id)) nodeMap.set(node.id, node);
  }

  const linkMap = new Map<string, EntityIntelLink>();
  for (const link of links) {
    const key = `${link.source}->${link.target}->${link.label}`;
    if (!linkMap.has(key)) linkMap.set(key, link);
  }

  return {
    nodes: [...nodeMap.values()],
    links: [...linkMap.values()],
  };
}

function cleanText(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/[^\p{L}\p{N}\s\-._]/gu, '').replace(/\s+/g, ' ').trim();
}
