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

const providers = await importTsModule('src/lib/flight-providers.ts');
const {
  OPENSKY_TOKEN_URL,
  createOpenSkyTokenRequest,
  normalizeOpenSkyState,
  classifyOpenSkyFlight,
  resetOpenSkyTokenCacheForTests,
  fetchOpenSkyFlightData,
  fetchFlightData,
  ADSB_COVERAGE_REGIONS,
  adsbRegionCovers,
  lookupAdsbAircraftByHex,
} = providers;

// ── Classification from the signals OpenSky actually publishes ──
// Every record used to be hardcoded 'commercial', which emptied three layers.
assert.equal(classifyOpenSkyFlight('RCH271', '', 6), 'military');
assert.equal(classifyOpenSkyFlight('REACH12', '', null), 'military');
assert.equal(classifyOpenSkyFlight('ANYTHING', '', 7), 'military', 'high-performance emitter category is military');
assert.equal(classifyOpenSkyFlight('DAL123', 'DAL', 4), 'commercial');
assert.equal(classifyOpenSkyFlight('N556XY', '', 2), 'private', 'light category with no airline code');
assert.equal(classifyOpenSkyFlight('N90XT', '', 3), 'jet', 'business-jet weight class');
assert.equal(classifyOpenSkyFlight('N90XT', '', 6), 'commercial', 'heavy with no airline code');
// An airline prefix outranks the weight class.
assert.equal(classifyOpenSkyFlight('BAW22', 'BAW', 2), 'commercial');

const tokenRequest = createOpenSkyTokenRequest('client-id', 'client-secret');
assert.equal(tokenRequest.url, OPENSKY_TOKEN_URL);
assert.equal(tokenRequest.init.method, 'POST');
assert.equal(tokenRequest.init.headers['Content-Type'], 'application/x-www-form-urlencoded');
assert.equal(tokenRequest.init.body.toString(), 'grant_type=client_credentials&client_id=client-id&client_secret=client-secret');

const normalized = normalizeOpenSkyState([
  'abc123',
  ' DAL123  ',
  'United States',
  1710000000,
  1710000005,
  -73.7781,
  40.6413,
  3000,
  false,
  230,
  91.5,
  -1.2,
  null,
  3100,
  '1200',
  false,
  0,
  8,
], 1710000010);
assert.equal(normalized.callsign, 'DAL123');
assert.equal(normalized.icao24, 'abc123');
assert.equal(normalized.lat, 40.6413);
assert.equal(normalized.lng, -73.7781);
assert.equal(normalized.alt, 3000);
assert.equal(normalized.speed_knots, 447);
assert.equal(normalized.heading, 92);
assert.equal(normalized.squawk, '1200');
assert.equal(normalized.aircraft_category, 'heli');
assert.equal(normalized.model, '');
assert.equal(normalized.registration, '');
assert.equal(normalized.source, 'OpenSky Network');
assert.equal(normalized.feed_timestamp, '2024-03-09T16:00:10.000Z');

assert.equal(normalizeOpenSkyState(['abc123', 'NOLOC', 'US', null, null, null, 40], 1710000010), null);
assert.equal(normalizeOpenSkyState(['abc123', null, 'US', null, null, -73, null], 1710000010), null);

resetOpenSkyTokenCacheForTests();
const tokenCalls = [];
const openSkyFetch = async (url, init) => {
  tokenCalls.push({ url: String(url), auth: init?.headers?.Authorization || '' });
  if (String(url) === OPENSKY_TOKEN_URL) {
    return new Response(JSON.stringify({ access_token: 'token-one', expires_in: 1800 }), { status: 200 });
  }
  return new Response(JSON.stringify({
    time: 1710000010,
    states: [
      ['abc123', 'DAL123', 'United States', 1710000000, 1710000005, -73.7781, 40.6413, 3000, false, 230, 91.5, null, null, 3100, '1200', false, 0, 4],
    ],
  }), { status: 200 });
};
const openSkyData = await fetchOpenSkyFlightData({
  env: { OPENSKY_CLIENT_ID: 'client-id', OPENSKY_CLIENT_SECRET: 'client-secret' },
  fetcher: openSkyFetch,
  nowMs: 1710000010000,
});
assert.equal(openSkyData.total, 1);
assert.equal(openSkyData.commercial_flights[0].source, 'OpenSky Network');
assert.equal(tokenCalls.filter((call) => call.url === OPENSKY_TOKEN_URL).length, 1);
assert.equal(tokenCalls.some((call) => call.auth === 'Bearer token-one'), true);

