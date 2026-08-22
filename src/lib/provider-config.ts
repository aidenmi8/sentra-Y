import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { buildProviderHealth } from './provider-health';

/**
 * Sentra Mi8 — runtime provider credential overrides.
 *
 * Values live in a gitignored JSON overlay that is read at request time and
 * merged over `process.env`. Environment variables remain the base layer, so a
 * container that sets real env vars keeps working untouched and the overlay is
 * purely additive.
 *
 * Nothing here ever returns a secret value to a caller. `describeProviderKeys`
 * reports only whether a key is set and where it came from — the same principle
 * `/api/provider-health` already follows.
 */

const OVERRIDE_DIR = process.env.SENTRA_CONFIG_DIR || join(process.cwd(), 'config');
const OVERRIDE_FILE = join(OVERRIDE_DIR, 'providers.local.json');

export type EnvLike = Record<string, string | undefined>;
export type KeySource = 'override' | 'environment' | 'unset';

export interface ManagedKeyStatus {
  key: string;
  set: boolean;
  source: KeySource;
  /** Character count only — never any portion of the value itself. */
  length: number;
}

let cachedOverrides: Record<string, string> | null = null;
let cachedMergedEnv: EnvLike | null = null;

/**
 * The set of keys the admin surface is permitted to write. Derived from the
 * provider inventory so a newly added provider is manageable automatically and
 * an attacker cannot set arbitrary process variables such as PATH or NODE_OPTIONS.
 */
export function getManagedKeys(): string[] {
  const keys = new Set<string>();
  for (const provider of buildProviderHealth({}).providers) {
    for (const key of provider.env) keys.add(key);
  }
  // Gemini uses a numbered rotation rather than a single declared variable.
  for (let i = 1; i <= 8; i++) keys.add(`GEMINI_API_KEY_${i}`);
  return [...keys].sort();
}

export function isManagedKey(key: string): boolean {
  return getManagedKeys().includes(key);
}

function readOverrides(): Record<string, string> {
  if (cachedOverrides) return cachedOverrides;
  try {
    if (!existsSync(OVERRIDE_FILE)) {
      cachedOverrides = {};
      return cachedOverrides;
    }
    const parsed = JSON.parse(readFileSync(OVERRIDE_FILE, 'utf8'));
    const clean: Record<string, string> = {};
    if (parsed && typeof parsed === 'object') {
      for (const [key, value] of Object.entries(parsed)) {
        // Re-check the allowlist on read: a hand-edited file must not be able to
        // inject variables the write path would have rejected.
        if (typeof value === 'string' && value.length > 0 && isManagedKey(key)) {
          clean[key] = value;
        }
      }
    }
    cachedOverrides = clean;
  } catch (error) {
    console.error('[Sentra Mi8] Provider override file unreadable; falling back to environment only:', error);
    cachedOverrides = {};
  }
  return cachedOverrides;
}

/**
 * The environment every provider module should read. Pass this into
 * `fetchFlightData`, `buildProviderHealth`, and friends instead of `process.env`.
 */
export function getProviderEnv(): EnvLike {
  if (cachedMergedEnv) return cachedMergedEnv;
  cachedMergedEnv = { ...process.env, ...readOverrides() };
  return cachedMergedEnv;
}

export function invalidateProviderConfigCache(): void {
  cachedOverrides = null;
  cachedMergedEnv = null;
}

/** Reports which keys are configured and from where — never the values. */
export function describeProviderKeys(): ManagedKeyStatus[] {
  const overrides = readOverrides();
  return getManagedKeys().map((key) => {
    const overrideValue = overrides[key];
    const envValue = process.env[key];
    if (typeof overrideValue === 'string' && overrideValue.length > 0) {
      return { key, set: true, source: 'override' as const, length: overrideValue.length };
    }
    if (typeof envValue === 'string' && envValue.trim().length > 0) {
      return { key, set: true, source: 'environment' as const, length: envValue.length };
    }
    return { key, set: false, source: 'unset' as const, length: 0 };
  });
}

export interface WriteResult {
  applied: string[];
  cleared: string[];
  rejected: string[];
}

/**
 * Applies credential updates. An empty string clears the override, which falls
 * the key back to its environment value rather than blanking it.
 *
 * The file is written to a temporary path and renamed so a crash mid-write
 * cannot leave a truncated config behind.
 */
export function setProviderValues(updates: Record<string, unknown>): WriteResult {
  const current = { ...readOverrides() };
  const applied: string[] = [];
  const cleared: string[] = [];
  const rejected: string[] = [];

  for (const [rawKey, rawValue] of Object.entries(updates)) {
    const key = String(rawKey).trim();
    if (!isManagedKey(key)) {
      rejected.push(key);
      continue;
    }
    if (typeof rawValue !== 'string') {
      rejected.push(key);
      continue;
    }
    const value = rawValue.trim();
    if (value.length === 0) {
      delete current[key];
      cleared.push(key);
    } else {
      current[key] = value;
      applied.push(key);
    }
  }

  persist(current);
  invalidateProviderConfigCache();

  return { applied, cleared, rejected };
}

function persist(overrides: Record<string, string>): void {
  mkdirSync(dirname(OVERRIDE_FILE), { recursive: true });
  const tempPath = `${OVERRIDE_FILE}.tmp`;
  try {
    // 0o600: readable only by the account running the server.
    writeFileSync(tempPath, `${JSON.stringify(overrides, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    renameSync(tempPath, OVERRIDE_FILE);
  } catch (error) {
    try {
      if (existsSync(tempPath)) unlinkSync(tempPath);
    } catch {
      // Best-effort cleanup only.
    }
    throw error;
  }
}

export function getOverrideFilePath(): string {
  return OVERRIDE_FILE;
}
