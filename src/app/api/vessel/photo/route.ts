import { NextResponse, type NextRequest } from 'next/server';
import { fetchVesselPhoto } from '@/lib/vessel-photo';

export async function GET(request: NextRequest) {
  const name = request.nextUrl.searchParams.get('name');
  const imo = request.nextUrl.searchParams.get('imo');
  const mmsi = request.nextUrl.searchParams.get('mmsi');
  const type = request.nextUrl.searchParams.get('type');

  if (!name && !imo && !mmsi && !type) {
    return NextResponse.json(
      { error: 'name, imo, or mmsi is required' },
      { status: 400 },
    );
  }

  const photo = await fetchVesselPhoto({ name, imo, mmsi, type });
  return NextResponse.json(photo, {
    headers: {
      'Cache-Control': photo.imageUrl
        ? 'public, s-maxage=86400, stale-while-revalidate=604800'
        : 'public, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
}
