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
assert.equal(classB.type, 'cargo');

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
