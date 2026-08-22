import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const root = process.cwd();
const buildDir = mkdtempSync(join(tmpdir(), 'sentra-fl-'));
const src = readFileSync(resolve(root, 'src/app/api/cctv/fl511.ts'), 'utf8');
const { outputText } = ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  fileName: 'fl511.ts',
});
writeFileSync(join(buildDir, 'fl511.mjs'), outputText, 'utf8');
const {
  parseWktPoint,
  normalizeFl511Camera,
  buildFl511PageUrl,
  fetchFl511Cameras,
  parseFl511ImageId,
  isAllowedDivasUrl,
  rewriteHlsPlaylist,
  resolveFl511LiveStream,
  resetFl511Caches,
  buildFl511HlsProxyUrl,
} = await import(pathToFileURL(join(buildDir, 'fl511.mjs')).href);

// ── WKT parsing: longitude comes FIRST in WKT, latitude second ──
assert.deepEqual(parseWktPoint('POINT (-81.580975 28.292213)'), { lat: 28.292213, lng: -81.580975 });
assert.deepEqual(parseWktPoint('POINT(-80.1 25.8)'), { lat: 25.8, lng: -80.1 });
assert.equal(parseWktPoint(null), null);
assert.equal(parseWktPoint(''), null);
assert.equal(parseWktPoint('LINESTRING (0 0, 1 1)'), null);
// Out-of-range values are rejected rather than plotted somewhere impossible.
assert.equal(parseWktPoint('POINT (-200 28)'), null);
assert.equal(parseWktPoint('POINT (-81 95)'), null);

