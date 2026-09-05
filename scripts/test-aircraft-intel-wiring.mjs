import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const pageSource = readFileSync(resolve(root, 'src/app/page.tsx'), 'utf8');
const mapSource = readFileSync(resolve(root, 'src/components/SentraMap.tsx'), 'utf8');

assert.match(
  pageSource,
  /const\s+openAircraftIntel\s*=\s*useCallback\(\(entity:\s*any\)\s*=>/s,
  'Dashboard should expose a shared aircraft intel opener.',
);

assert.match(
  pageSource,
  /if\s*\(entity\?\.type\s*===\s*'aircraft'\s*\|\|\s*entity\?\.callsign\s*\|\|\s*entity\?\.icao24\)\s*\{\s*openAircraftIntel\(entity\);/s,
  'Dashboard onEntityClick should open aircraft live intel for aircraft map clicks.',
);

assert.match(
  pageSource,
  /entity\?\.type\s*===\s*'vessel'\s*\|\|\s*entity\?\.mmsi/,
  'Dashboard onEntityClick should open vessel intel before treating a radio callsign as an aircraft.',
);

assert.match(
  pageSource,
  /openAircraftIntel\(entity\);/,
  'Popup deep-dive bridge should reuse the same aircraft live intel opener.',
);

assert.match(
  mapSource,
  /const\s+aircraftEntity\s*=\s*\{/s,
  'SentraMap aircraft click handler should build a reusable aircraft entity payload.',
);

assert.match(
  mapSource,
  /onEntityClick\?\.\(aircraftEntity\);/,
  'SentraMap should pass aircraft clicks into the React entity click handler.',
);

assert.equal(
  mapSource.includes('⚡ FLIGHTAWARE'),
  false,
  'Aircraft map clicks must not also open a floating map popup.',
);

const photoRoute = readFileSync(resolve(root, 'src/app/api/aircraft/photo/route.ts'), 'utf8');
assert.match(photoRoute, /fetchAircraftPhoto/, 'Photo route should use the Planespotters-first lookup.');
assert.match(photoRoute, /callsign/, 'Photo route should accept a GA callsign used as the tail number.');

assert.match(mapSource, /showAllAircraft/, 'The flights layer must plot every aircraft category.');
assert.match(mapSource, /activeLayers\.flights \|\| activeLayers\.private/);
const layerSource = readFileSync(resolve(root, 'src/components/LayerPanel.tsx'), 'utf8');
assert.match(layerSource, /All aircraft/);
const panelSource = readFileSync(resolve(root, 'src/components/EntityGraphPanel.tsx'), 'utf8');
assert.match(panelSource, /\/api\/aircraft\/lookup/);
const lookupRoute = readFileSync(resolve(root, 'src/app/api/aircraft/lookup/route.ts'), 'utf8');
assert.match(lookupRoute, /lookupAdsbAircraftByHex/);

console.log('Aircraft intel wiring tests passed.');
