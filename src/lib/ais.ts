export type AisMessageType =
  | 'PositionReport'
  | 'StandardClassBPositionReport'
  | 'ExtendedClassBPositionReport'
  | 'LongRangeAisBroadcastMessage'
  | 'ShipStaticData'
  | 'StaticDataReport';

export type NormalizedAisShipUpdate = {
  mmsi: number;
  name?: string;
  lat?: number;
  lng?: number;
  speed?: number;
  heading?: number;
  destination?: string;
  type?: string;
  timestamp?: number;
  imo?: number;
  callsign?: string;
  flag?: string;
  draught?: number;
  navStatus?: string;
  eta?: string;
  length?: number;
  beam?: number;
};

type AisMessage = {
  MessageType?: string;
  MetaData?: Record<string, unknown>;
  Metadata?: Record<string, unknown>;
  Message?: Record<string, unknown>;
};

export const AIS_POSITION_MESSAGE_TYPES = [
  'PositionReport',
  'StandardClassBPositionReport',
  'ExtendedClassBPositionReport',
  'LongRangeAisBroadcastMessage',
] as const;

export const AIS_STATIC_MESSAGE_TYPES = [
  'ShipStaticData',
  'StaticDataReport',
] as const;

export const AIS_SUBSCRIPTION_MESSAGE_TYPES = [
  ...AIS_POSITION_MESSAGE_TYPES,
  ...AIS_STATIC_MESSAGE_TYPES,
] as const;

const INVALID_TRUE_HEADING = 511;

const NAV_STATUS: Record<number, string> = {
  0: 'underway',
  1: 'anchored',
  2: 'not under command',
  3: 'restricted',
  4: 'constrained',
  5: 'moored',
  6: 'aground',
  7: 'fishing',
  8: 'sailing',
};

/**
 * MMSI Maritime Identification Digits → flag state. First three digits of a
 * vessel MMSI identify the administration. Keep this list to the busy flags;
 * unknown MIDs simply omit flag rather than inventing one.
 */
