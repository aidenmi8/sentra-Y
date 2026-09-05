import { NextResponse, type NextRequest } from 'next/server';
import { fetchAircraftPhoto } from '@/lib/aircraft-photo';

export async function GET(request: NextRequest) {
  const registration = request.nextUrl.searchParams.get('registration');
  const model = request.nextUrl.searchParams.get('model');
  const icao24 = request.nextUrl.searchParams.get('icao24');
  const callsign = request.nextUrl.searchParams.get('callsign');

  if (!registration && !model && !icao24 && !callsign) {
    return NextResponse.json(
      { error: 'registration, model, icao24, or callsign is required' },
      { status: 400 },
    );
  }

  const photo = await fetchAircraftPhoto({ registration, model, icao24, callsign });

  return NextResponse.json(photo, {
    headers: {
      'Cache-Control': photo.imageUrl
        ? 'public, s-maxage=86400, stale-while-revalidate=604800'
        : 'public, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
}
