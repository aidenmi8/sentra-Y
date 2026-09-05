---
type: Testing Guide
title: Testing and Change Verification
description: Explains the repository’s script-based test suite, what behaviors it covers, and the verification sequence for UI, provider, route, and deployment changes.
tags: [testing, verification, scripts]
---

# Testing and change verification

The repository uses focused Node scripts rather than Jest, Vitest, or a conventional unit-test framework. `package.json` composes them into `npm test`:

```bash
npm run lint
npm run build
npm test
```

## Test coverage map

| Command | Main concern |
|---|---|
| `npm run test:branding` | Product naming and asset contracts |
| `npm run test:iptv` | IPTV parsing and normalization |
| `npm run test:ais` | AIS parser behavior |
| `npm run test:entity-intel` | Entity intelligence helpers |
| `npm run test:provider-health` | Provider state, redaction, and hard-coded secret/address checks |
| `npm run test:opensky` | Aviation provider: OpenSky request/fallback plus adsb.lol enrichment and shared type-code classification |
| `npm run test:aircraft-intel` | Aircraft metadata/intelligence helpers |
| `npm run test:aircraft-intel-wiring` | Aircraft feature connection between UI and data path |
| `npm run test:splash-timing` | Dashboard splash timing constants and behavior contracts |
| `npm run test:default-map-view` | Initial map view contract |
| `npm run test:cables` | Submarine cable status derivation, summary, and route contract |
| `npm run test:provider-admin` | Admin guard (feature flag, loopback, cross-origin, write header), overlay storage/redaction, cache-reset registry |
| `npm run test:cameras` | Worldwide cameras: bbox validation, OSM/Windy normalization, degraded paths |
| `npm run test:fl511` | FDOT FL511: WKT parsing, record normalization, multi-page collection, partial-page failure, plus the live path — camera-id parsing, DIVAS allowlist, token resolution, and same-origin HLS playlist rewriting |
| `npm run test:ny511` | NYSDOT 511NY: WKT parsing, direct-HLS normalization (unauthenticated stream becomes playable; auth-required does not), multi-page collection, partial-page failure, route wiring |

`npm test` runs all of the above in the order declared in `package.json`. Read the relevant script before changing a contract; several tests are static source assertions rather than live endpoint tests. The scripts transpile the TypeScript modules they exercise and inject a fake `fetcher`, so they run without network access.

## Change-oriented verification

- **Provider or route change:** run provider-health, the domain-specific parser/provider script (cables, cameras, fl511, opensky as applicable), lint, and build. Check fallback, empty, timeout, and secret-redaction paths. A new provider should also add an entry to `src/lib/provider-health.ts` (which also feeds the admin allowlist).
- **Credential/admin change:** run provider-admin plus lint/build, and confirm the guard denials (disabled → 404, non-loopback Host → 403, cross-origin → 403, missing write header → 403) and that no response carries a secret value.
- **Aircraft or map change:** run OpenSky, aircraft intelligence, wiring, and default-view checks. Verify the corresponding data key, GeoJSON source, layer visibility, and click callback in `page.tsx` and `SentraMap.tsx`.
- **UI timing or shell change:** run splash/default-view checks and build; inspect URL state, dynamic imports, and hidden-document behavior.
- **Security-sensitive route change:** run provider-health plus lint/build, and manually inspect input validation, rate limits, SSRF/redirect checks, authentication, and error responses. Existing scripts do not prove multi-replica enforcement or end-to-end webhook/scanner safety.
- **Deployment change:** build the Docker image and exercise `/api/health` and `/api/provider-health` from the chosen compose topology.

## Known gaps

There is no visible live-provider integration suite, durable state test, distributed rate-limit test, Docker healthcheck test, SDK stream authorization test, or webhook-forwarding end-to-end test in the current package scripts. Add tests close to a new provider or route when deterministic behavior can be isolated without external network calls.

The [source map](../source-map.md) identifies the correct script and implementation anchor for each area. The [operations runbook](../operations/runbook.md) covers runtime checks after build/deploy.
