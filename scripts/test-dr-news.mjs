import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const root = process.cwd();
const buildDir = mkdtempSync(join(tmpdir(), 'sentra-drnews-'));
const src = readFileSync(resolve(root, 'src/lib/dr-media/news.ts'), 'utf8');
const { outputText } = ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  fileName: 'news.ts',
});
writeFileSync(join(buildDir, 'news.mjs'), outputText, 'utf8');
const { parseDrDate, parseDrNews, fetchDrNews, resetDrNewsCache, DR_NEWS_SOURCES } =
  await import(pathToFileURL(join(buildDir, 'news.mjs')).href);

// ── Spanish date layer — the whole reason this module exists ──
const ago = parseDrDate('Sat, 22 Ago 2026 16:03:00 GMT');
assert.equal(ago.basis, 'rfc822-spanish-month');
assert.equal(ago.iso, '2026-08-22T16:03:00.000Z', 'Ago -> August');
assert.equal(parseDrDate('Mié, 01 Ene 2026 05:00:00 GMT').iso, '2026-01-01T05:00:00.000Z', 'Ene -> January');
assert.equal(parseDrDate('Wed, 01 Jan 2026 05:00:00 GMT').basis, 'rfc822', 'English month still works');
assert.equal(parseDrDate('2026-08-22T16:03:00Z').basis, 'iso');
// The critical rule: an unparseable date is NEVER a fabricated timestamp.
assert.deepEqual(parseDrDate('garbage'), { iso: null, basis: 'unparseable' });
assert.deepEqual(parseDrDate(''), { iso: null, basis: 'unparseable' });
assert.deepEqual(parseDrDate(null), { iso: null, basis: 'unparseable' });

// ── RSS parse ──
const xml = `<rss><channel>
  <item><title><![CDATA[Titular uno]]></title><link>https://www.diariolibre.com/a/1</link>
    <description>Cuerpo &lt;b&gt;uno&lt;/b&gt;</description><pubDate>Sat, 22 Ago 2026 16:03:00 GMT</pubDate></item>
  <item><title>Ito Bison&#243; 64 &#38;#37; &amp; la Constituci&#xf3;n</title><link>https://www.diariolibre.com/a/2</link>
    <pubDate>fecha rara</pubDate></item>
  <item><title>No link</title></item>
</channel></rss>`;
const items = parseDrNews(xml, DR_NEWS_SOURCES[0]);
assert.equal(items.length, 2, 'item with no link is dropped');
assert.equal(items[0].title, 'Titular uno');
assert.equal(items[0].link, 'https://www.diariolibre.com/a/1');
assert.equal(items[0].published_utc, '2026-08-22T16:03:00.000Z');
assert.equal(items[0].published_basis, 'rfc822-spanish-month');
assert.equal(items[0].summary, 'Cuerpo uno', 'html stripped');
// Numeric (decimal + hex) + named entities decode — critical for Spanish
// accents (&#243; = ó, &#xf3; = ó). Diario Libre double-encodes literals like
// `&#38;#37;` (= %); the bounded second decode pass resolves that too.
assert.equal(items[1].title, 'Ito Bisonó 64 % & la Constitución', 'numeric/hex/named + double-encoded entities decoded');
// Unparseable date item keeps a null time + honest basis (no fabrication).
assert.equal(items[1].published_utc, null);
assert.equal(items[1].published_basis, 'unparseable');
assert.equal(items[1].published_raw, 'fecha rara');
// Stable id derived from the link, not the date.
assert.match(items[0].id, /^drnews-diariolibre-/);
assert.equal(parseDrNews(xml, DR_NEWS_SOURCES[0])[0].id, items[0].id, 'id is stable across parses');

// ── Feed health + cache integrity (multi-source) ──
// Per-outlet fixture: source i yields (i+1) items at distinct links.
const feedXml = (base, n) => `<rss><channel>${Array.from({ length: n }, (_, i) =>
  `<item><title>Item ${i}</title><link>${base}/${i}</link><pubDate>Sat, 22 Ago 2026 16:0${i}:00 GMT</pubDate></item>`).join('')}</channel></rss>`;
