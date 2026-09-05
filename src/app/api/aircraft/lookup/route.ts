import { NextResponse, type NextRequest } from 'next/server';
import { lookupAdsbAircraftByHex } from '@/lib/flight-providers';
import { adsbRecordToLookupTarget, inferAircraftRegistration } from '@/lib/aircraft-intel';

export const dynamic = 'force-dynamic';

/**
 * Live identity for one aircraft. Used when the regional adsb.lol index missed
 * the hex so the map track has no type/registration.
 */
export async function GET(request: NextRequest) {
  const icao24 = request.nextUrl.searchParams.get('icao24');
  const hex = String(icao24 || '').trim().toLowerCase().replace(/[^0-9a-f]/g, '');
  if (hex.length < 4 || hex.length > 8) {
    return NextResponse.json(
      { error: 'icao24 is required' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const record = await lookupAdsbAircraftByHex(hex);
  const lookup = adsbRecordToLookupTarget(record);
  if (!lookup) {
    return NextResponse.json(
      { found: false, icao24: hex },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }

  return NextResponse.json(
    {
      found: true,
      icao24: hex,
      callsign: lookup.callsign || null,
      registration: inferAircraftRegistration(lookup.registration, lookup.callsign) || null,
      model: lookup.model || null,
      squawk: lookup.squawk || null,
      nac_p: lookup.nac_p ?? null,
    },
    { headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60' } },
  );
}
