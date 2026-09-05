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

const aircraftIntel = await importTsModule('src/lib/aircraft-intel.ts');
const aircraftPhoto = await importTsModule('src/lib/aircraft-photo.ts');

const {
  findAircraftInFlightFeed,
  buildAircraftSnapshot,
  buildAircraftSourceLinks,
  overlayAircraftLookup,
  adsbRecordToLookupTarget,
} = aircraftIntel;
const {
  buildAircraftPhotoQueries,
  fetchWikimediaAircraftPhoto,
  fetchAircraftPhoto,
  selectPlanespottersPhoto,
} = aircraftPhoto;

const feed = {
  timestamp: '2026-06-13T01:00:00.000Z',
  commercial_flights: [
    {
      callsign: 'DAL123',
      icao24: 'a1b2c3',
      registration: 'N123DA',
      model: 'B738',
      lat: 33.64,
      lng: -84.43,
      alt: 10363,
      speed_knots: 451.2,
      heading: 91,
      squawk: '1200',
      category: 'commercial',
      aircraft_category: 'plane',
      grounded: false,
      nac_p: 8,
      source: 'ADS-B / adsb.lol',
    },
  ],
  private_flights: [],
  private_jets: [
    {
      callsign: 'N869QS',
      icao24: 'abf1b5',
      registration: 'N869QS',
      model: 'C700',
      lat: 18.4291,
      lng: -69.6689,
      alt: 12497,
      speed_knots: 402.6,
      heading: 274,
      squawk: '4567',
      category: 'jet',
      aircraft_category: 'plane',
      grounded: false,
      nac_p: 9,
    },
  ],
  military_flights: [],
};

const icaoMatch = findAircraftInFlightFeed({ icao24: 'ABF1B5' }, feed);
assert.equal(icaoMatch?.matchKey, 'icao24');
assert.equal(icaoMatch?.aircraft.registration, 'N869QS');

const fallbackMatch = findAircraftInFlightFeed({ callsign: ' n869qs ', registration: 'N869QS' }, feed);
assert.equal(fallbackMatch?.matchKey, 'callsign');
assert.equal(fallbackMatch?.aircraft.icao24, 'abf1b5');

const liveSnapshot = buildAircraftSnapshot(
  { callsign: 'N869QS', registration: 'N869QS', icao24: 'abf1b5' },
  feed,
);
assert.equal(liveSnapshot.stale, false);
assert.equal(liveSnapshot.matchKey, 'icao24');
assert.equal(liveSnapshot.altitude, 12497);
assert.equal(liveSnapshot.feedTimestamp, '2026-06-13T01:00:00.000Z');
assert.equal(liveSnapshot.source, 'ADS-B / adsb.lol');

const staleSnapshot = buildAircraftSnapshot(
  { callsign: 'N869QS', registration: 'N869QS', icao24: 'abf1b5' },
  { timestamp: '2026-06-13T01:00:45.000Z', commercial_flights: [], private_flights: [], private_jets: [], military_flights: [] },
  liveSnapshot,
);
assert.equal(staleSnapshot.stale, true);
assert.equal(staleSnapshot.altitude, 12497);
assert.equal(staleSnapshot.offFeedSince, '2026-06-13T01:00:45.000Z');

const links = buildAircraftSourceLinks(liveSnapshot);
assert.deepEqual(
  links.map((link) => link.id),
  ['flightaware', 'adsbexchange', 'radarbox', 'faa-registry'],
);
assert.equal(links.find((link) => link.id === 'adsbexchange')?.url, 'https://globe.adsbexchange.com/?icao=abf1b5');
assert.equal(
  links.find((link) => link.id === 'faa-registry')?.url,
  'https://registry.faa.gov/AircraftInquiry/Search/NNumberResult?nNumberTxt=869QS',
);

assert.deepEqual(
  buildAircraftPhotoQueries({ registration: 'N869QS', model: 'C700', icao24: 'abf1b5' }),
  ['N869QS', 'C700 aircraft'],
);

assert.deepEqual(
  buildAircraftPhotoQueries({
    registration: 'N/A',
    model: 'Unknown',
    icao24: 'a2653c',
    callsign: 'N25315',
  }),
  ['N25315'],
  'GA callsign is usable as a tail number when OpenSky leaves REG empty',
);
assert.deepEqual(
  buildAircraftPhotoQueries({ icao24: 'a2653c' }),
  [],
  'ICAO hex must not be sent to Commons — it misses, and raw N-number search has returned unrelated photos',
);

const n25315Snapshot = buildAircraftSnapshot({
  callsign: 'N25315',
  registration: 'N/A',
  icao24: 'a2653c',
  model: 'Unknown',
  altitude: 610,
  speed_knots: 89,
  heading: 115,
  category: 'commercial',
  lat: 18.4036,
  lng: -65.644,
  grounded: false,
  source: 'OpenSky Network',
}, null);
assert.equal(n25315Snapshot.registration, 'N25315');
assert.equal(n25315Snapshot.model, '');
assert.equal(n25315Snapshot.icao24, 'a2653c');
assert.equal(
  aircraftIntel.inferAircraftRegistration('N/A', 'N25315'),
  'N25315',
);

