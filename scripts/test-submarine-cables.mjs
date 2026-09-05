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

const cables = await importTsModule('src/lib/submarine-cables.ts');
const {
  deriveCableStatus,
  fetchSubmarineCables,
  summarizeCables,
  SUBMARINE_CABLE_BASE_URL,
  CABLE_SOURCE_NAME,
} = cables;

// ── Status derivation ──────────────────────────────────────────────────────
// In-service is source truth, not inference.
assert.deepEqual(deriveCableStatus({ is_planned: false, rfs_year: 1997 }, 2026), {
  status: 'operational',
  status_basis: 'telegeography:is_planned=false',
});
// A cable already in service keeps that status regardless of how old the RFS year is.
assert.equal(deriveCableStatus({ is_planned: false, rfs_year: null }, 2026).status, 'operational');

// Planned systems split on the ready-for-service horizon (current year + 1).
assert.equal(deriveCableStatus({ is_planned: true, rfs_year: 2026 }, 2026).status, 'under_construction');
assert.equal(deriveCableStatus({ is_planned: true, rfs_year: 2027 }, 2026).status, 'under_construction');
assert.equal(deriveCableStatus({ is_planned: true, rfs_year: 2028 }, 2026).status, 'planned');
assert.equal(deriveCableStatus({ is_planned: true, rfs_year: 2029 }, 2026).status, 'planned');
// The boundary moves with the current year rather than being pinned to a constant.
assert.equal(deriveCableStatus({ is_planned: true, rfs_year: 2028 }, 2027).status, 'under_construction');

// A planned cable with no announced date must not be promoted to under construction.
const undated = deriveCableStatus({ is_planned: true, rfs_year: null }, 2026);
assert.equal(undated.status, 'planned');
assert.equal(undated.status_basis, 'derived:is_planned=true,rfs_year=unknown');

// Inference is always labelled as such so the UI can distinguish it from source fact.
assert.match(deriveCableStatus({ is_planned: true, rfs_year: 2027 }, 2026).status_basis, /^derived:/);
assert.match(deriveCableStatus({ is_planned: false, rfs_year: 2001 }, 2026).status_basis, /^telegeography:/);

// Missing is_planned falls back to the RFS year as the only available evidence.
assert.equal(deriveCableStatus({ is_planned: null, rfs_year: 2010 }, 2026).status, 'operational');
assert.equal(deriveCableStatus({ is_planned: null, rfs_year: null }, 2026).status, 'planned');

// ── Summary counts systems, not geometry segments ──────────────────────────
const multiSegment = [
  { properties: { id: 'alpha', status: 'operational' } },
  { properties: { id: 'alpha', status: 'operational' } },
  { properties: { id: 'beta', status: 'planned' } },
];
assert.deepEqual(summarizeCables(multiSegment), {
  total: 2,
  operational: 1,
  under_construction: 0,
  planned: 1,
  not_operational: 0,
});

// ── End-to-end against an injected fetcher ─────────────────────────────────
const geoPayload = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { id: 'alpha', name: 'ALPHA', color: '#97b93c', feature_id: 'alpha-0' },
      geometry: { type: 'MultiLineString', coordinates: [[[0, 0], [1, 1]]] },
    },
    {
      type: 'Feature',
      properties: { id: 'alpha', name: 'ALPHA', color: '#97b93c', feature_id: 'alpha-1' },
      geometry: { type: 'MultiLineString', coordinates: [[[1, 1], [2, 2]]] },
    },
    {
      type: 'Feature',
      properties: { id: 'beta', name: 'BETA', color: '#939597', feature_id: 'beta-0' },
      geometry: { type: 'MultiLineString', coordinates: [[[3, 3], [4, 4]]] },
    },
    {
      type: 'Feature',
      properties: { id: 'gamma', name: 'GAMMA', feature_id: 'gamma-0' },
      geometry: { type: 'MultiLineString', coordinates: [[[5, 5], [6, 6]]] },
    },
  ],
};