const MMSI_MID_FLAGS: Record<string, string> = {
  201: 'Albania', 202: 'Andorra', 203: 'Austria', 204: 'Portugal', 205: 'Belgium',
  206: 'Belarus', 207: 'Bulgaria', 208: 'Vatican', 209: 'Cyprus', 210: 'Cyprus',
  211: 'Germany', 212: 'Cyprus', 213: 'Georgia', 214: 'Moldova', 215: 'Malta',
  216: 'Armenia', 218: 'Germany', 219: 'Denmark', 220: 'Denmark', 224: 'Spain',
  225: 'Spain', 226: 'France', 227: 'France', 228: 'France', 229: 'Malta',
  230: 'Finland', 231: 'Faroe Islands', 232: 'United Kingdom', 233: 'United Kingdom',
  234: 'United Kingdom', 235: 'United Kingdom', 236: 'Gibraltar', 237: 'Greece',
  238: 'Croatia', 239: 'Greece', 240: 'Greece', 241: 'Greece', 242: 'Morocco',
  243: 'Hungary', 244: 'Netherlands', 245: 'Netherlands', 246: 'Netherlands',
  247: 'Italy', 248: 'Malta', 249: 'Malta', 250: 'Ireland', 251: 'Iceland',
  252: 'Liechtenstein', 253: 'Luxembourg', 254: 'Monaco', 255: 'Portugal',
  256: 'Malta', 257: 'Norway', 258: 'Norway', 259: 'Norway', 261: 'Poland',
  263: 'Portugal', 264: 'Romania', 265: 'Sweden', 266: 'Sweden', 267: 'Slovakia',
  268: 'San Marino', 269: 'Switzerland', 270: 'Czechia', 271: 'Turkey',
  272: 'Ukraine', 273: 'Russia', 274: 'North Macedonia', 275: 'Latvia',
  276: 'Estonia', 277: 'Lithuania', 278: 'Slovenia', 279: 'Serbia',
  301: 'Anguilla', 303: 'United States', 304: 'Antigua and Barbuda',
  305: 'Antigua and Barbuda', 306: 'Netherlands', 307: 'Aruba',
  308: 'Bahamas', 309: 'Bahamas', 310: 'Bermuda', 311: 'Bahamas',
  312: 'Belize', 314: 'Barbados', 316: 'Canada', 319: 'Cayman Islands',
  321: 'Costa Rica', 323: 'Cuba', 327: 'Dominican Republic', 329: 'Guadeloupe',
  330: 'Grenada', 331: 'Greenland', 332: 'Guatemala', 334: 'Honduras',
  336: 'Haiti', 338: 'United States', 339: 'Jamaica', 341: 'Saint Kitts and Nevis',
  345: 'Mexico', 347: 'Martinique', 348: 'Montserrat', 350: 'Nicaragua',
  351: 'Panama', 352: 'Panama', 353: 'Panama', 354: 'Panama', 355: 'Panama',
  356: 'Panama', 357: 'Panama', 358: 'Puerto Rico', 359: 'El Salvador',
  361: 'Saint Pierre and Miquelon', 362: 'Trinidad and Tobago',
  364: 'Turks and Caicos', 366: 'United States', 367: 'United States',
  368: 'United States', 369: 'United States', 370: 'Panama', 371: 'Panama',
  372: 'Panama', 373: 'Panama', 374: 'Panama', 375: 'Saint Vincent',
  376: 'Saint Vincent', 377: 'Saint Vincent', 378: 'British Virgin Islands',
  379: 'US Virgin Islands', 401: 'Afghanistan', 403: 'Saudi Arabia',
  405: 'Bangladesh', 408: 'Bahrain', 410: 'Bhutan', 412: 'China', 413: 'China',
  414: 'China', 416: 'Taiwan', 417: 'Sri Lanka', 419: 'India', 422: 'Iran',
  423: 'Azerbaijan', 425: 'Iraq', 428: 'Israel', 431: 'Japan', 432: 'Japan',
  434: 'Turkmenistan', 436: 'Kazakhstan', 437: 'Uzbekistan', 438: 'Jordan',
  440: 'South Korea', 441: 'South Korea', 443: 'Palestine', 445: 'North Korea',
  447: 'Kuwait', 450: 'Lebanon', 451: 'Kyrgyzstan', 453: 'Macao',
  455: 'Maldives', 457: 'Mongolia', 459: 'Nepal', 461: 'Oman', 463: 'Pakistan',
  466: 'Qatar', 468: 'Syria', 470: 'UAE', 471: 'UAE', 472: 'Tajikistan',
  473: 'Yemen', 475: 'Yemen', 477: 'Hong Kong', 478: 'Bosnia and Herzegovina',
  501: 'Adelie Land', 503: 'Australia', 506: 'Myanmar', 508: 'Brunei',
  510: 'Micronesia', 511: 'Palau', 512: 'New Zealand', 514: 'Cambodia',
  515: 'Cambodia', 516: 'Christmas Island', 518: 'Cook Islands', 520: 'Fiji',
  523: 'Cocos Islands', 525: 'Indonesia', 529: 'Kiribati', 531: 'Laos',
  533: 'Malaysia', 536: 'Northern Mariana Islands', 538: 'Marshall Islands',
  540: 'New Caledonia', 542: 'Niue', 544: 'Nauru', 546: 'French Polynesia',
  548: 'Philippines', 553: 'Papua New Guinea', 555: 'Pitcairn', 557: 'Solomon Islands',
  559: 'American Samoa', 561: 'Samoa', 563: 'Singapore', 564: 'Singapore',
  565: 'Singapore', 566: 'Singapore', 567: 'Thailand', 570: 'Tonga',
  572: 'Tuvalu', 574: 'Vietnam', 576: 'Vanuatu', 577: 'Vanuatu',
  578: 'Wallis and Futuna', 601: 'South Africa', 603: 'Angola', 605: 'Algeria',
  607: 'Saint Paul and Amsterdam', 608: 'Ascension', 609: 'Burundi',
  610: 'Benin', 611: 'Botswana', 612: 'Central African Republic', 613: 'Cameroon',
  615: 'Congo', 616: 'Comoros', 617: 'Cape Verde', 618: 'Crozet',
  619: 'Ivory Coast', 620: 'Comoros', 621: 'Djibouti', 622: 'Egypt',
  624: 'Ethiopia', 625: 'Eritrea', 626: 'Gabon', 627: 'Ghana', 629: 'Gambia',
  630: 'Guinea-Bissau', 631: 'Equatorial Guinea', 632: 'Guinea', 633: 'Burkina Faso',
  634: 'Kenya', 635: 'Kerguelen', 636: 'Liberia', 637: 'Liberia',
  638: 'South Sudan', 642: 'Libya', 644: 'Lesotho', 645: 'Mauritius',
  647: 'Madagascar', 649: 'Mali', 650: 'Mozambique', 654: 'Mauritania',
  655: 'Malawi', 656: 'Niger', 657: 'Nigeria', 659: 'Namibia', 660: 'Reunion',
  661: 'Rwanda', 662: 'Sudan', 663: 'Senegal', 664: 'Seychelles',
  665: 'Saint Helena', 666: 'Somalia', 667: 'Sierra Leone', 668: 'Sao Tome and Principe',
  669: 'Eswatini', 670: 'Chad', 671: 'Togo', 672: 'Tunisia', 674: 'Tanzania',
  675: 'Uganda', 676: 'DR Congo', 677: 'Tanzania', 678: 'Zambia', 679: 'Zimbabwe',
  701: 'Argentina', 710: 'Brazil', 720: 'Bolivia', 725: 'Chile', 730: 'Colombia',
  735: 'Ecuador', 740: 'Falkland Islands', 745: 'Guiana', 750: 'Guyana',
  755: 'Paraguay', 760: 'Peru', 765: 'Suriname', 770: 'Uruguay', 775: 'Venezuela',
};

