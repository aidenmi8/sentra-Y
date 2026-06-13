import { NextResponse, type NextRequest } from 'next/server';
import { fetchWikimediaAircraftPhoto } from '@/lib/aircraft-photo';

export async function GET(request: NextRequest) {
  const registration = request.nextUrl.searchParams.get('registration');
  const model = request.nextUrl.searchParams.get('model');
  const icao24 = request.nextUrl.searchParams.get('icao24');

  if (!registration && !model && !icao24) {
    return NextResponse.json(
      { error: 'registration, model, or icao24 is required' },
      { status: 400 },
    );
  }

  const photo = await fetchWikimediaAircraftPhoto({ registration, model, icao24 });

  return NextResponse.json(photo, {
    headers: {
      'Cache-Control': photo.imageUrl
        ? 'public, s-maxage=86400, stale-while-revalidate=604800'
        : 'public, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
}
