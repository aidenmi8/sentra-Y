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

export function getSentraShipType(typeCode: unknown): string | undefined {
  const code = typeof typeCode === 'number' ? typeCode : Number(typeCode);
  if (!Number.isFinite(code) || code <= 0) return undefined;
  if (code >= 80 && code <= 89) return 'tanker';
  if (code >= 70 && code <= 79) return 'cargo';
  if (code === 35) return 'military';
  return 'cargo';
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

  if (isPositionMessageType(messageType)) {
    const lat = readNumber(body.Latitude ?? metadata.Latitude ?? metadata.latitude);
    const lng = readNumber(body.Longitude ?? metadata.Longitude ?? metadata.longitude);
    if (!hasValidAisCoordinates(lat, lng)) return null;

    update.lat = lat;
    update.lng = lng;
    update.speed = readNumber(body.Sog);
    update.heading = readHeading(body.TrueHeading, body.Cog);
    update.timestamp = Date.now();

    const bodyName = cleanAisText(body.Name);
    if (bodyName) update.name = bodyName;

    const shipType = getSentraShipType(body.Type ?? body.ShipType);
    if (shipType) update.type = shipType;

    return dropUndefined(update);
  }

  if (messageType === 'ShipStaticData') {
    const name = cleanAisText(body.Name);
    const destination = cleanAisText(body.Destination);
    const shipType = getSentraShipType(body.Type);

    if (name) update.name = name;
    if (destination) update.destination = destination;
    if (shipType) update.type = shipType;

    return dropUndefined(update);
  }

  if (messageType === 'StaticDataReport') {
    const reportA = readRecord(body.ReportA);
    const reportB = readRecord(body.ReportB);
    const name = cleanAisText(reportA.Name);
    const shipType = getSentraShipType(reportB.ShipType);

    if (name) update.name = name;
    if (shipType) update.type = shipType;

    return dropUndefined(update);
  }

  return null;
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
