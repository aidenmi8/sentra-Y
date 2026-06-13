import { readFileSync, existsSync } from 'node:fs';
import { relative, resolve } from 'node:path';

const root = process.cwd();

const scannedFiles = [
  '.env.example',
  '.env.template',
  'DOCKER.md',
  'README.md',
  'SECURITY.md',
  'docker-compose.local.yml',
  'docker-compose.yml',
  'intel/package.json',
  'nginx/nginx.conf',
  'package.json',
  'public/manifest.json',
  'public/robots.txt',
  'public/site.webmanifest',
  'public/sitemap.xml',
  'src/app/api/health/route.ts',
  'src/app/layout.tsx',
  'src/app/page.tsx',
  'src/components/AiAnalyst.tsx',
  'src/components/CameraViewer.tsx',
  'src/components/EntityGraphPanel.tsx',
  'src/components/GlobalStatusBar.tsx',
  'src/components/IntelFeed.tsx',
  'src/components/KeyboardShortcuts.tsx',
  'src/components/LayerPanel.tsx',
  'src/components/LiveAlerts.tsx',
  'src/components/MarketsPanel.tsx',
  'src/components/OsintPanel.tsx',
  'src/components/SearchBar.tsx',
  'src/components/SharePanel.tsx',
];

const legacyAllowed = [
  /\blegacy\b/i,
  /\bdeprecated\b/i,
  /\bcompat(?:ibility)?\b/i,
  /\balias(?:es)?\b/i,
  /\bOSIRIS_[A-Z0-9_]+\b/,
  /\bLOCAL_OSIRIS_[A-Z0-9_]+\b/,
  /\bopenOsirisIntel\b/,
  /\bosirisBaseUrl\b/,
  /\bingestOsirisData\b/,
  /\bosiris-intel\b/,
  /\bosiris-cache\b/,
];

const forbidden = [
  /\bOSIRIS\b/,
  /\bOsiris\b/,
  /\bosirisai\.live\b/i,
  /\bosiris\.vercel\.app\b/i,
  /\bosiris-icon\.png\b/i,
  /patreon\.com\/Osiris/i,
  /discord\.gg\/osiris/i,
];

const requiredText = new Map([
  ['src/app/api/health/route.ts', ['Sentra Mi8']],
  ['src/app/layout.tsx', ['Sentra Mi8']],
  ['public/manifest.json', ['Sentra Mi8']],
  ['public/site.webmanifest', ['Sentra Mi8']],
]);

const failures = [];

for (const file of scannedFiles) {
  const absolute = resolve(root, file);
  if (!existsSync(absolute)) continue;
  const contents = readFileSync(absolute, 'utf8');
  const rel = relative(root, absolute);

  const required = requiredText.get(file);
  if (required) {
    for (const term of required) {
      if (!contents.includes(term)) {
        failures.push(`${rel}: missing required brand text "${term}"`);
      }
    }
  }

  contents.split(/\r?\n/).forEach((line, index) => {
    if (!forbidden.some((pattern) => pattern.test(line))) return;
    if (legacyAllowed.some((pattern) => pattern.test(line))) return;
    failures.push(`${rel}:${index + 1}: active OSIRIS reference: ${line.trim()}`);
  });
}

if (failures.length > 0) {
  console.error('Branding check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Branding check passed.');
