import { NextResponse } from 'next/server';

/**
 * Process liveness. This route deliberately reports only what it can observe
 * about this process — it previously returned a hardcoded `status: 'operational'`
 * and so could never indicate degradation, whatever the state of the app.
 *
 * Upstream provider reachability is a separate concern; see /api/provider-health
 * for configuration state and each domain route for its own `degraded` flag.
 */
export async function GET() {
  const checks: Record<string, boolean> = {
    // The route executing at all proves the server can serve requests.
    server: true,
    // Route handlers depend on the Node runtime primitives below.
    fetch_available: typeof fetch === 'function',
    timers_available: typeof setTimeout === 'function',
  };

  const failing = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
  const healthy = failing.length === 0;

  return NextResponse.json(
    {
      status: healthy ? 'operational' : 'degraded',
      platform: 'Sentra Mi8',
      scope: 'process liveness only — see /api/provider-health for provider configuration',
      checks,
      failing,
      uptime_seconds: typeof process?.uptime === 'function' ? Math.round(process.uptime()) : null,
      timestamp: new Date().toISOString(),
    },
    {
      status: healthy ? 200 : 503,
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}
