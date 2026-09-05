import { NextResponse } from 'next/server';
import { registerCacheReset } from '@/lib/cache-registry';
import { parseFl511ImageId, resetFl511Caches, resolveFl511LiveStream } from '../fl511';

export const dynamic = 'force-dynamic';

registerCacheReset('fl511', resetFl511Caches);

/**
 * Mint a playable FL511 / DIVAS HLS URL for one camera.
 *
 * DIVAS origin-locks playback to fl511.com, so the client must load the
 * returned `proxy_url` rather than `play_url` directly.
 */
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get('id');
  if (!parseFl511ImageId(id)) {
    return NextResponse.json(
      { error: 'A numeric FL511 camera id is required (fl511-<id>).' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  try {
    const url = new URL(request.url);
    const videoUrl = url.searchParams.get('videoUrl') || undefined;
    const stream = await resolveFl511LiveStream(id!, {
      videoUrl,
      feedUrl: url.searchParams.get('feedUrl') || undefined,
      name: url.searchParams.get('name') || undefined,
    });
    return NextResponse.json(
      {
        id: stream.id,
        name: stream.name,
        feed_url: stream.feed_url,
        video_url: stream.video_url,
        proxy_url: stream.proxy_url,
        stream_type: 'hls',
        timestamp: new Date().toISOString(),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to resolve FL511 live stream';
    const status = /no live stream/i.test(message) ? 404 : 502;
    return NextResponse.json(
      { error: message },
      { status, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
