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
  /\(window as any\)\.openSentraIntel\s*=\s*\(entity:\s*any\)\s*=>\s*\{\s*if\s*\(entity\?\.callsign\s*\|\|\s*entity\?\.icao24\)\s*\{\s*openAircraftIntel\(entity\);/s,
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

assert.match(
  mapSource,
  /const\s+intelPayload\s*=\s*escapeAttr\(JSON\.stringify\(aircraftEntity\)\);/,
  'Popup deep-dive payload should use the same aircraft entity payload as the direct map click.',
);

console.log('Aircraft intel wiring tests passed.');