const lookedUpSnapshot = overlayAircraftLookup(
  n25315Snapshot,
  adsbRecordToLookupTarget({ hex: 'a2653c', flight: 'N25315', r: 'N25315', t: 'TB9', squawk: '1200', nac_p: 8 }),
);
assert.equal(lookedUpSnapshot.model, 'TB9');
assert.equal(lookedUpSnapshot.registration, 'N25315');
assert.equal(lookedUpSnapshot.squawk, '1200');
assert.equal(lookedUpSnapshot.nacP, 8);

const fakeCommonsPayload = {
  query: {
    pages: {
      '42': {
        title: 'File:N869QS aircraft.jpg',
        imageinfo: [
          {
            url: 'https://upload.wikimedia.org/wikipedia/commons/4/42/N869QS_aircraft.jpg',
            descriptionurl: 'https://commons.wikimedia.org/wiki/File:N869QS_aircraft.jpg',
            extmetadata: {
              Artist: { value: 'Commons contributor' },
              LicenseShortName: { value: 'CC BY-SA 4.0' },
            },
          },
        ],
      },
    },
  },
};

const photo = await fetchWikimediaAircraftPhoto(
  { registration: 'N869QS', model: 'C700' },
  async () => new Response(JSON.stringify(fakeCommonsPayload), { status: 200 }),
);
assert.equal(photo.imageUrl, 'https://upload.wikimedia.org/wikipedia/commons/4/42/N869QS_aircraft.jpg');
assert.equal(photo.sourceName, 'Wikimedia Commons');
assert.equal(photo.sourceUrl, 'https://commons.wikimedia.org/wiki/File:N869QS_aircraft.jpg');
assert.equal(photo.attribution, 'Commons contributor');
assert.equal(photo.license, 'CC BY-SA 4.0');
assert.equal(photo.query, 'N869QS');
assert.equal(photo.fallback, false);

const blockedPhoto = await fetchWikimediaAircraftPhoto(
  { registration: 'N869QS' },
  async () => new Response(JSON.stringify({
    query: {
      pages: {
        '99': {
          title: 'File:bad.svg',
          imageinfo: [{ url: 'javascript:alert(1)', descriptionurl: 'https://commons.wikimedia.org/wiki/File:bad.svg' }],
        },
      },
    },
  }), { status: 200 }),
);
assert.equal(blockedPhoto.imageUrl, null);
assert.equal(blockedPhoto.fallback, true);

const planespottersPayload = {
  photos: [{
    id: '1192842',
    thumbnail: { src: 'https://t.plnspttrs.net/41354/1192842_41b671d7f0_t.jpg' },
    thumbnail_large: { src: 'https://t.plnspttrs.net/41354/1192842_41b671d7f0_280.jpg' },
    link: 'https://www.planespotters.net/photo/1192842/n25315-private-socata-tb-9-tampico-club?utm_source=api',
    photographer: 'Jose L Roldan',
  }],
};
const planespotters = selectPlanespottersPhoto(planespottersPayload, 'a2653c');
assert.equal(planespotters.imageUrl, 'https://t.plnspttrs.net/41354/1192842_41b671d7f0_280.jpg');
assert.equal(planespotters.sourceName, 'Planespotters.net');
assert.match(planespotters.sourceUrl, /planespotters\.net\/photo\/1192842/);
assert.equal(planespotters.attribution, 'Jose L Roldan');
assert.equal(planespotters.fallback, false);

const photoCalls = [];
const n25315Photo = await fetchAircraftPhoto(
  { registration: 'N/A', model: 'Unknown', icao24: 'a2653c', callsign: 'N25315' },
  async (url) => {
    photoCalls.push(String(url));
    if (String(url).includes('planespotters.net/pub/photos/hex/a2653c')) {
      return new Response(JSON.stringify(planespottersPayload), { status: 200 });
    }
    return new Response('unexpected', { status: 500 });
  },
);
assert.equal(n25315Photo.imageUrl, 'https://t.plnspttrs.net/41354/1192842_41b671d7f0_280.jpg');
assert.equal(n25315Photo.sourceName, 'Planespotters.net');
assert.equal(photoCalls.length, 1, 'hex lookup must succeed without falling through to Commons');
assert.match(photoCalls[0], /planespotters\.net\/pub\/photos\/hex\/a2653c/);

const unrelatedCommons = await fetchWikimediaAircraftPhoto(
  { callsign: 'N25315' },
  async () => new Response(JSON.stringify({
    query: {
      pages: [{
        title: 'File:"Aunt Sukey" African American slave of Robert B. Smith family.jpg',
        imageinfo: [{
          url: 'https://upload.wikimedia.org/wikipedia/commons/3/3a/unrelated.jpg',
          descriptionurl: 'https://commons.wikimedia.org/wiki/File:unrelated.jpg',
        }],
      }],
    },
  }), { status: 200 }),
);
assert.equal(unrelatedCommons.imageUrl, null, 'Commons hits that are not aircraft photos must be rejected');

const photoRouteSrc = readFileSync(resolve(root, 'src/app/api/aircraft/photo/route.ts'), 'utf8');
assert.match(photoRouteSrc, /fetchAircraftPhoto/);
assert.match(photoRouteSrc, /callsign/);
const panelSrc = readFileSync(resolve(root, 'src/components/EntityGraphPanel.tsx'), 'utf8');
assert.match(panelSrc, /params\.set\('callsign'/);
assert.match(panelSrc, /aircraftPhoto\.sourceName/);

console.log('Aircraft live intel tests passed.');