export type AisBoundingBox = [[number, number], [number, number]];
export type AisFeedId = 'europe' | 'americas' | 'indopacific';

/**
 * AISStream is a terrestrial-station network (~200 km from coast) with a
 * hard cap of 3 subscribed connections. One world-sized subscription is
 * flooded by the North Sea / Med and the service drops the rest, which is
 * why India, the Gulf, and open-ocean approaches stayed empty.
 *
 * Split coverage across the three allowed sockets so busy Europe cannot
 * starve the other oceans. Boxes are required; a single
 * `[[-90,-180],[90,180]]` world box is never used.
 */
export const AIS_FEED_BOXES: Record<AisFeedId, AisBoundingBox[]> = {
  europe: [
    [[47, -12], [72, 32]],
    [[35, -12], [48, 20]],
    [[30, 19], [47, 42]],
  ],
  americas: [
    [[24, -82], [47, -60]],
    [[24, -98], [31, -80]],
    [[7, -92], [24, -58]],
    [[30, -128], [51, -116]],
    [[18, -161], [23, -154]],
    [[-56, -70], [12, -32]],
    [[-56, -90], [5, -70]],
    [[45, -170], [62, -120]],
  ],
  indopacific: [
    [[10, 32], [32, 62]],
    [[5, 60], [26, 95]],
    [[-15, 95], [50, 155]],
    [[-45, 110], [-8, 155]],
    [[-36, -20], [20, 55]],
    [[18, -52], [50, -16]],
    [[-40, -32], [10, 0]],
    [[-35, 55], [10, 100]],
    [[-40, 150], [50, 180]],
    [[-40, -180], [50, -130]],
  ],
};

export const AIS_FEED_IDS = Object.keys(AIS_FEED_BOXES) as AisFeedId[];

/** Union of every live subscription box. Used by coverage tests. */
export const AIS_WORLD_BOUNDING_BOXES: AisBoundingBox[] = AIS_FEED_IDS.flatMap(
  (id) => AIS_FEED_BOXES[id],
);

export function getSentraShipType(typeCode: unknown): string | undefined {
  const code = typeof typeCode === 'number' ? typeCode : Number(typeCode);
  if (!Number.isFinite(code) || code <= 0) return undefined;
  if (code >= 80 && code <= 89) return 'tanker';
  if (code >= 70 && code <= 79) return 'cargo';
  if (code >= 60 && code <= 69) return 'passenger';
  if (code === 30) return 'fishing';
  if (code === 31 || code === 32 || code === 52) return 'tug';
  if (code === 35) return 'military';
  if (code === 36 || code === 37) return 'pleasure';
  if (code >= 40 && code <= 49) return 'high-speed';
  return 'other';
}

export function flagFromMmsi(mmsi: number | undefined): string | undefined {
  if (!mmsi || !Number.isInteger(mmsi)) return undefined;
  const mid = String(mmsi).padStart(9, '0').slice(0, 3);
  return MMSI_MID_FLAGS[mid];
}

