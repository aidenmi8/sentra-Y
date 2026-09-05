/**
 * Sentra Mi8 — admin surface access control.
 *
 * The provider admin routes carry no password by design: they are meant to be
 * opened from the dashboard on the machine running the server. That only stays
 * safe because of four checks, each closing a specific hole that "local only,
 * no auth" services usually leave open.
 *
 *   1. Disabled unless ENABLE_PROVIDER_ADMIN is explicitly on, so a deploy that
 *      does not opt in has no admin surface at all.
 *   2. The Host header must name a loopback address. This is what defeats DNS
 *      rebinding, where an attacker's domain re-resolves to 127.0.0.1 and a page
 *      they control then speaks to a service that only checked the socket.
 *   3. Any Origin header present must itself be loopback, so a cross-site page
 *      cannot drive the endpoint.
 *   4. Writes require a custom header. Custom headers force a CORS preflight,
 *      which is what stops a plain cross-origin form POST — the one request type
 *      that needs no permission from the browser.
 */

export const ADMIN_REQUEST_HEADER = 'x-sentra-admin';
const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1', '0.0.0.0']);

export type AdminDenialReason =
  | 'disabled'
  | 'non_local_host'
  | 'cross_origin'
  | 'missing_admin_header';

export interface AdminGuardResult {
  allowed: boolean;
  reason?: AdminDenialReason;
  message?: string;
  status?: number;
}

export function isAdminEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const flag = env.ENABLE_PROVIDER_ADMIN;
  return typeof flag === 'string' && flag.trim().toLowerCase() === 'true';
}

/** Strips the port and normalises bracketed IPv6 so comparison is on hostname alone. */
export function hostnameOf(hostHeader: string | null): string | null {
  if (!hostHeader) return null;
  const trimmed = hostHeader.trim().toLowerCase();
  if (!trimmed) return null;
  if (trimmed.startsWith('[')) {
    const close = trimmed.indexOf(']');
    return close === -1 ? trimmed : trimmed.slice(0, close + 1);
  }
  const colon = trimmed.indexOf(':');
  return colon === -1 ? trimmed : trimmed.slice(0, colon);
}

export function isLoopbackHost(hostHeader: string | null): boolean {
  const hostname = hostnameOf(hostHeader);
  return hostname != null && LOOPBACK_HOSTNAMES.has(hostname);
}

function isLoopbackOrigin(origin: string | null): boolean {
  if (!origin || origin === 'null') return false;
  try {
    return LOOPBACK_HOSTNAMES.has(new URL(origin).hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function guardAdminRequest(
  request: Request,
  options: { requireWriteHeader?: boolean; env?: Record<string, string | undefined> } = {},
): AdminGuardResult {
  const env = options.env ?? process.env;

  if (!isAdminEnabled(env)) {
    return {
      allowed: false,
      reason: 'disabled',
      status: 404,
      message: 'Provider admin is disabled. Set ENABLE_PROVIDER_ADMIN=true to enable it.',
    };
  }

  if (!isLoopbackHost(request.headers.get('host'))) {
    return {
      allowed: false,
      reason: 'non_local_host',
      status: 403,
      message: 'Provider admin is reachable only over a loopback address.',
    };
  }

  const origin = request.headers.get('origin');
  if (origin && !isLoopbackOrigin(origin)) {
    return {
      allowed: false,
      reason: 'cross_origin',
      status: 403,
      message: 'Cross-origin requests to provider admin are refused.',
    };
  }

  if (options.requireWriteHeader && request.headers.get(ADMIN_REQUEST_HEADER) !== '1') {
    return {
      allowed: false,
      reason: 'missing_admin_header',
      status: 403,
      message: `Writes require the ${ADMIN_REQUEST_HEADER} header.`,
    };
  }

  return { allowed: true };
}
