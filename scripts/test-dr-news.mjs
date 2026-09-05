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
const { parseDrDate, parseDrNews, fetchDrNews, DR_NEWS_SOURCES } =
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

// ── Feed: a dead source is reported degraded with real status, never faked ──
const degraded = await fetchDrNews({ force: true, fetcher: async () => new Response('', { status: 503 }) });
assert.equal(degraded.degraded, true);
assert.equal(degraded.items.length, 0);
assert.equal(degraded.sources[0].state, 'degraded');
assert.equal(degraded.sources[0].status, 503);

const ok = await fetchDrNews({ force: true, fetcher: async () => new Response(xml, { status: 200 }) });
assert.equal(ok.degraded, false);
assert.equal(ok.items.length, 2);
assert.equal(ok.sources[0].state, 'ok');

// ── Route contract ──
const routeSrc = readFileSync(resolve(root, 'src/app/api/dr/news/route.ts'), 'utf8');
assert.match(routeSrc, /fetchDrNews/);
assert.match(routeSrc, /registerCacheReset/);

rmSync(buildDir, { recursive: true, force: true });
console.log('DR news tests passed.');
