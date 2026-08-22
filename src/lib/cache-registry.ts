/**
 * Sentra Mi8 — provider cache invalidation.
 *
 * Changing a credential is not enough on its own: provider modules hold OAuth
 * tokens and route handlers hold response caches, so a new key would otherwise
 * appear to do nothing until the existing cache expired. Modules that cache
 * anything credential-dependent register a reset here, and the admin write path
 * calls them all after a successful write.
 *
 * Route modules register on first import, so a route that has never been hit
 * has no registration — and equally no cache to clear.
 */

const resetters = new Map<string, () => void>();

export function registerCacheReset(name: string, reset: () => void): void {
  resetters.set(name, reset);
}

export function resetAllProviderCaches(): string[] {
  const cleared: string[] = [];
  for (const [name, reset] of resetters) {
    try {
      reset();
      cleared.push(name);
    } catch (error) {
      console.error(`[Sentra Mi8] Cache reset failed for ${name}:`, error);
    }
  }
  return cleared;
}

export function registeredCacheNames(): string[] {
  return [...resetters.keys()];
}