const cachedOpenSkyData = await fetchOpenSkyFlightData({
  env: { OPENSKY_CLIENT_ID: 'client-id', OPENSKY_CLIENT_SECRET: 'client-secret' },
  fetcher: openSkyFetch,
  nowMs: 1710000020000,
});
assert.equal(cachedOpenSkyData.total, 1);
assert.equal(tokenCalls.filter((call) => call.url === OPENSKY_TOKEN_URL).length, 1);

resetOpenSkyTokenCacheForTests();
let stateAttempt = 0;
const refreshFetch = async (url, init) => {
  if (String(url) === OPENSKY_TOKEN_URL) {
    return new Response(JSON.stringify({ access_token: `token-${stateAttempt}`, expires_in: 1800 }), { status: 200 });
  }
  stateAttempt++;
  if (stateAttempt === 1) return new Response('', { status: 401 });
  assert.equal(init.headers.Authorization, 'Bearer token-1');
  return new Response(JSON.stringify({
    time: 1710000010,
    states: [['def456', 'UAL456', 'United States', null, 1710000005, -80, 25, 2000, false, 180, 270, null, null, 2100, null, false, 0, 0]],
  }), { status: 200 });
};
const refreshedData = await fetchOpenSkyFlightData({
  env: { OPENSKY_CLIENT_ID: 'client-id', OPENSKY_CLIENT_SECRET: 'client-secret' },
  fetcher: refreshFetch,
  nowMs: 1710000010000,
});
assert.equal(refreshedData.total, 1);
assert.equal(refreshedData.commercial_flights[0].icao24, 'def456');

resetOpenSkyTokenCacheForTests();
const fallbackCalls = [];
const providerFetch = async (url) => {
  fallbackCalls.push(String(url));
  if (String(url) === OPENSKY_TOKEN_URL) {
    return new Response(JSON.stringify({ access_token: 'token-fallback', expires_in: 1800 }), { status: 200 });
  }
  if (String(url).includes('opensky-network.org/api/states/all')) {
    return new Response(JSON.stringify({ time: 1710000010, states: [] }), { status: 200 });
  }
  if (String(url).includes('api.adsb.lol')) {
    return new Response(JSON.stringify({
      ac: [{
        hex: 'a1b2c3',
        flight: 'AAL123 ',
        lat: 32.8,
        lon: -97.0,
        alt_baro: 30000,
        gs: 410,
        track: 135,
        t: 'B738',
        r: 'N123AA',
        squawk: '2200',
        nac_p: 9,
      }],
    }), { status: 200 });
  }
  throw new Error(`Unexpected URL ${url}`);
};
const fallbackData = await fetchFlightData({
  env: { OPENSKY_CLIENT_ID: 'client-id', OPENSKY_CLIENT_SECRET: 'client-secret' },
  fetcher: providerFetch,
  nowMs: 1710000010000,
});
assert.equal(fallbackData.total, 1);
assert.equal(fallbackData.commercial_flights[0].source, 'ADS-B / adsb.lol');
assert.equal(fallbackCalls.some((url) => url.includes('opensky-network.org/api/states/all')), true);
assert.equal(fallbackCalls.some((url) => url.includes('api.adsb.lol')), true);

const emptyData = await fetchFlightData({
  env: { OPENSKY_CLIENT_ID: '', OPENSKY_CLIENT_SECRET: '' },
  fetcher: async () => new Response(JSON.stringify({ ac: [] }), { status: 200 }),
  nowMs: 1710000010000,
});
assert.equal(emptyData.total, 0);
assert.deepEqual(Object.keys(emptyData).sort(), [
  'commercial_flights',
  'gps_jamming',
  'military_flights',
  'private_flights',
  'private_jets',
  'timestamp',
  'total',
].sort());