export function aisBoxCovers(
  box: [[number, number], [number, number]],
  lat: number,
  lon: number,
): boolean {
  const latMin = Math.min(box[0][0], box[1][0]);
  const latMax = Math.max(box[0][0], box[1][0]);
  const lonMin = Math.min(box[0][1], box[1][1]);
  const lonMax = Math.max(box[0][1], box[1][1]);
  return lat >= latMin && lat <= latMax && lon >= lonMin && lon <= lonMax;
}

export function hasValidAisCoordinates(lat: unknown, lng: unknown): boolean {
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

export type AisPruneCandidate = {
  mmsi: number;
  lat: number;
  lng: number;
  timestamp: number;
};

/**
 * Drop overflow from the densest 5° cells first so a chatty North Sea cell
 * cannot evict the only ship in the Arabian Sea.
 */
export function evictOverflowMmsis(
  ships: Iterable<AisPruneCandidate>,
  max: number,
  cellDeg = 5,
): number[] {
  const list = Array.from(ships);
  if (list.length <= max) return [];
  const cells = new Map<string, AisPruneCandidate[]>();
  for (const ship of list) {
    const key = `${Math.floor(ship.lat / cellDeg)}_${Math.floor(ship.lng / cellDeg)}`;
    const bucket = cells.get(key);
    if (bucket) bucket.push(ship);
    else cells.set(key, [ship]);
  }
  for (const bucket of cells.values()) {
    bucket.sort((a, b) => a.timestamp - b.timestamp);
  }
  const toDrop: number[] = [];
  let extra = list.length - max;
  while (extra > 0) {
    let densest: AisPruneCandidate[] | null = null;
    for (const bucket of cells.values()) {
      if (!densest || bucket.length > densest.length) densest = bucket;
    }
    if (!densest || densest.length === 0) break;
    const victim = densest.shift();
    if (!victim) break;
    toDrop.push(victim.mmsi);
    extra -= 1;
  }
  return toDrop;
}

export function normalizeAisMessage(raw: unknown): NormalizedAisShipUpdate | null {
  if (!raw || typeof raw !== 'object') return null;

  const aisMessage = raw as AisMessage;
  const messageType = aisMessage.MessageType as AisMessageType | undefined;
  if (!messageType) return null;

  const metadata = aisMessage.MetaData || aisMessage.Metadata || {};
  const body = getMessageBody(aisMessage, messageType);
  const mmsi = readMmsi(metadata, body);
  if (!mmsi) return null;

  const update: NormalizedAisShipUpdate = { mmsi };
  const metadataName = cleanAisText(metadata.ShipName);
  if (metadataName) update.name = metadataName;
  const flag = flagFromMmsi(mmsi);
  if (flag) update.flag = flag;

  if (isPositionMessageType(messageType)) {
    const lat = readNumber(body.Latitude ?? metadata.Latitude ?? metadata.latitude);
    const lng = readNumber(body.Longitude ?? metadata.Longitude ?? metadata.longitude);
    if (!hasValidAisCoordinates(lat, lng)) return null;

    update.lat = lat;
    update.lng = lng;
    update.speed = readNumber(body.Sog);
    update.heading = readHeading(body.TrueHeading, body.Cog);
    update.timestamp = Date.now();
    const nav = readNavStatus(body.NavigationalStatus);
    if (nav) update.navStatus = nav;

    const bodyName = cleanAisText(body.Name);
    if (bodyName) update.name = bodyName;

    const shipType = getSentraShipType(body.Type ?? body.ShipType);
    if (shipType) update.type = shipType;

    return dropUndefined(update);
  }

  if (messageType === 'ShipStaticData') {
    applyStaticIdentity(update, body);
    return dropUndefined(update);
  }

  if (messageType === 'StaticDataReport') {
    const reportA = readRecord(body.ReportA);
    const reportB = readRecord(body.ReportB);
    const name = cleanAisText(reportA.Name);
    const shipType = getSentraShipType(reportB.ShipType ?? reportB.Type);
    const callsign = cleanAisText(reportB.CallSign);
    if (name) update.name = name;
    if (shipType) update.type = shipType;
    if (callsign) update.callsign = callsign;
    applyDimensions(update, reportB.Dimension || reportB.Dimensions);
    return dropUndefined(update);
  }

  return null;
}

/** Tight map payload: identity stays on `/api/maritime?mmsi=` for the intel panel. */
export function compactAisShipForMap(ship: NormalizedAisShipUpdate & { lat: number; lng: number }): Record<string, unknown> {
  const name = typeof ship.name === 'string' ? ship.name.slice(0, 24) : '';
  return {
    mmsi: ship.mmsi,
    lat: Math.round(ship.lat * 1e5) / 1e5,
    lng: Math.round(ship.lng * 1e5) / 1e5,
    heading: typeof ship.heading === 'number' ? Math.round(ship.heading) : 0,
    speed: typeof ship.speed === 'number' ? Math.round(ship.speed * 10) / 10 : 0,
    type: ship.type || 'other',
    name,
    flag: ship.flag || '',
    imo: ship.imo || 0,
  };
}

export function mergeAisShipUpdate(
  existing: NormalizedAisShipUpdate | undefined,
  update: NormalizedAisShipUpdate,
): NormalizedAisShipUpdate {
  return dropUndefined({
    ...existing,
    ...update,
    mmsi: update.mmsi,
  });
}

function isPositionMessageType(messageType: string): boolean {
  return (AIS_POSITION_MESSAGE_TYPES as readonly string[]).includes(messageType);
}

function getMessageBody(aisMessage: AisMessage, messageType: string): Record<string, unknown> {
  const message = aisMessage.Message || {};
  return readRecord(message[messageType]);
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function readMmsi(...sources: Record<string, unknown>[]): number | null {
  for (const source of sources) {
    const value = readNumber(source.MMSI ?? source.UserID);
    if (value && Number.isInteger(value)) return value;
  }
  return null;
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function readHeading(trueHeading: unknown, courseOverGround: unknown): number | undefined {
  const heading = readNumber(trueHeading);
  if (heading !== undefined && heading !== INVALID_TRUE_HEADING) return heading;
  return readNumber(courseOverGround);
}

function readNavStatus(value: unknown): string | undefined {
  const code = readNumber(value);
  if (code === undefined) return undefined;
  return NAV_STATUS[code] || `status-${code}`;
}

function applyStaticIdentity(update: NormalizedAisShipUpdate, body: Record<string, unknown>): void {
  const name = cleanAisText(body.Name);
  const destination = cleanAisText(body.Destination);
  const callsign = cleanAisText(body.CallSign);
  const shipType = getSentraShipType(body.Type);
  const imo = readNumber(body.ImoNumber ?? body.IMO);
  const draught = readNumber(body.MaximumStaticDraught ?? body.Draught);
  if (name) update.name = name;
  if (destination) update.destination = destination;
  if (callsign) update.callsign = callsign;
  if (shipType) update.type = shipType;
  if (imo && imo > 0) update.imo = imo;
  if (draught && draught > 0) update.draught = draught;
  applyDimensions(update, body.Dimension || body.Dimensions);
  const eta = formatAisEta(body.Eta ?? body.ETA);
  if (eta) update.eta = eta;
}

function applyDimensions(update: NormalizedAisShipUpdate, raw: unknown): void {
  const dim = readRecord(raw);
  const a = readNumber(dim.A);
  const b = readNumber(dim.B);
  const c = readNumber(dim.C);
  const d = readNumber(dim.D);
  if (a !== undefined && b !== undefined) update.length = a + b;
  if (c !== undefined && d !== undefined) update.beam = c + d;
}

function formatAisEta(raw: unknown): string | undefined {
  const eta = readRecord(raw);
  const month = readNumber(eta.Month ?? eta.month);
  const day = readNumber(eta.Day ?? eta.day);
  const hour = readNumber(eta.Hour ?? eta.hour);
  const minute = readNumber(eta.Minute ?? eta.minute);
  if (!month || !day) return undefined;
  const hh = String(hour ?? 0).padStart(2, '0');
  const mm = String(minute ?? 0).padStart(2, '0');
  return `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')} ${hh}:${mm}`;
}

function cleanAisText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const cleaned = value.replace(/@+$/g, '').trim();
  return cleaned || undefined;
}

function dropUndefined<T extends object>(value: T): T {
  for (const key of Object.keys(value) as Array<keyof T>) {
    if (value[key] === undefined) {
      delete value[key];
    }
  }
  return value;
}
