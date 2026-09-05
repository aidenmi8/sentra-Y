import { NextResponse } from 'next/server';
import { captureHistoryForUrl } from '@/lib/dr-media/evidence';
import { guardEvidenceRequest } from '@/lib/dr-media/evidence-guard';

export const dynamic = 'force-dynamic';

// A requested_url is an RSS article link; real ones are well under this. The cap
// only exists so a caller-supplied string can't be pathologically long.
const MAX_URL_LEN = 2048;

/**
 * The capture timeline for one URL — how a reporter proves a silent edit or an
 * un-publish. Read-only over the journalist's own store, so it runs behind the
 * same loopback+flag guard as the rest of the evidence surface but needs no write
 * header. It does no fetching (the `url` is only ever compared against stored
 * `requested_url` values), so there is no SSRF surface and no safeFetch here.
 *
 * A `url` that matches nothing returns an empty timeline with 200 — never the
 * whole ledger. The filter is exact-match; there is no fall-through to "return
 * everything" on a miss.
 */
export async function GET(request: Request) {
  const guard = guardEvidenceRequest(request);
  if (!guard.allowed) {
    return NextResponse.json({ error: guard.message, reason: guard.reason }, { status: guard.status ?? 403, headers: { 'Cache-Control': 'no-store' } });
  }

  const url = new URL(request.url).searchParams.get('url');
  if (!url) {
    return NextResponse.json({ error: 'url query parameter is required.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }
  if (url.length > MAX_URL_LEN || !/^https?:\/\//i.test(url)) {
    return NextResponse.json({ error: 'url must be an http(s) URL under 2048 characters.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }

  const timeline = captureHistoryForUrl(url);
  const changes = timeline.filter((e) => e.changed_from_prev).length;

  return NextResponse.json(
    {
      url,
      capture_count: timeline.length,
      change_count: changes,
      first_captured_at: timeline.length > 0 ? timeline[0].captured_at : null,
      last_captured_at: timeline.length > 0 ? timeline[timeline.length - 1].captured_at : null,
      timeline,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