// ── Type-code classification (shared by adsb.lol and OpenSky enrichment) ──
const { classifyByTypeCode, enrichWithAdsb } = providers;
assert.equal(classifyByTypeCode('DAL123', 'DAL', 'B738', 0), 'commercial');
assert.equal(classifyByTypeCode('N90XT', '', 'GLEX', 0), 'jet', 'Global Express is a business jet type');
assert.equal(classifyByTypeCode('N556XY', '', 'C172', 0), 'private');
assert.equal(classifyByTypeCode('ANY1', '', 'B738', 1), 'military', 'dbFlags military bit wins');
assert.equal(classifyByTypeCode('RCH271', '', '', 0), 'military', 'military callsign without a type code');
assert.equal(classifyByTypeCode('ANY1', '', 'C17', 0), 'military', 'military type code');

// ── OpenSky enrichment from adsb.lol ──
const bareOpenSky = normalizeOpenSkyState(
  ['abc123', 'N90XT', 'United States', null, 1710000005, -97.0, 32.8, 9000, false, 200, 90, null, null, 9100, '1200', false, 0, 0],
  1710000010,
);
// Unenriched, OpenSky supplies no type code so this can only be 'commercial'.
assert.equal(bareOpenSky.category, 'commercial');
assert.equal(bareOpenSky.model, '');
assert.equal(bareOpenSky.registration, 'N90XT', 'GA callsign is the tail number when OpenSky omits registration');

const enriched = enrichWithAdsb(bareOpenSky, { hex: 'abc123', t: 'GLEX', r: 'N90XT', dbFlags: 0, nac_p: 9 });
assert.equal(enriched.category, 'jet', 'type code from adsb.lol reclassifies the record');
assert.equal(enriched.model, 'GLEX');
assert.equal(enriched.registration, 'N90XT');
assert.equal(enriched.nac_p, 9, 'nav accuracy only ever arrives from adsb.lol');
assert.equal(enriched.source, 'OpenSky Network + adsb.lol');
// Position and identity must survive enrichment untouched.
assert.equal(enriched.lat, bareOpenSky.lat);
assert.equal(enriched.lng, bareOpenSky.lng);
assert.equal(enriched.icao24, 'abc123');

// A record with no adsb.lol match is returned unchanged rather than blanked.
const unmatched = enrichWithAdsb(bareOpenSky, undefined);
assert.deepEqual(unmatched, bareOpenSky);

// Helicopter detection comes from the enriched type code.
assert.equal(enrichWithAdsb(bareOpenSky, { hex: 'abc123', t: 'EC35' }).aircraft_category, 'heli');

// ── End-to-end merge: OpenSky coverage + adsb.lol classification ──
resetOpenSkyTokenCacheForTests();
const mergeFetch = async (url) => {
  const u = String(url);
  if (u === OPENSKY_TOKEN_URL) {
    return new Response(JSON.stringify({ access_token: 'tok', expires_in: 1800 }), { status: 200 });
  }
  if (u.includes('opensky-network.org/api/states/all')) {
    return new Response(JSON.stringify({
      time: 1710000010,
      states: [
        ['aaa111', 'RCH271', 'United States', null, 1710000005, -97, 32, 9000, false, 200, 90, null, null, 9100, '1200', false, 0, 0],
        ['bbb222', 'N90XT', 'United States', null, 1710000005, -96, 33, 9000, false, 200, 90, null, null, 9100, '1200', false, 0, 0],
        ['ccc333', 'DAL55', 'United States', null, 1710000005, -95, 34, 9000, false, 200, 90, null, null, 9100, '1200', false, 0, 0],
        // Mid-ocean aircraft with no adsb.lol coverage — must still be returned.
        ['ddd444', 'BAW22', 'United Kingdom', null, 1710000005, -40, 45, 11000, false, 250, 80, null, null, 11100, '2000', false, 0, 0],
      ],
    }), { status: 200 });
  }
  if (u.includes('api.adsb.lol/v2/mil')) {
    return new Response(JSON.stringify({ ac: [{ hex: 'aaa111', flight: 'RCH271', t: 'C17', r: '00-0171', dbFlags: 1 }] }), { status: 200 });
  }
  if (u.includes('api.adsb.lol/v2/lat')) {
    return new Response(JSON.stringify({ ac: [{ hex: 'bbb222', flight: 'N90XT', t: 'GLEX', r: 'N90XT', dbFlags: 0 }] }), { status: 200 });
  }
  throw new Error(`Unexpected URL ${u}`);
};

