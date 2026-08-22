import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const root = process.cwd();
const buildDir = mkdtempSync(join(tmpdir(), 'sentra-cam-'));

function transpile(relDir, name) {
  const source = readFileSync(resolve(root, relDir, `${name}.ts`), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
    },
    fileName: `${name}.ts`,
  });
  writeFileSync(
    join(buildDir, `${name}.mjs`),
    outputText.replace(/from ['"]\.\/([^'"]+)['"]/g, (_m, d) => `from './${d.replace(/\.mjs$/, '')}.mjs'`),
    'utf8',
  );
}
for (const n of ['types', 'osm-surveillance', 'windy-webcams']) transpile('src/lib/cameras', n);
const load = (n) => import(pathToFileURL(join(buildDir, `${n}.mjs`)).href);

const types = await load('types');
const osm = await load('osm-surveillance');
const windy = await load('windy-webcams');

// ── Bounding box parsing ──────────────────────────────────────────────────
const { parseBoundingBox, bboxArea } = types;
assert.deepEqual(parseBoundingBox('51.28,-0.51,51.69,0.33'), { south: 51.28, west: -0.51, north: 51.69, east: 0.33 });
assert.equal(parseBoundingBox(null), null);
assert.equal(parseBoundingBox('1,2,3'), null, 'needs four components');
assert.equal(parseBoundingBox('a,b,c,d'), null);
assert.equal(parseBoundingBox('60,0,50,10'), null, 'south must be below north');
assert.equal(parseBoundingBox('0,20,10,10'), null, 'west must be left of east');
assert.equal(parseBoundingBox('-95,0,10,10'), null, 'latitude out of range');
assert.equal(parseBoundingBox('0,-190,10,10'), null, 'longitude out of range');
assert.equal(Math.round(bboxArea({ south: 0, west: 0, north: 2, east: 3 })), 6);

// ── OSM normalisation ─────────────────────────────────────────────────────
const { normalizeOsmCamera, buildOverpassQuery, fetchOsmSurveillanceCameras, OSM_ATTRIBUTION, MAX_BBOX_AREA_DEGREES } = osm;

const node = normalizeOsmCamera({
  type: 'node',
  id: 13565573,
  lat: 51.4727099,
  lon: -0.1924853,
  tags: { man_made: 'surveillance', surveillance: 'traffic', 'surveillance:type': 'camera', 'camera:type': 'fixed', 'camera:direction': '215', operator: 'TfL' },
});
assert.equal(node.id, 'osm-node-13565573');
assert.equal(node.lat, 51.4727099);
// The whole point: OSM records positions, never feeds.
assert.equal(node.kind, 'location');
assert.equal(node.stream_url, null);
assert.equal(node.preview_url, null);
assert.equal(node.surveillance_type, 'camera');
assert.equal(node.camera_type, 'fixed');
assert.equal(node.direction, 215);
assert.equal(node.operator, 'TfL');
assert.equal(node.attribution, OSM_ATTRIBUTION, 'ODbL attribution must be carried on every record');
assert.match(node.external_url, /openstreetmap\.org\/node\/13565573/);

// A named node keeps its name; an unnamed one gets a descriptive label.
assert.equal(normalizeOsmCamera({ type: 'node', id: 1, lat: 1, lon: 1, tags: { name: 'Tower Cam' } }).name, 'Tower Cam');
assert.match(normalizeOsmCamera({ type: 'node', id: 2, lat: 1, lon: 1, tags: { 'surveillance:type': 'ALPR' } }).name, /ANPR/);

// Ways carry their position on `center`.
assert.equal(normalizeOsmCamera({ type: 'way', id: 7, center: { lat: 5, lon: 6 }, tags: {} }).lat, 5);

// Anything without a usable position is dropped rather than defaulted to 0,0.
assert.equal(normalizeOsmCamera({ type: 'node', id: 3, tags: {} }), null);
assert.equal(normalizeOsmCamera({ type: 'node', id: 4, lat: 1, tags: {} }), null);
assert.equal(normalizeOsmCamera({ type: 'node', lat: 1, lon: 1, tags: {} }), null, 'id is required');
assert.equal(normalizeOsmCamera({ type: 'node', id: 5, lat: Number.NaN, lon: 1, tags: {} }), null);

const query = buildOverpassQuery({ south: 51.28, west: -0.51, north: 51.69, east: 0.33 }, 3000);
assert.match(query, /man_made.*surveillance/);
assert.match(query, /51\.28,-0\.51,51\.69,0\.33/);
assert.match(query, /out center 3000/);

// An oversized viewport is refused politely instead of timing the upstream out.
const huge = await fetchOsmSurveillanceCameras({
  bbox: { south: -80, west: -170, north: 80, east: 170 },
  fetcher: async () => { throw new Error('must not be called'); },
});
assert.equal(huge.cameras.length, 0);
assert.equal(huge.degraded, false, 'zoom-in guidance is not a failure');
assert.match(huge.message, /Zoom in/);
assert.ok(bboxArea({ south: -80, west: -170, north: 80, east: 170 }) > MAX_BBOX_AREA_DEGREES);

// Missing viewport is reported, not silently empty.
const noBbox = await fetchOsmSurveillanceCameras({ fetcher: async () => { throw new Error('nope'); } });
assert.equal(noBbox.degraded, true);

