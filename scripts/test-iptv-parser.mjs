import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

const root = process.cwd();
const sourcePath = resolve(root, 'src/lib/iptv.ts');
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
const iptv = await import(moduleUrl);

const sample = `#EXTM3U
#EXTINF:-1 tvg-id="NewsOne.do" tvg-name="News One" tvg-logo="https://example.com/logo.png" group-title="News",News One HD
https://cdn.example.com/live/news/index.m3u8
#EXTINF:-1 tvg-name="Blocked" group-title="News",Blocked
rtmp://example.com/blocked
#EXTINF:-1 tvg-name="Adult Feed" group-title="XXX",Adult Feed
https://example.com/adult.m3u8
#EXTINF:-1 tvg-name="Replay" group-title="General",Replay
https://example.com/replay.mp4?token=abc
#EXTINF:-1 http-user-agent="Mozilla/5.0 (KHTML, like Gecko) Chrome/92.0" group-title="General",Telemicro (1080p)
https://example.com/telemicro.m3u8
`;

const channels = iptv.parseIptvPlaylist(sample, {
  countryCode: 'DO',
  sourceUrl: 'https://iptv-org.github.io/iptv/countries/do.m3u',
});

assert.equal(channels.length, 3);
assert.deepEqual(channels[0], {
  id: channels[0].id,
  name: 'News One',
  countryCode: 'DO',
  logo: 'https://example.com/logo.png',
  group: 'News',
  streamUrl: 'https://cdn.example.com/live/news/index.m3u8',
  streamType: 'hls',
  source: 'iptv-org',
  sourceUrl: 'https://iptv-org.github.io/iptv/countries/do.m3u',
});
assert.match(channels[0].id, /^iptv-do-news-one-[a-z0-9]+$/);
assert.equal(channels[1].name, 'Replay');
assert.equal(channels[1].streamType, 'video');
assert.equal(channels[2].name, 'Telemicro (1080p)');
assert.equal(channels[2].group, 'General');
assert.equal(channels[2].streamType, 'hls');

assert.equal(iptv.normalizeCountryCode('do'), 'DO');
assert.equal(iptv.normalizeCountryCode('D1'), null);
assert.equal(iptv.inferIptvStreamType('https://example.com/live.m3u8?x=1'), 'hls');
assert.equal(iptv.inferIptvStreamType('https://example.com/watch'), 'external');

console.log('IPTV parser tests passed.');
