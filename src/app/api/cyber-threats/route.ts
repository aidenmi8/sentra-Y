import { NextResponse } from 'next/server';

// Cyber threat intelligence from public feeds
// Inspired by WorldMonitor's infrastructure tracking

export async function GET() {
  try {
    const results: any = { threats: [], stats: {}, timestamp: new Date().toISOString() };

    // 1. CISA Known Exploited Vulnerabilities (authoritative US govt source)
    try {
      const res = await fetch('https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json', {

      });
      if (res.ok) {
        const data = await res.json();
        const recent = (data.vulnerabilities || [])
          .filter((v: any) => {
            const added = new Date(v.dateAdded);
            const daysAgo = (Date.now() - added.getTime()) / (1000 * 60 * 60 * 24);
            return daysAgo <= 30;
          })
          .slice(0, 10)
          .map((v: any) => ({
            id: v.cveID,
            name: v.vulnerabilityName,
            vendor: v.vendorProject,
            product: v.product,
            // CISA KEV publishes no severity field. Membership in the catalogue
            // means "known exploited", which is what we report — stamping every
            // entry CRITICAL invented a rating the source never assigned.
            known_exploited: true,
            ransomware_use: v.knownRansomwareCampaignUse ?? null,
            date: v.dateAdded,
            due: v.dueDate,
            source: 'CISA KEV',
          }));
        results.threats.push(...recent);
        results.stats.cisa_total = data.vulnerabilities?.length || 0;
      }
    } catch (e) { console.warn('[Sentra Mi8] Suppressed error:', e instanceof Error ? e.message : e); }

    // Shadowserver publishes an HTML dashboard, not a JSON statistics feed.
    // The previous call fetched that page, parsed nothing, and reported
    // 'active' purely because the page returned 200. Removed rather than left
    // in place reporting a liveness it never measured.

    // 2. Aggregate stats
    results.stats.active_cves = results.threats.length;
    // The catalogue slice is capped at 10, so a count-derived "threat level"
    // was effectively a constant. Report the counts and let the UI present them.
    results.stats.recent_kev_additions = results.threats.length;
    results.stats.window_days = 30;

    return NextResponse.json(results);
  } catch {
    return NextResponse.json({ threats: [], stats: {}, error: 'Failed' }, { status: 500 });
  }
}