const osmFeed = await fetchOsmSurveillanceCameras({
  bbox: { south: 51.2, west: -0.5, north: 51.7, east: 0.3 },
  fetcher: async (url, init) => {
    assert.match(String(url), /overpass/);
    assert.equal(init.method, 'POST');
    return new Response(JSON.stringify({
      elements: [
        { type: 'node', id: 1, lat: 51.5, lon: -0.1, tags: { 'surveillance:type': 'camera' } },
        { type: 'node', id: 2, tags: {} },
        { type: 'way', id: 3, center: { lat: 51.4, lon: -0.2 }, tags: {} },
      ],
    }), { status: 200 });
  },
});
assert.equal(osmFeed.cameras.length, 2, 'the positionless element is dropped');
assert.equal(osmFeed.degraded, false);
assert.equal(osmFeed.cameras.every((c) => c.kind === 'location'), true);

await assert.rejects(
  () => fetchOsmSurveillanceCameras({
    bbox: { south: 0, west: 0, north: 1, east: 1 },
    fetcher: async () => new Response('', { status: 504 }),
  }),
  /HTTP 504/,
);

// ── Windy normalisation ───────────────────────────────────────────────────
const { normalizeWindyWebcam, fetchWindyWebcams, hasWindyKey, WINDY_ATTRIBUTION } = windy;

assert.equal(hasWindyKey({}), false);
assert.equal(hasWindyKey({ WINDY_API_KEY: '  ' }), false);
assert.equal(hasWindyKey({ WINDY_API_KEY: 'abc' }), true);

const cam = normalizeWindyWebcam({
  webcamId: 1234,
  title: 'Zermatt — Matterhorn',
  status: 'active',
  location: { latitude: 46.02, longitude: 7.75, city: 'Zermatt', country: 'Switzerland' },
  images: { current: { preview: 'https://images.windy.com/preview.jpg' } },
  player: { live: 'https://webcams.windy.com/player/live' },
  urls: { detail: 'https://windy.com/webcams/1234' },
  categories: [{ name: 'mountain' }],
});
assert.equal(cam.id, 'windy-1234');
assert.equal(cam.kind, 'stream', 'a webcam with a player is watchable');
assert.equal(cam.stream_type, 'iframe');
assert.equal(cam.city, 'Zermatt');
assert.equal(cam.preview_url, 'https://images.windy.com/preview.jpg');
assert.equal(cam.attribution, WINDY_ATTRIBUTION);

// No player means it is a position, not a feed — kind must reflect that.
assert.equal(normalizeWindyWebcam({ webcamId: 9, status: 'active', location: { latitude: 1, longitude: 2 }, player: {} }).kind, 'location');
// Inactive cameras are dropped rather than shown as broken feeds.
assert.equal(normalizeWindyWebcam({ webcamId: 9, status: 'inactive', location: { latitude: 1, longitude: 2 } }), null);
assert.equal(normalizeWindyWebcam({ webcamId: 9, status: 'active', location: {} }), null);

// Absent key is a normal, non-degraded state — the route still serves OSM.
const unconfigured = await fetchWindyWebcams({ env: {}, fetcher: async () => { throw new Error('must not be called'); } });
assert.equal(unconfigured.cameras.length, 0);
assert.equal(unconfigured.degraded, false);
assert.match(unconfigured.message, /WINDY_API_KEY/);

let sentHeaders = null;
const windyFeed = await fetchWindyWebcams({
  env: { WINDY_API_KEY: 'test-key' },
  bbox: { south: 45, west: 7, north: 47, east: 8 },
  fetcher: async (url, init) => {
    sentHeaders = init.headers;
    assert.match(String(url), /api\.windy\.com\/webcams\/api\/v3\/webcams/);
    return new Response(JSON.stringify({
      webcams: [
        { webcamId: 1, status: 'active', title: 'A', location: { latitude: 46, longitude: 7.5 }, player: { live: 'p' } },
        { webcamId: 2, status: 'inactive', title: 'B', location: { latitude: 46, longitude: 7.5 } },
      ],
    }), { status: 200 });
  },
});
assert.equal(sentHeaders['x-windy-api-key'], 'test-key');
assert.equal(windyFeed.cameras.length, 1, 'inactive webcams are filtered out');

// A rejected key is surfaced as degraded rather than thrown, so OSM still serves.
const badKey = await fetchWindyWebcams({
  env: { WINDY_API_KEY: 'bad' },
  fetcher: async () => new Response('{}', { status: 403 }),
});
assert.equal(badKey.degraded, true);
assert.match(badKey.message, /rejected/);

// ── Route contract ────────────────────────────────────────────────────────
const routeSource = readFileSync(resolve(root, 'src/app/api/cameras/worldwide/route.ts'), 'utf8');
assert.match(routeSource, /parseBoundingBox/, 'viewport must be validated');
assert.match(routeSource, /status: 400/, 'a missing bbox must be a client error');
assert.match(routeSource, /attributions/, 'licence attribution must be returned');
assert.match(routeSource, /Promise\.allSettled/, 'one provider failing must not sink the other');
assert.equal(routeSource.includes('insecam'), false);

// No part of this feature may reference the unsecured-camera aggregator.
for (const f of ['src/lib/cameras/osm-surveillance.ts', 'src/lib/cameras/windy-webcams.ts', 'src/lib/cameras/types.ts']) {
  assert.equal(readFileSync(resolve(root, f), 'utf8').toLowerCase().includes('insecam'), false);
}

rmSync(buildDir, { recursive: true, force: true });
console.log('Worldwide camera tests passed.');
