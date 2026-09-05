import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const pageSource = readFileSync(resolve(process.cwd(), 'src/app/page.tsx'), 'utf8');

assert.match(
  pageSource,
  /const\s+SPLASH_BOOT_DURATION_MS\s*=\s*4000;/,
  'Splash boot duration should be 4000ms.',
);
assert.match(
  pageSource,
  /const\s+SPLASH_PROGRESS_DURATION_SECONDS\s*=\s*3\.4;/,
  'Splash progress bar should fill over 3.4 seconds after its 0.5 second delay.',
);
assert.match(
  pageSource,
  /setTimeout\(\(\)\s*=>\s*setShowSplash\(false\),\s*SPLASH_BOOT_DURATION_MS\)/,
  'Splash hide timer should use the shared 4000ms duration constant.',
);
assert.equal(
  pageSource.includes('setShowSplash(false), 2500'),
  false,
  'Old 2.5 second splash hide timer should be removed.',
);

console.log('Splash timing tests passed.');
