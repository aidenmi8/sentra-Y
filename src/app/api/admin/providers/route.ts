import { NextResponse } from 'next/server';
import { guardAdminRequest, isAdminEnabled } from '@/lib/admin-guard';
import { buildProviderHealth } from '@/lib/provider-health';
import {
  describeProviderKeys,
  getManagedKeys,
  getOverrideFilePath,
  getProviderEnv,
  setProviderValues,
} from '@/lib/provider-config';
import { resetAllProviderCaches } from '@/lib/cache-registry';

export const dynamic = 'force-dynamic';

/**
 * Provider credential administration.
 *
 * Deliberately write-only with respect to secrets: GET reports whether each key
 * is set and where it came from, never any part of its value. Replacing a key
 * does not require reading it.
 */

function denied(result: ReturnType<typeof guardAdminRequest>) {
  return NextResponse.json(
    { error: result.message, reason: result.reason },
    { status: result.status ?? 403, headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function GET(request: Request) {
  const guard = guardAdminRequest(request);
  if (!guard.allowed) return denied(guard);

  const health = buildProviderHealth(getProviderEnv());

  return NextResponse.json(
    {
      enabled: isAdminEnabled(),
      overrideFile: getOverrideFilePath(),
      managedKeys: getManagedKeys(),
      keys: describeProviderKeys(),
      providers: health.providers,
      summary: health.summary,
      timestamp: new Date().toISOString(),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function POST(request: Request) {
  const guard = guardAdminRequest(request, { requireWriteHeader: true });
  if (!guard.allowed) return denied(guard);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Request body must be JSON.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const updates = (body as { updates?: unknown })?.updates;
  if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
    return NextResponse.json(
      { error: 'Expected an "updates" object mapping provider keys to values.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  let result;
  try {
    result = setProviderValues(updates as Record<string, unknown>);
  } catch (error) {
    console.error('[Sentra Mi8] Provider credential write failed:', error);
    return NextResponse.json(
      { error: 'Could not persist provider configuration. Check that the config directory is writable.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  // Without this a new credential would sit behind a warm OAuth token or a
  // cached response and appear to have had no effect.
  const clearedCaches = resetAllProviderCaches();
  const health = buildProviderHealth(getProviderEnv());

  return NextResponse.json(
    {
      ...result,
      clearedCaches,
      keys: describeProviderKeys(),
      providers: health.providers,
      summary: health.summary,
      timestamp: new Date().toISOString(),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
