import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const pageSource = readFileSync(resolve(process.cwd(), 'src/app/page.tsx'), 'utf8');
const mapSource = readFileSync(resolve(process.cwd(), 'src/components/SentraMap.tsx'), 'utf8');

assert.match(
  pageSource,
  /const\s+DEFAULT_MAP_VIEW\s*=\s*\{\s*latitude:\s*40\.8836,\s*longitude:\s*0,\s*zoom:\s*1\.59,\s*\};/s,
  'Dashboard should define the requested default map view.',
);
assert.match(
  pageSource,
  /useState\(\(\)\s*=>\s*\(\{\s*zoom:\s*DEFAULT_MAP_VIEW\.zoom,\s*latitude:\s*DEFAULT_MAP_VIEW\.latitude,\s*longitude:\s*DEFAULT_MAP_VIEW\.longitude,\s*\}\)\)/s,
  'Dashboard map view state should initialize from DEFAULT_MAP_VIEW.',
);
assert.match(
  pageSource,
  /const\s+\[urlStateReady,\s*setUrlStateReady\]\s*=\s*useState\(false\);/,
  'Dashboard should wait for URL state parsing before mounting the map.',
);
assert.match(
  pageSource,
  /setUrlStateReady\(true\);/,
  'Dashboard should mark URL state ready after parsing query params.',
);
assert.match(
  pageSource,
  /\{urlStateReady\s*&&\s*\(\s*<SentraMap/s,
  'SentraMap should not mount until URL state is ready.',
);
assert.match(
  pageSource,
  /initialView=\{\{\s*lat:\s*mapView\.latitude,\s*lng:\s*mapView\.longitude,\s*zoom:\s*mapView\.zoom,\s*\}\}/s,
  'SentraMap should receive the parsed current map view as its initial view.',
);
assert.match(
  pageSource,
  /p\.set\('lat',\s*\(mapView\.latitude\s*\?\?\s*DEFAULT_MAP_VIEW\.latitude\)\.toFixed\(4\)\);/,
  'URL fallback latitude should use DEFAULT_MAP_VIEW.',
);
assert.match(
  pageSource,
  /p\.set\('lon',\s*\(mapView\.longitude\s*\?\?\s*DEFAULT_MAP_VIEW\.longitude\)\.toString\(\)\);/,
  'URL fallback longitude should use DEFAULT_MAP_VIEW and preserve the tracked map longitude.',
);
assert.match(
  mapSource,
  /initialView\?:\s*\{\s*lat:\s*number;\s*lng:\s*number;\s*zoom:\s*number\s*\}/s,
  'SentraMap should expose an initialView prop.',
);
assert.match(
  mapSource,
  /const\s+initialViewRef\s*=\s*useRef\(initialView\);/,
  'SentraMap should pin initialView for its one-time MapLibre setup effect.',
);
assert.match(
  mapSource,
  /center:\s*\[startView\.lng,\s*startView\.lat\],\s*zoom:\s*startView\.zoom/,
  'MapLibre should initialize from the pinned initialView.',
);
assert.equal(
  mapSource.includes('center: [25.48, 42.70], zoom: 6.5'),
  false,
  'Old hardcoded initial map center should be removed.',
);

console.log('Default map view tests passed.');
