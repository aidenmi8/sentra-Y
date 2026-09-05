import { NextResponse } from 'next/server';
import { safeFetch } from '@/lib/ssrf-guard';
import { appendEvidence } from '@/lib/dr-media/evidence';
import { guardEvidenceRequest } from '@/lib/dr-media/evidence-guard';

export const dynamic = 'force-dynamic';

const MAX_CAPTURE_BYTES = 8 * 1024 * 1024; // 8MB cap on a single snapshot

/**
 * Capture an article page as tamper-evident evidence.
 *
 * safeFetch validates the target host AND every redirect hop, so an RSS-supplied
 * URL that redirects to an internal address is rejected — the standard SSRF
 * bypass. Only the fetched bytes are stored, hashed, and chained.
 */
export async function POST(request: Request) {
  const guard = guardEvidenceRequest(request, { requireWriteHeader: true });
  if (!guard.allowed) {
    return NextResponse.json({ error: guard.message, reason: guard.reason }, { status: guard.status ?? 403, headers: { 'Cache-Control': 'no-store' } });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Request body must be JSON.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }

  const requestedUrl = (body as { source_url?: unknown })?.source_url;
  const kind = (body as { kind?: unknown })?.kind;
  if (typeof requestedUrl !== 'string' || !/^https?:\/\//i.test(requestedUrl)) {
    return NextResponse.json({ error: 'source_url must be an http(s) URL.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }

  let res: Response;
  try {
    res = await safeFetch(requestedUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Sentra-Mi8-Evidence/1.0)' },
      signal: AbortSignal.timeout(20000),
      maxRedirects: 4,
    });
  } catch (error) {
    // safeFetch throws on a blocked/internal target — that rejection is the point.
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'capture fetch failed' },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  // Enforce the size cap while STREAMING. The source URL comes from an RSS feed we
  // do not control, so a hostile/compromised origin could stream unbounded bytes;
  // buffering the whole body first (arrayBuffer) would OOM the process before any
  // cap is consulted. Reject on a declared Content-Length, then abort mid-stream.
  const tooLarge = () =>
    NextResponse.json({ error: 'Captured content exceeds size limit.' }, { status: 413, headers: { 'Cache-Control': 'no-store' } });

  const declaredLen = Number(res.headers.get('content-length'));
  if (Number.isFinite(declaredLen) && declaredLen > MAX_CAPTURE_BYTES) {
    return tooLarge();
  }

  let buf: Buffer;
  if (!res.body) {
    buf = Buffer.alloc(0);
  } else {
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        total += value.byteLength;
        if (total > MAX_CAPTURE_BYTES) {
          await reader.cancel();
          return tooLarge();
        }
        chunks.push(value);
      }
    } catch (error) {
      try { await reader.cancel(); } catch { /* already closed */ }
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'capture read failed' },
        { status: 502, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    buf = Buffer.concat(chunks);
  }

  const finalUrl = (res as Response & { url?: string }).url || requestedUrl;
  const record = appendEvidence({
    kind: typeof kind === 'string' && kind ? kind : 'news-article',
    requested_url: requestedUrl,
    source_url: finalUrl,
    http_status: res.status,
    content_type: res.headers.get('content-type') || undefined,
    body: buf,
    title: typeof (body as { title?: unknown })?.title === 'string' ? (body as { title: string }).title : undefined,
  });

  return NextResponse.json(
    {
      captured: true,
      seq: record.seq,
      captured_at: record.captured_at,
      content_sha256: record.content_sha256,
      content_bytes: record.content_bytes,
      record_sha256: record.record_sha256,
      http_status: record.http_status,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
