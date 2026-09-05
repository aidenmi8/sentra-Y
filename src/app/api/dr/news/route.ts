import { NextResponse } from 'next/server';
import { fetchDrNews, resetDrNewsCache } from '@/lib/dr-media/news';
import { registerCacheReset } from '@/lib/cache-registry';

export const dynamic = 'force-dynamic';

registerCacheReset('dr-news', resetDrNewsCache);

/** Dominican Republic news feed (Phase 1: Diario Libre), normalized with honest dates. */
export async function GET() {
  try {
    const feed = await fetchDrNews();
    return NextResponse.json(feed, {
      headers: {
        'Cache-Control': feed.degraded ? 'no-store' : 'public, s-maxage=300, stale-while-revalidate=600',
      },
    });
  } catch (error) {
    console.error('[Sentra Mi8] DR news error:', error);
    return NextResponse.json({ error: 'DR news source unavailable' }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
}
