import { isAllowedDivasUrl, isHlsPlaylistBody, fetchDivasMedia, rewriteHlsPlaylist } from '../fl511';

export const dynamic = 'force-dynamic';

/**
 * Same-origin HLS proxy for FDOT DIVAS edges.
 *
 * The browser cannot fetch `*.divas.cloud` playlists itself: those hosts 401
 * any Origin other than fl511.com. We fetch as FL511 and rewrite child URIs
 * back through this route so hls.js stays on our origin.
 */
export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get('u');
  if (!raw || !isAllowedDivasUrl(raw)) {
    return new Response('Forbidden', { status: 403, headers: { 'Cache-Control': 'no-store' } });
  }

  try {
    const upstream = await fetchDivasMedia(raw);
    if (!upstream.ok) {
      return new Response(null, {
        status: upstream.status,
        headers: { 'Cache-Control': 'no-store' },
      });
    }

    const contentType = upstream.headers.get('content-type') || '';
    if (/mpegurl|x-mpegurl|vnd\.apple\.mpegurl/i.test(contentType)) {
      const rewritten = rewriteHlsPlaylist(await upstream.text(), raw);
      return new Response(rewritten, {
        status: 200,
        headers: {
          'Content-Type': 'application/vnd.apple.mpegurl',
          'Cache-Control': 'no-store',
        },
      });
    }

    if (/video|mp4|octet-stream/i.test(contentType) && upstream.body) {
      const headers = new Headers({ 'Cache-Control': 'no-store' });
      headers.set('Content-Type', contentType);
      return new Response(upstream.body, { status: 200, headers });
    }

    const buffer = Buffer.from(await upstream.arrayBuffer());
    if (isHlsPlaylistBody(contentType, buffer.subarray(0, 64).toString('utf8'))) {
      const rewritten = rewriteHlsPlaylist(buffer.toString('utf8'), raw);
      return new Response(rewritten, {
        status: 200,
        headers: {
          'Content-Type': 'application/vnd.apple.mpegurl',
          'Cache-Control': 'no-store',
        },
      });
    }

    const headers = new Headers({ 'Cache-Control': 'no-store' });
    if (contentType) headers.set('Content-Type', contentType);
    return new Response(buffer, { status: 200, headers });
  } catch {
    return new Response('Bad gateway', { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
}