const details = {
  alpha: {
    id: 'alpha',
    name: 'ALPHA',
    length: '11,897 km',
    landing_points: [
      { id: 'suez-egypt', name: 'Suez, Egypt', country: 'Egypt' },
      { id: 'mumbai-india', name: 'Mumbai, India', country: 'India' },
      { id: 'aqaba-jordan', name: 'Aqaba, Jordan', country: 'Egypt' },
    ],
    owners: 'FLAG',
    suppliers: 'SubCom',
    rfs: '1997 November',
    rfs_year: 1997,
    is_planned: false,
    url: 'https://example.invalid/alpha',
    notes: null,
  },
  beta: {
    id: 'beta',
    name: 'BETA',
    length: null,
    landing_points: [],
    owners: null,
    suppliers: null,
    rfs: '2029',
    rfs_year: 2029,
    is_planned: true,
    url: null,
    notes: null,
  },
};

const requested = [];
const fetcher = async (url) => {
  const target = String(url);
  requested.push(target);
  if (target.endsWith('/cable/cable-geo.json')) {
    return new Response(JSON.stringify(geoPayload), { status: 200 });
  }
  const match = /\/cable\/([^/]+)\.json$/.exec(target);
  const id = match?.[1];
  if (id && details[id]) {
    return new Response(JSON.stringify(details[id]), { status: 200 });
  }
  return new Response('not found', { status: 404 });
};

const feed = await fetchSubmarineCables({
  fetcher,
  nowMs: Date.parse('2026-07-25T00:00:00Z'),
});

assert.equal(feed.type, 'FeatureCollection');
assert.equal(feed.source, CABLE_SOURCE_NAME);
assert.equal(feed.timestamp, '2026-07-25T00:00:00.000Z');
assert.equal(requested[0], `${SUBMARINE_CABLE_BASE_URL}/cable/cable-geo.json`);

// Both ALPHA segments survive, BETA is planned, GAMMA had no detail and is dropped.
assert.equal(feed.features.length, 3);
assert.deepEqual(feed.features.map((f) => f.properties.id), ['alpha', 'alpha', 'beta']);
assert.deepEqual(feed.summary, {
  total: 2,
  operational: 1,
  under_construction: 0,
  planned: 1,
  not_operational: 0,
});

// A cable whose detail request failed is reported, never given a guessed status.
assert.equal(feed.degraded, true);
assert.deepEqual(feed.unresolved, ['gamma']);
assert.equal(feed.features.some((f) => f.properties.id === 'gamma'), false);

const alpha = feed.features[0];
assert.equal(alpha.properties.status, 'operational');
assert.equal(alpha.properties.rfs, '1997 November');
assert.equal(alpha.properties.owners, 'FLAG');
assert.equal(alpha.properties.landing_point_count, 3);
// Landing countries are de-duplicated — Egypt appears twice upstream.
assert.equal(alpha.properties.landing_countries, 'Egypt, India');
assert.equal(alpha.geometry.type, 'MultiLineString');

// TeleGeography's arbitrary per-cable colour must not leak into the payload;
// colour is decided by status at render time.
assert.equal('color' in alpha.properties, false);

// No open feed publishes retired/faulted cables, so the field is explicitly
// unsourced rather than silently reporting zero outages.
assert.equal(feed.not_operational_source, null);
assert.equal(feed.summary.not_operational, 0);

// ── Failure semantics ──────────────────────────────────────────────────────
await assert.rejects(
  () => fetchSubmarineCables({ fetcher: async () => new Response('', { status: 500 }) }),
  /HTTP 500/,
);
await assert.rejects(
  () => fetchSubmarineCables({
    fetcher: async () => new Response(JSON.stringify({ type: 'FeatureCollection', features: [] }), { status: 200 }),
  }),
  /no features/,
);

// ── Route contract ─────────────────────────────────────────────────────────
const routeSource = readFileSync(resolve(root, 'src/app/api/cables/route.ts'), 'utf8');
assert.match(routeSource, /fetchSubmarineCables/);
// The route must never answer a cold failure with an empty map.
assert.match(routeSource, /status: 502/);
assert.equal(routeSource.includes('Math.random'), false);

console.log('Submarine cable tests passed.');
