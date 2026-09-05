import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

const root = process.cwd();

async function importTsModule(relativePath) {
  const sourcePath = resolve(root, relativePath);
  const source = readFileSync(sourcePath, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
    },
    fileName: sourcePath,
  });
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(transpiled.outputText).toString('base64')}`;
  return import(moduleUrl);
}

const ais = await importTsModule('src/lib/ais.ts');
const {
  AIS_POSITION_MESSAGE_TYPES,
  normalizeAisMessage,
} = ais;

assert.deepEqual(AIS_POSITION_MESSAGE_TYPES, [
  'PositionReport',
  'StandardClassBPositionReport',
  'ExtendedClassBPositionReport',
  'LongRangeAisBroadcastMessage',
]);

const classA = normalizeAisMessage({
  MessageType: 'PositionReport',
  MetaData: {
    MMSI: 366123456,
    ShipName: '  SENTRA TRADER  ',
  },
  Message: {
    PositionReport: {
      Latitude: 18.47,
      Longitude: -69.88,
      Sog: 12.4,
      TrueHeading: 271,
      Cog: 270.5,
      UserID: 366123456,
    },
  },
});

assert.deepEqual(classA, {
  mmsi: 366123456,
  name: 'SENTRA TRADER',
  flag: 'United States',
  lat: 18.47,
  lng: -69.88,
  speed: 12.4,
  heading: 271,
  timestamp: classA.timestamp,
});
assert.equal(typeof classA.timestamp, 'number');

const classB = normalizeAisMessage({
  MessageType: 'ExtendedClassBPositionReport',
  MetaData: {
    MMSI: 257702970,
    ShipName: '',
  },
  Message: {
    ExtendedClassBPositionReport: {
      Latitude: 22.31483,
      Longitude: 114.510795,
      Sog: 6.1,
      Cog: 234.5,
      TrueHeading: 511,
      Name: '  MI8 PILOT BOAT ',
      Type: 37,
      UserID: 257702970,
    },
  },
});

assert.equal(classB.mmsi, 257702970);
assert.equal(classB.name, 'MI8 PILOT BOAT');
assert.equal(classB.lat, 22.31483);
assert.equal(classB.lng, 114.510795);
assert.equal(classB.speed, 6.1);
assert.equal(classB.heading, 234.5);
assert.equal(classB.type, 'pleasure');
assert.equal(classB.flag, 'Norway');

const staticData = normalizeAisMessage({
  MessageType: 'StaticDataReport',
  MetaData: {
    MMSI: 257702970,
  },
  Message: {
    StaticDataReport: {
      ReportA: {
        Name: '  CLASS B STATIC ',
        Valid: true,
      },
      ReportB: {
        ShipType: 80,
        Valid: true,
      },
      UserID: 257702970,
    },
  },
});

assert.equal(staticData.mmsi, 257702970);
assert.equal(staticData.name, 'CLASS B STATIC');
assert.equal(staticData.type, 'tanker');
assert.equal(staticData.lat, undefined);
assert.equal(staticData.lng, undefined);

const voyage = normalizeAisMessage({
  MessageType: 'ShipStaticData',
  MetaData: { MMSI: 244183052, ShipName: 'NAIRA' },
  Message: {
    ShipStaticData: {
      UserID: 244183052,
      ImoNumber: 9321483,
      CallSign: 'PDAB',
      Name: 'NAIRA',
      Type: 80,
      Destination: 'ROTTERDAM',
      MaximumStaticDraught: 11.2,
      Dimension: { A: 150, B: 30, C: 12, D: 12 },
      Eta: { Month: 8, Day: 23, Hour: 14, Minute: 0 },
    },
  },
});
assert.equal(voyage.imo, 9321483);
assert.equal(voyage.callsign, 'PDAB');
assert.equal(voyage.destination, 'ROTTERDAM');
assert.equal(voyage.flag, 'Netherlands');
assert.equal(voyage.length, 180);
assert.equal(voyage.beam, 24);
assert.equal(voyage.eta, '08-23 14:00');

const { AIS_WORLD_BOUNDING_BOXES, AIS_FEED_BOXES, AIS_FEED_IDS, aisBoxCovers, flagFromMmsi, evictOverflowMmsis } = ais;
assert.equal(flagFromMmsi(244183052), 'Netherlands');
assert.deepEqual([...AIS_FEED_IDS].sort(), ['americas', 'europe', 'indopacific']);
assert.equal(AIS_FEED_IDS.length, 3, 'AISStream allows 3 subscribed connections');
assert.ok(AIS_WORLD_BOUNDING_BOXES.some((box) => aisBoxCovers(box, 51.9, 4.5)), 'Rotterdam must be inside a live AIS box');
assert.ok(AIS_WORLD_BOUNDING_BOXES.some((box) => aisBoxCovers(box, 1.26, 103.84)), 'Singapore must be inside a live AIS box');
assert.ok(AIS_WORLD_BOUNDING_BOXES.some((box) => aisBoxCovers(box, 18.4, -66.1)), 'Caribbean must be inside a live AIS box');
assert.ok(AIS_FEED_BOXES.europe.some((box) => aisBoxCovers(box, 51.9, 4.5)), 'Europe feed must cover Rotterdam');
assert.ok(AIS_FEED_BOXES.americas.some((box) => aisBoxCovers(box, 18.4, -66.1)), 'Americas feed must cover the Caribbean');
assert.ok(AIS_FEED_BOXES.americas.some((box) => aisBoxCovers(box, -23.95, -46.31)), 'Americas feed must cover Santos');
assert.ok(AIS_FEED_BOXES.indopacific.some((box) => aisBoxCovers(box, 19.07, 72.88)), 'Indo-Pacific feed must cover Mumbai');
assert.ok(AIS_FEED_BOXES.indopacific.some((box) => aisBoxCovers(box, 26.57, 56.25)), 'Indo-Pacific feed must cover Hormuz');
assert.ok(AIS_FEED_BOXES.indopacific.some((box) => aisBoxCovers(box, 1.26, 103.84)), 'Indo-Pacific feed must cover Singapore');
assert.ok(AIS_FEED_BOXES.indopacific.some((box) => aisBoxCovers(box, 38.09, -28.23)), 'Indo-Pacific feed must cover the Azores / mid-Atlantic');
assert.ok(AIS_FEED_BOXES.indopacific.some((box) => aisBoxCovers(box, 30.0, -160.0)), 'Indo-Pacific feed must cover the open North Pacific');
assert.equal(
  AIS_FEED_BOXES.europe.some((box) => aisBoxCovers(box, 19.07, 72.88)),
  false,
  'Europe feed must not also own Mumbai — that is what starved Asia',
);
assert.equal(
  AIS_WORLD_BOUNDING_BOXES.some((box) => box[0][0] === -90 && box[0][1] === -180),
  false,
  'a single sampled world box is not used',
);

const denseEurope = Array.from({ length: 40 }, (_, i) => ({ mmsi: 1000 + i, lat: 52, lng: 4, timestamp: 1000 + i }));
const lonelyGulf = [{ mmsi: 999001, lat: 26.5, lng: 56.2, timestamp: 1 }];
const evicted = evictOverflowMmsis([...denseEurope, ...lonelyGulf], 20);
assert.equal(evicted.includes(999001), false, 'spatial prune must keep the only Gulf ship');
assert.equal(evicted.length, 21);
assert.ok(evicted.every((mmsi) => mmsi >= 1000 && mmsi < 1040));

const maritimeSrc = readFileSync(resolve(root, 'src/app/api/maritime/route.ts'), 'utf8');
assert.match(maritimeSrc, /perMessageDeflate:\s*true/);
assert.match(maritimeSrc, /getProviderEnv\(\)/);
assert.match(maritimeSrc, /AIS_FEED_BOXES/);
assert.match(maritimeSrc, /connectAisFeed/);
assert.match(maritimeSrc, /evictOverflowMmsis/);
assert.equal(maritimeSrc.includes('[[-90, -180], [90, 180]]'), false);

const vesselIntel = await importTsModule('src/lib/vessel-intel.ts');
const snap = vesselIntel.buildVesselSnapshot(
  { mmsi: 244183052, name: 'NAIRA' },
  [{ mmsi: 244183052, name: 'NAIRA', lat: 51.8, lng: 4.8, speed: 0, heading: 360, flag: 'Netherlands', type: 'tanker', destination: 'ROTTERDAM', timestamp: Date.now() }],
);
assert.equal(snap.stale, false);
assert.equal(snap.flag, 'Netherlands');
assert.equal(snap.mmsi, '244183052');
assert.ok(vesselIntel.buildVesselSourceLinks(snap).some((l) => l.id === 'marinetraffic'));

const vesselPhoto = await importTsModule('src/lib/vessel-photo.ts');
assert.deepEqual(vesselPhoto.buildVesselPhotoQueries({ name: 'NAIRA', imo: 9321483, type: 'tanker' }), ['NAIRA ship', 'NAIRA vessel', 'IMO 9321483', 'oil tanker ship']);
assert.deepEqual(vesselPhoto.buildVesselPhotoQueries({ mmsi: 244183052 }), [], 'MMSI-only searches are too noisy for Commons');
const commonsPage = (title, url) => ({
  query: { pages: [{ title, imageinfo: [{ url, descriptionurl: url }] }] },
});
assert.equal(
  vesselPhoto.selectVesselCommonsImage(
    commonsPage('File:APL Spain (ship, 2004) 001.jpg', 'https://upload.wikimedia.org/spain.jpg'),
    'APL VANCOUVER ship',
  ).imageUrl,
  null,
  'sister-ship Commons hits must not be used as the photographed vessel',
);
assert.equal(
  vesselPhoto.selectVesselCommonsImage(
    commonsPage('File:APL Vancouver container ship at sea.jpg', 'https://upload.wikimedia.org/vancouver.jpg'),
    'APL VANCOUVER ship',
  ).imageUrl,
  'https://upload.wikimedia.org/vancouver.jpg',
);
assert.equal(
  vesselPhoto.selectVesselCommonsImage(
    commonsPage('File:Fort Nassau te Bandanaira op Poelau Naira.jpg', 'https://upload.wikimedia.org/fort.jpg'),
    'NAIRA ship',
  ).imageUrl,
  null,
  'place-name Commons hits must not stand in for a vessel photo',
);

const compact = ais.compactAisShipForMap({
  mmsi: 244183052, name: 'NAIRA WITH A VERY LONG DISPLAY NAME', lat: 51.809205, lng: 4.876083333,
  heading: 359.6, speed: 12.44, type: 'tanker', flag: 'Netherlands', imo: 9321483,
  destination: 'ROTTERDAM', timestamp: Date.now(),
});
assert.equal(compact.mmsi, 244183052);
assert.equal(compact.name, 'NAIRA WITH A VERY LONG D');
assert.equal(compact.destination, undefined, 'map payload must not carry voyage text');
assert.equal(maritimeSrc.includes('compactAisShipForMap'), true);

const mapSrc = readFileSync(resolve(root, 'src/components/SentraMap.tsx'), 'utf8');
assert.match(mapSrc, /type:\s*'vessel'/);
assert.match(mapSrc, /mmsi:\s*s\.mmsi/);
assert.match(mapSrc, /createShipIcon/);
assert.match(mapSrc, /'icon-allow-overlap': true/);
assert.match(mapSrc, /ship-cyan/);
assert.match(mapSrc, /minzoom:\s*3/);
assert.match(mapSrc, /maxzoom:\s*3/);
assert.match(mapSrc, /'ship-halo'/);
assert.match(mapSrc, /onShipClick/);
assert.match(mapSrc, /onEntityClick\?\.\(\{[\s\S]*type:\s*'vessel'/);
assert.equal(mapSrc.includes('UNIDENTIFIED VESSEL'), false, 'ship click must not also open a map popup');
const panelSrc = readFileSync(resolve(root, 'src/components/EntityGraphPanel.tsx'), 'utf8');
assert.match(panelSrc, /\/api\/vessel\/photo/);
assert.match(panelSrc, /LIVE AIS/);

const zeroCoordinate = normalizeAisMessage({
  MessageType: 'PositionReport',
  MetaData: {
    MMSI: 111000111,
  },
  Message: {
    PositionReport: {
      Latitude: 0,
      Longitude: 0,
      Sog: 0,
      Cog: 0,
      UserID: 111000111,
    },
  },
});

assert.equal(zeroCoordinate.lat, 0);
assert.equal(zeroCoordinate.lng, 0);

assert.equal(normalizeAisMessage({
  MessageType: 'PositionReport',
  MetaData: { MMSI: 123 },
  Message: {
    PositionReport: {
      Latitude: 91,
      Longitude: -69,
      UserID: 123,
    },
  },
}), null);

console.log('AIS parser tests passed.');
