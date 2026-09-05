import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const root = process.cwd();
const buildDir = mkdtempSync(join(tmpdir(), 'sentra-ny-'));
const src = readFileSync(resolve(root, 'src/app/api/cctv/ny511.ts'), 'utf8');
const { outputText } = ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  fileName: 'ny511.ts',
});
// Neutralize the '@/lib/cache-registry' import — irrelevant to these unit tests.
const code = outputText.replace(
  /import\s*\{[^}]*\}\s*from\s*['"]@\/lib\/cache-registry['"];?/g,
  'const registerCacheReset = () => {};',
);
writeFileSync(join(buildDir, 'ny511.mjs'), code, 'utf8');
const { parseWktPoint, normalizeNy511Camera, buildNy511PageUrl, fetchNy511Cameras, NY511_SOURCE } =
  await import(pathToFileURL(join(buildDir, 'ny511.mjs')).href);

// ── WKT parsing (longitude first) ──
assert.deepEqual(parseWktPoint('POINT (-73.690416 43.237344)'), { lat: 43.237344, lng: -73.690416 });
assert.equal(parseWktPoint(null), null);
assert.equal(parseWktPoint('POINT (-73 95)'), null, 'out-of-range latitude rejected');

// ── Normalization: unauthenticated HLS becomes a directly playable stream ──
const row = {
  id: 4438,
  images: [{
    imageUrl: '/map/Cctv/4438',
    videoUrl: 'https://s51.nysdot.skyvdn.com/rtplive/R1_033/playlist.m3u8',
    videoType: 'application/x-mpegURL',
    isVideoAuthRequired: false,
    disabled: false, blocked: false,
  }],
  location: 'US 9 at Exit 12',
  roadway: 'US 9',
  direction: 'Southbound',
  county: 'Saratoga',
  region: 'Capital Region',
  source: 'Skyline',
  latLng: { geography: { wellKnownText: 'POINT (-73.690416 43.237344)' } },
};
const cam = normalizeNy511Camera(row);
assert.equal(cam.id, 'ny511-4438');
assert.equal(cam.lat, 43.237344);
assert.equal(cam.lng, -73.690416);
assert.equal(cam.name, 'US 9 at Exit 12');
assert.equal(cam.source, NY511_SOURCE);
assert.equal(cam.source, 'NYSDOT 511NY', 'source must NOT be the FL511 label (would trigger the DIVAS path)');
assert.equal(cam.id.startsWith('fl511-'), false, 'id prefix must not be fl511-');
assert.equal(cam.feed_url, 'https://511ny.org/map/Cctv/4438', 'relative still URL is absolutised');
// The key NY behaviour: direct HLS, no token, no proxy.
assert.equal(cam.stream_url, 'https://s51.nysdot.skyvdn.com/rtplive/R1_033/playlist.m3u8');
assert.equal(cam.stream_type, 'hls');
assert.equal(cam.video_auth_required, false);
assert.match(cam.external_url, /511ny\.org\/map#camera-4438/);

// A camera whose video requires auth must NOT be marked directly playable.
const authed = normalizeNy511Camera({ ...row, images: [{ ...row.images[0], isVideoAuthRequired: true }] });
assert.equal(authed.stream_url, null, 'auth-required video is not a direct stream');
assert.equal(authed.stream_type, null);

// A camera with no video is still a valid still-image record.
const stillOnly = normalizeNy511Camera({ ...row, images: [{ imageUrl: '/map/Cctv/9', isVideoAuthRequired: false }] });
assert.equal(stillOnly.stream_url, null);
assert.equal(stillOnly.feed_url, 'https://511ny.org/map/Cctv/9');

// Dropped when unusable.
assert.equal(normalizeNy511Camera({ ...row, latLng: undefined }), null, 'no coords -> dropped');
assert.equal(normalizeNy511Camera({ ...row, images: [{ imageUrl: '/x', blocked: true }] }), null);
assert.equal(normalizeNy511Camera({ ...row, id: undefined }), null);

// ── Page URL ──
const u = buildNy511PageUrl(200, 100);
assert.match(u, /511ny\.org\/List\/GetData\/Cameras/);
const q = JSON.parse(decodeURIComponent(new URL(u).searchParams.get('query')));
assert.equal(q.start, 200);
assert.equal(q.length, 100);

// ── Paging: server caps at 100/page, so all pages must be walked ──
const TOTAL = 250;
const makeRow = (i) => ({
  id: i,
  images: [{ imageUrl: `/map/Cctv/${i}`, videoUrl: `https://s51.nysdot.skyvdn.com/rtplive/C${i}/playlist.m3u8`, isVideoAuthRequired: false }],
  location: `Cam ${i}`,
  latLng: { geography: { wellKnownText: `POINT (-73.${String(i).padStart(4, '0')} 42.5)` } },
});
const starts = [];
const fetcher = async (url) => {
  const query = JSON.parse(decodeURIComponent(new URL(url).searchParams.get('query')));
  starts.push(query.start);
  const rows = [];
  for (let i = query.start; i < Math.min(query.start + 100, TOTAL); i++) rows.push(makeRow(i));
  return new Response(JSON.stringify({ recordsTotal: TOTAL, data: rows }), { status: 200 });
};
const all = await fetchNy511Cameras({ fetcher, force: true });
assert.equal(all.length, TOTAL, 'every page collected');
assert.deepEqual([...starts].sort((a, b) => a - b), [0, 100, 200]);
assert.equal(all.every((c) => c.stream_type === 'hls'), true);

// A failed page costs only its cameras.
const flaky = async (url) => {
  const query = JSON.parse(decodeURIComponent(new URL(url).searchParams.get('query')));
  if (query.start === 100) return new Response('', { status: 503 });
  const rows = [];
  for (let i = query.start; i < Math.min(query.start + 100, TOTAL); i++) rows.push(makeRow(i));
  return new Response(JSON.stringify({ recordsTotal: TOTAL, data: rows }), { status: 200 });
};
const partial = await fetchNy511Cameras({ fetcher: flaky, force: true });
assert.equal(partial.length, 150, 'one dead page must not empty the state');

// ── Route wiring ──
const routeSrc = readFileSync(resolve(root, 'src/app/api/cctv/route.ts'), 'utf8');
assert.match(routeSrc, /fetchNy511Cameras/);
assert.match(routeSrc, /'newyork': fetchNy511Cameras/);
assert.match(routeSrc, /regions\.push\('newyork'\)/);

rmSync(buildDir, { recursive: true, force: true });
console.log('511NY camera tests passed.');
