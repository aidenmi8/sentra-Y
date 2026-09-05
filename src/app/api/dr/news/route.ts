import { NextResponse } from 'next/server';
import { fetchDrNews, resetDrNewsCache } from '@/lib/dr-media/news';
import { registerCacheReset } from '@/lib/cache-registry';

export const dynamic = 'force-dynamic';

registerCacheReset('dr-news', resetDrNewsCache);

/** Dominican Republic news feed (Phase 1: Diario Libre), normalized with honest dates. */
export async function GET() {
  try {
    const feed = await fetchDrNews();
    // Don't let the CDN pin a degraded OR empty feed — both are transient states
    // we want re-fetched, not cached at the edge for 5 minutes.
    const cacheable = !feed.degraded && feed.items.length > 0;
    return NextResponse.json(feed, {
      headers: {
        'Cache-Control': cacheable ? 'public, s-maxage=300, stale-while-revalidate=600' : 'no-store',
      },
    });
  } catch (error) {
    console.error('[Sentra Mi8] DR news error:', error);
    return NextResponse.json({ error: 'DR news source unavailable' }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
}