// ── Record normalisation ──
const row = {
  id: 614,
  images: [{ imageUrl: '/map/Cctv/614', disabled: false, blocked: false }],
  location: 'I-4 @ MM 60.6 EB',
  roadway: 'I-4',
  direction: 'Eastbound',
  county: 'Osceola',
  city: 'Kissimmee',
  region: 'Central',
  dotDistrict: 'District 5',
  latLng: { geography: { wellKnownText: 'POINT (-81.580975 28.292213)' } },
};
const cam = normalizeFl511Camera(row);
assert.equal(cam.id, 'fl511-614');
assert.equal(cam.lat, 28.292213);
assert.equal(cam.lng, -81.580975);
assert.equal(cam.name, 'I-4 @ MM 60.6 EB');
assert.equal(cam.feed_url, 'https://fl511.com/map/Cctv/614', 'relative image paths are absolutised');
assert.equal(cam.source, 'FDOT FL511');
assert.equal(cam.county, 'Osceola');
assert.equal(cam.district, 'District 5');
assert.match(cam.external_url, /fl511\.com\/map#camera-614/);

// An already-absolute image URL is left alone.
assert.equal(
  normalizeFl511Camera({ ...row, images: [{ imageUrl: 'https://cdn.example/x.jpg' }] }).feed_url,
  'https://cdn.example/x.jpg',
);

// Cameras with nothing viewable are dropped rather than shipped as dead tiles.
assert.equal(normalizeFl511Camera({ ...row, images: [{ imageUrl: '/x', blocked: true }] }), null);
assert.equal(normalizeFl511Camera({ ...row, images: [{ imageUrl: '/x', disabled: true }] }), null);
assert.equal(normalizeFl511Camera({ ...row, images: [] }), null);
assert.equal(normalizeFl511Camera({ ...row, latLng: undefined }), null, 'no coordinates -> dropped');
assert.equal(normalizeFl511Camera({ ...row, id: undefined }), null);

// Falls back to roadway + direction when there is no location string.
assert.equal(normalizeFl511Camera({ ...row, location: undefined }).name, 'I-4 Eastbound');

// ── Pagination URL ──
const u = buildFl511PageUrl(300, 100);
assert.match(u, /fl511\.com\/List\/GetData\/Cameras/);
const q = JSON.parse(decodeURIComponent(new URL(u).searchParams.get('query')));
assert.equal(q.start, 300);
assert.equal(q.length, 100);

// ── Paging: the server caps a page at 100, so all pages must be walked ──
const TOTAL = 250;
const makeRow = (i) => ({
  id: i,
  images: [{ imageUrl: `/map/Cctv/${i}` }],
  location: `Cam ${i}`,
  latLng: { geography: { wellKnownText: `POINT (-81.5 28.${String(i).padStart(4, '0')})` } },
});
const seenStarts = [];
const fakeFetch = async (url) => {
  const query = JSON.parse(decodeURIComponent(new URL(url).searchParams.get('query')));
  seenStarts.push(query.start);
  const rows = [];
  for (let i = query.start; i < Math.min(query.start + 100, TOTAL); i++) rows.push(makeRow(i));
  return new Response(JSON.stringify({ recordsTotal: TOTAL, data: rows }), { status: 200 });
};
const all = await fetchFl511Cameras({ fetcher: fakeFetch, force: true });
assert.equal(all.length, TOTAL, 'every page must be collected, not just the first');
assert.deepEqual([...seenStarts].sort((a, b) => a - b), [0, 100, 200]);
assert.equal(new Set(all.map((c) => c.id)).size, TOTAL, 'ids must be unique');

// A failed page costs its own cameras, not the whole state.
let call = 0;
const flaky = async (url) => {
  call++;
  const query = JSON.parse(decodeURIComponent(new URL(url).searchParams.get('query')));
  if (query.start === 100) return new Response('', { status: 503 });
  const rows = [];
  for (let i = query.start; i < Math.min(query.start + 100, TOTAL); i++) rows.push(makeRow(i));
  return new Response(JSON.stringify({ recordsTotal: TOTAL, data: rows }), { status: 200 });
};
const partial = await fetchFl511Cameras({ fetcher: flaky, force: true });
assert.equal(partial.length, 150, 'one dead page must not empty the result');

// ── Route wiring ──
const routeSrc = readFileSync(resolve(root, 'src/app/api/cctv/route.ts'), 'utf8');
assert.match(routeSrc, /fetchFl511Cameras/);
assert.match(routeSrc, /'florida': fetchFl511Cameras/);
assert.equal(routeSrc.includes("fl511.com/api/v2/cameras"), false, 'the 404ing endpoint must be gone');

const liveRouteSrc = readFileSync(resolve(root, 'src/app/api/cctv/fl511-live/route.ts'), 'utf8');
const hlsRouteSrc = readFileSync(resolve(root, 'src/app/api/cctv/fl511-hls/route.ts'), 'utf8');
assert.match(liveRouteSrc, /resolveFl511LiveStream/);
assert.match(hlsRouteSrc, /rewriteHlsPlaylist/);
assert.match(hlsRouteSrc, /isAllowedDivasUrl/);

const viewerSrc = readFileSync(resolve(root, 'src/components/CameraViewer.tsx'), 'utf8');
assert.match(viewerSrc, /\/api\/cctv\/fl511-live/);
assert.match(viewerSrc, /SHOW VIDEO/);
assert.equal(viewerSrc.includes('onWatchLive'), false, 'live video must play in the first-party player, not the FL511 embed overlay');
const pageSrc = readFileSync(resolve(root, 'src/app/page.tsx'), 'utf8');
assert.equal(pageSrc.includes('Fl511LiveMap'), false, 'the FL511 embed overlay is no longer the live path');

// ── Live stream id / host allowlist / playlist rewrite ──
assert.equal(parseFl511ImageId('fl511-435'), '435');
assert.equal(parseFl511ImageId('435'), '435');
assert.equal(parseFl511ImageId('fl511-003-CCTV'), null);
assert.equal(parseFl511ImageId('../etc'), null);
assert.equal(isAllowedDivasUrl('https://dis-se14.divas.cloud:8200/chan-3705_h/index.m3u8'), true);
assert.equal(isAllowedDivasUrl('https://divas.cloud/VDS-API/SecureTokenUri/GetSecureTokenUriBySourceId'), true);
assert.equal(isAllowedDivasUrl('https://evil.example/steal'), false);
assert.equal(isAllowedDivasUrl('http://divas.cloud/nope'), false, 'http is rejected');
assert.equal(isAllowedDivasUrl('https://user:pass@divas.cloud/x'), false);

const master = [
  '#EXTM3U',
  '#EXT-X-STREAM-INF:BANDWIDTH=400000',
  'xflow.m3u8?token=abc',
  '',
].join('\n');
const rewrittenMaster = rewriteHlsPlaylist(
  master,
  'https://dis-se14.divas.cloud:8200/chan-3705_h/index.m3u8?token=abc',
);
assert.match(rewrittenMaster, /\/api\/cctv\/fl511-hls\?u=/);
assert.match(rewrittenMaster, /xflow\.m3u8/);
assert.equal(rewrittenMaster.includes('evil'), false);

const media = [
  '#EXTM3U',
  '#EXT-X-MAP:URI="init.mp4?token=abc"',
  '#EXTINF:10.0,',
  'seg1.mp4?token=abc',
].join('\n');
const rewrittenMedia = rewriteHlsPlaylist(
  media,
  'https://dis-se14.divas.cloud:8200/chan-3705_h/xflow.m3u8?token=abc',
);
assert.match(rewrittenMedia, /URI="\/api\/cctv\/fl511-hls\?u=/);
assert.match(rewrittenMedia, /seg1\.mp4/);
assert.equal(
  rewriteHlsPlaylist('#EXTM3U\nhttps://evil.example/seg.ts\n', 'https://dis-se14.divas.cloud:8200/chan-3705_h/index.m3u8'),
  '#EXTM3U\nhttps://evil.example/seg.ts\n',
  'non-DIVAS URIs must not be rewritten into the proxy',
);

// ── Token minting: GetVideoUrl object is POSTed to DIVAS, token is appended ──
resetFl511Caches();
const testCam = normalizeFl511Camera({
  ...row,
  id: 435,
  location: 'I-95 at Southwest 8th Street',
  images: [{
    imageUrl: '/map/Cctv/435',
    videoUrl: 'https://dis-se14.divas.cloud:8200/chan-3705_h/index.m3u8',
    isVideoAuthRequired: true,
  }],
  latLng: { geography: { wellKnownText: 'POINT (-80.1937 25.7751)' } },
});
const calls = [];
const liveFetch = async (url, init = {}) => {
  calls.push({ url: String(url), method: (init.method || 'GET').toUpperCase(), body: init.body });
  if (String(url).includes('/List/GetData/Cameras')) {
    return new Response(JSON.stringify({ recordsTotal: 1, data: [] }), { status: 200 });
  }
  if (String(url).includes('/Camera/GetVideoUrl')) {
    assert.match(String(url), /imageId=435/);
    return new Response(JSON.stringify({
      token: 'DD2E458B-78E9-434E-AC9D-D28576C7A628',
      sourceId: '1329',
      systemSourceId: 'District 6',
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (String(url).includes('GetSecureTokenUriBySourceId')) {
    assert.equal((init.method || 'GET').toUpperCase(), 'POST');
    const posted = JSON.parse(init.body);
    assert.equal(posted.sourceId, '1329');
    return new Response(JSON.stringify('?token=dfac204ac70ab5d8472093279a52161c'), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }
  throw new Error(`unexpected fetch ${url}`);
};
const live = await resolveFl511LiveStream('fl511-435', {
  fetcher: liveFetch,
  force: true,
  cameras: [testCam],
});
assert.equal(live.imageId, '435');
assert.equal(live.play_url, 'https://dis-se14.divas.cloud:8200/chan-3705_h/index.m3u8?token=dfac204ac70ab5d8472093279a52161c');
assert.equal(live.proxy_url, buildFl511HlsProxyUrl(live.play_url));
assert.equal(calls.some((c) => c.url.includes('/Camera/GetVideoUrl')), true);
assert.equal(calls.some((c) => c.url.includes('GetSecureTokenUriBySourceId')), true);

resetFl511Caches();
const fromClientUrl = await resolveFl511LiveStream('fl511-435', {
  fetcher: liveFetch,
  force: true,
  cameras: [],
  videoUrl: 'https://dis-se14.divas.cloud:8200/chan-3705_h/index.m3u8',
  name: 'I-95 at Southwest 8th Street',
});
assert.equal(fromClientUrl.play_url, live.play_url);
assert.equal(calls.filter((c) => c.url.includes('/List/GetData/Cameras')).length, 0, 'client-supplied DIVAS url must not page the full camera list');

rmSync(buildDir, { recursive: true, force: true });
console.log('FL511 camera tests passed.');
