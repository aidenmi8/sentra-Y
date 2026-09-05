import { isLoopbackHost } from '@/lib/admin-guard';

/**
 * Sentra Mi8 — guard for the evidence capture/export surfaces.
 *
 * Capture fetches an arbitrary URL server-side and writes it to disk; export
 * reads the whole evidence store. Both are write/exfil surfaces holding a
 * journalist's source material, so they carry the same posture as /api/admin:
 * off unless explicitly enabled, loopback-only (defeats DNS rebinding),
 * cross-origin refused, and a custom header required on the state-changing
 * capture call (which forces a CORS preflight a form POST cannot satisfy).
 */

export const EVIDENCE_REQUEST_HEADER = 'x-sentra-evidence';

export type EvidenceDenialReason = 'disabled' | 'non_local_host' | 'cross_origin' | 'missing_header';

export interface EvidenceGuardResult {
  allowed: boolean;
  reason?: EvidenceDenialReason;
  message?: string;
  status?: number;
}

export function isEvidenceEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const flag = env.ENABLE_EVIDENCE_CAPTURE;
  return typeof flag === 'string' && flag.trim().toLowerCase() === 'true';
}

function isLoopbackOrigin(origin: string | null): boolean {
  if (!origin || origin === 'null') return false;
  try {
    const h = new URL(origin).hostname.toLowerCase();
    return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]';
  } catch {
    return false;
  }
}

export function guardEvidenceRequest(
  request: Request,
  options: { requireWriteHeader?: boolean; env?: Record<string, string | undefined> } = {},
): EvidenceGuardResult {
  const env = options.env ?? process.env;

  if (!isEvidenceEnabled(env)) {
    return { allowed: false, reason: 'disabled', status: 404, message: 'Evidence capture is disabled. Set ENABLE_EVIDENCE_CAPTURE=true.' };
  }
  if (!isLoopbackHost(request.headers.get('host'))) {
    return { allowed: false, reason: 'non_local_host', status: 403, message: 'Evidence endpoints are reachable only over a loopback address.' };
  }
  const origin = request.headers.get('origin');
  if (origin && !isLoopbackOrigin(origin)) {
    return { allowed: false, reason: 'cross_origin', status: 403, message: 'Cross-origin requests to evidence endpoints are refused.' };
  }
  if (options.requireWriteHeader && request.headers.get(EVIDENCE_REQUEST_HEADER) !== '1') {
    return { allowed: false, reason: 'missing_header', status: 403, message: `Capture requires the ${EVIDENCE_REQUEST_HEADER} header.` };
  }
  return { allowed: true };
}