const merged = await fetchFlightData({
  env: { OPENSKY_CLIENT_ID: 'id', OPENSKY_CLIENT_SECRET: 'secret' },
  fetcher: mergeFetch,
  nowMs: 1710000010000,
});
// Coverage is preserved: all four OpenSky aircraft survive the merge.
assert.equal(merged.total, 4);
assert.equal(merged.military_flights.length, 1, 'C17 with the military bit lands in military');
assert.equal(merged.military_flights[0].registration, '00-0171');
assert.equal(merged.private_jets.length, 1, 'GLEX lands in jets');
assert.equal(merged.private_jets[0].model, 'GLEX');
// The unmatched oceanic aircraft is still served, just without enrichment.
const oceanic = merged.commercial_flights.find((f) => f.icao24 === 'ddd444');
assert.ok(oceanic, 'aircraft outside adsb.lol coverage must not be dropped');
assert.equal(oceanic.source, 'OpenSky Network');

// Enrichment failure degrades metadata, never coverage.
resetOpenSkyTokenCacheForTests();
const enrichFailFetch = async (url) => {
  const u = String(url);
  if (u === OPENSKY_TOKEN_URL) return new Response(JSON.stringify({ access_token: 'tok', expires_in: 1800 }), { status: 200 });
  if (u.includes('opensky-network.org/api/states/all')) {
    return new Response(JSON.stringify({
      time: 1710000010,
      states: [['aaa111', 'DAL55', 'US', null, 1710000005, -97, 32, 9000, false, 200, 90, null, null, 9100, '1200', false, 0, 0]],
    }), { status: 200 });
  }
  return new Response('', { status: 503 });
};
const degraded = await fetchFlightData({
  env: { OPENSKY_CLIENT_ID: 'id', OPENSKY_CLIENT_SECRET: 'secret' },
  fetcher: enrichFailFetch,
  nowMs: 1710000010000,
});
assert.equal(degraded.total, 1, 'adsb.lol being down must not empty the feed');
assert.equal(degraded.commercial_flights[0].source, 'OpenSky Network');

assert.ok(ADSB_COVERAGE_REGIONS.some((region) => region.id === 'caribbean'));
assert.ok(
  ADSB_COVERAGE_REGIONS.some((region) => adsbRegionCovers(region, 18.4036, -65.6440)),
  'N25315 over Puerto Rico must fall inside an enrichment circle',
);

const lookedUp = await lookupAdsbAircraftByHex('a2653c', {
  fetcher: async (url) => {
    assert.match(String(url), /\/v2\/hex\/a2653c$/);
    return new Response(JSON.stringify({
      ac: [{ hex: 'a2653c', flight: 'N25315', r: 'N25315', t: 'TB9', squawk: '1200', nac_p: 8, lat: 18.4, lon: -65.64 }],
    }), { status: 200 });
  },
});
assert.equal(lookedUp?.r, 'N25315');
assert.equal(lookedUp?.t, 'TB9');

const routeSource = readFileSync(resolve(root, 'src/app/api/flights/route.ts'), 'utf8');
assert.match(routeSource, /fetchFlightData/);
assert.equal(routeSource.includes('api.adsb.lol/v2/lat'), false);

// The map must not silently discard aircraft before rendering.
const mapSource = readFileSync(resolve(root, 'src/components/SentraMap.tsx'), 'utf8');
assert.equal(/toFeatures\(data\.\w+,\s*\d+\)/.test(mapSource), false, 'flight rendering must not decimate');

console.log('OpenSky provider tests passed.');