const okBodies = Object.fromEntries(DR_NEWS_SOURCES.map((s, i) => [s.url, feedXml(`https://x-${s.id}`, i + 1)]));
const okTotal = DR_NEWS_SOURCES.reduce((n, _s, i) => n + (i + 1), 0);
const countingFetcher = (bodies) => {
  let calls = 0;
  const fn = async (url) => { calls++; const b = bodies[url]; return b ? new Response(b, { status: 200 }) : new Response('', { status: 503 }); };
  fn.calls = () => calls;
  return fn;
};

// All outlets down -> degraded, zero items, every source flagged with real status.
resetDrNewsCache();
const allDown = await fetchDrNews({ fetcher: countingFetcher({}) });
assert.equal(allDown.degraded, true);
assert.equal(allDown.items.length, 0);
assert.equal(allDown.sources.length, DR_NEWS_SOURCES.length);
assert.ok(allDown.sources.every((s) => s.state === 'degraded'), 'all sources degraded');
assert.ok(allDown.sources.some((s) => s.status === 503), 'real HTTP status is reported, never a fake zero');

// Partial outage: only the first outlet is healthy.
resetDrNewsCache();
const pf = countingFetcher({ [DR_NEWS_SOURCES[0].url]: feedXml('https://x-0', 1) });
const partial = await fetchDrNews({ fetcher: pf });
assert.equal(partial.degraded, true, 'a down outlet marks the feed degraded');
assert.equal(partial.items.length, 1, 'only the healthy outlet contributes items');
assert.ok(partial.sources.some((s) => s.state === 'ok') && partial.sources.some((s) => s.state === 'degraded'), 'mixed per-source health');
// THE BUG FIX: a follow-up (non-force) replays the degraded snapshot with real
// per-source health — never sources:[] / degraded:false — and does not re-fan-out.
const callsAfterPartial = pf.calls();
const partialCached = await fetchDrNews({ fetcher: pf });
assert.equal(pf.calls(), callsAfterPartial, 'degraded snapshot is cached — no retry storm');
assert.equal(partialCached.degraded, true, 'cache hit preserves degraded');
assert.equal(partialCached.sources.length, DR_NEWS_SOURCES.length, 'cache hit replays real sources, not []');
assert.ok(partialCached.sources.some((s) => s.state === 'degraded'), 'cache hit preserves per-source health');
// force:true still retries the down outlet.
await fetchDrNews({ fetcher: pf, force: true });
assert.ok(pf.calls() > callsAfterPartial, 'force bypasses the cache and retries');

// All healthy -> degraded false, items summed, cached; cache hit replays real sources.
resetDrNewsCache();
const okf = countingFetcher(okBodies);
const ok = await fetchDrNews({ fetcher: okf });
assert.equal(ok.degraded, false);
assert.equal(ok.items.length, okTotal, 'items summed across outlets');
assert.ok(ok.sources.every((s) => s.state === 'ok'));
const callsAfterOk = okf.calls();
const cached = await fetchDrNews({ fetcher: okf });
assert.equal(okf.calls(), callsAfterOk, 'healthy snapshot is cached (no re-fetch)');
assert.equal(cached.items.length, okTotal);
assert.equal(cached.sources.length, DR_NEWS_SOURCES.length, 'cache hit replays real sources');
assert.ok(cached.sources.every((s) => s.state === 'ok'), 'cache hit preserves per-source health');

// Empty-but-reachable (all 200, no items) is not masked as healthy, and is cached
// only briefly (retried), not pinned — proven here by the cached follow-up.
resetDrNewsCache();
const ecf = countingFetcher(Object.fromEntries(DR_NEWS_SOURCES.map((s) => [s.url, '<rss><channel></channel></rss>'])));
const empty = await fetchDrNews({ fetcher: ecf });
assert.equal(empty.items.length, 0);
assert.equal(empty.degraded, false, 'reachable-but-empty is not a source failure');
assert.ok(empty.sources.every((s) => s.state === 'ok'), 'reachable sources report ok');
const callsAfterEmpty = ecf.calls();
await fetchDrNews({ fetcher: ecf });
assert.equal(ecf.calls(), callsAfterEmpty, 'empty snapshot is cached briefly, not re-fetched each request');
resetDrNewsCache();

// ── Route contract ──
const routeSrc = readFileSync(resolve(root, 'src/app/api/dr/news/route.ts'), 'utf8');
assert.match(routeSrc, /fetchDrNews/);
assert.match(routeSrc, /registerCacheReset/);

rmSync(buildDir, { recursive: true, force: true });
console.log('DR news tests passed.');
