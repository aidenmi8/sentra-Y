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

const entityIntel = await importTsModule('src/lib/entity-intel.ts');
const { buildLocalEntityGraph } = entityIntel;

const aircraftGraph = buildLocalEntityGraph({
  type: 'aircraft',
  id: 'N869QS',
  properties: {
    registration: 'N869QS',
    model: 'C700',
    icao24: 'abf1b5',
  },
});

assert.equal(aircraftGraph.entity.type, 'aircraft');
assert.equal(aircraftGraph.entity.id, 'N869QS');
assert.equal(aircraftGraph.source, 'Sentra Mi8 Local Intelligence Fallback');
assert.equal(aircraftGraph.fallback, true);
assert.deepEqual(
  aircraftGraph.nodes.map((node) => [node.id, node.label, node.type]),
  [
    ['country:United States', 'United States', 'country'],
    ['aircraft:model:C700', 'C700', 'aircraft'],
  ],
);
assert.deepEqual(aircraftGraph.links, [
  { source: 'aircraft:N869QS', target: 'country:United States', label: 'REGISTERED IN' },
  { source: 'aircraft:N869QS', target: 'aircraft:model:C700', label: 'AIRCRAFT TYPE' },
]);

const vesselGraph = buildLocalEntityGraph({
  type: 'vessel',
  id: 'IMO1234567',
  properties: {
    flag: 'PA',
    destination: 'SANTO DOMINGO',
  },
});

assert.deepEqual(
  vesselGraph.nodes.map((node) => [node.id, node.label, node.type]),
  [
    ['country:Panama', 'Panama', 'country'],
    ['event:destination:SANTO DOMINGO', 'SANTO DOMINGO', 'event'],
  ],
);
assert.deepEqual(vesselGraph.links, [
  { source: 'vessel:IMO1234567', target: 'country:Panama', label: 'FLAG STATE' },
  { source: 'vessel:IMO1234567', target: 'event:destination:SANTO DOMINGO', label: 'DESTINATION' },
]);

const unknownGraph = buildLocalEntityGraph({ type: 'aircraft', id: 'ZZZ123' });
assert.equal(unknownGraph.nodes.length, 0);
assert.equal(unknownGraph.links.length, 0);

console.log('Entity intelligence fallback tests passed.');
