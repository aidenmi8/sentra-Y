---
type: Source Map
title: Sentra Mi8 Source Map
description: Practical map from product concerns to the files and directories that implement them, with starting points for future changes.
tags: [source-map, navigation, engineering]
---

# Source map

Use this page to choose the smallest useful inspection set before changing code. The [architecture overview](architecture/overview.md) explains how these areas connect.

| Concern | Start here | What it owns |
|---|---|---|
| Dashboard orchestration | `src/app/page.tsx` | Client state, URL state, polling, progressive fetches, panel composition, map/entity interactions |
| Map rendering | `src/components/SentraMap.tsx` | MapLibre lifecycle, styles, GeoJSON sources/layers, tile proxy requests, entity click callbacks |
| Layer controls | `src/components/LayerPanel.tsx` | Layer toggles, categories, visibility and activation controls |
| Detailed intelligence UI | `src/components/EntityGraphPanel.tsx`, `OsintPanel.tsx`, `AiAnalyst.tsx` | Entity expansion, RECON tools, AI analysis and briefings |
| Live media | `CameraViewer.tsx`, `LiveStreamPlayer.tsx`, `src/app/api/cctv/`, `src/app/api/live-news/`, `src/app/api/iptv/` | Camera status/playback and external live feeds |
| Worldwide cameras | `src/components/CameraBrowser.tsx`, `src/app/api/cameras/worldwide/route.ts`, `src/lib/cameras/` | Viewport-scoped OSM surveillance positions plus optional Windy webcams; rounded browser UI |
| Florida (FDOT) cameras | `src/app/api/cctv/fl511.ts`, `/api/cctv/fl511-live`, `/api/cctv/fl511-hls`, `CameraViewer.tsx` | Full FL511 camera list via the keyless list endpoint; click-to-play HLS in the first-party viewer (still first, then DIVAS stream via same-origin playlist proxy) |
| New York (NYSDOT) cameras | `src/app/api/cctv/ny511.ts` | Full 511NY camera list (same Castle Rock list endpoint as FL511); unauthenticated Skyline/skyvdn HLS played directly in the viewer — no token, no proxy |
| Subsea cables | `src/lib/submarine-cables.ts`, `src/app/api/cables/route.ts`, `SentraMap.tsx` (`cables-*` layers) | TeleGeography cable geometry with derived lifecycle status and animated traffic-flow overlay |
| API handlers | `src/app/api/<domain>/route.ts` | Request validation, route-local security, provider calls, response shaping |
| Provider normalization | `src/lib/` | Feed adapters and domain rules: flights, AIS, IPTV, cables, cameras, entity intel, AI, sanctions, SSRF |
| Runtime credential admin | `src/app/admin/providers/page.tsx`, `src/app/api/admin/`, `src/lib/provider-config.ts`, `src/lib/admin-guard.ts`, `src/lib/cache-registry.ts` | Keyless-but-guarded page to set provider API keys at runtime; loopback-only overlay merged over `process.env`, with cache invalidation |
| External entity ingress | `src/app/api/sdk/`, `src/lib/sdk/` | Authenticated ingest, in-memory entity store, SSE stream, adapter types |
| Runtime observability | `src/app/api/health/`, `src/app/api/provider-health/`, `src/lib/provider-health.ts` | Process liveness (real checks, can report degraded) and redacted configuration inventory |
| Analytics | `src/middleware.ts` | Optional Umami page-view/network events; APIs are excluded |
| Deployment | `Dockerfile`, `docker-compose.local.yml`, `docker-compose.yml`, `DOCKER.md` | Standalone image, local compose, full/CasaOS stack, environment mapping |
| Tests and checks | `scripts/test-*.mjs`, `package.json` | Static-contract and focused behavior checks invoked by `npm test` |

## API domains

The API tree is grouped by user-facing intelligence domain rather than a single controller. Major groups include `flights`, `aircraft`, `maritime`, `cctv`, `cameras/worldwide`, `cables`, `earthquakes`, `fires`, `weather`, `satellites`, `news`, `live-news`, `markets`, `frontlines`, `radar`, and `space-weather`; active investigation includes `osint`, `scanner`, `cyber-threats`, `malware`, `entity`, and `region-dossier`; platform boundaries include `ai`, `provider-health`, `health`, `admin` (provider credentials), `proxy-tiles`, `github-webhook`, and `sdk`.

When adding a route, update the consuming fetch in `page.tsx`, the corresponding map data key or panel, and provider health if configuration state is relevant. Add a focused script under `scripts/` when the behavior can be tested without live external services.

## Library anchors

- `src/lib/flight-providers.ts` is the canonical aviation logic: OpenSky is the primary global source and adsb.lol enriches it (type code, registration, military bit, nav accuracy) joined on ICAO hex; adsb.lol is also the full fallback when OpenSky is unconfigured or empty. `classifyByTypeCode` is shared by both paths.
- `src/lib/submarine-cables.ts` normalizes TeleGeography cable geometry and derives lifecycle status (`operational`/`under_construction`/`planned`); each record carries a `status_basis` distinguishing sourced fact from local inference.
- `src/lib/cameras/` holds the worldwide camera providers: `osm-surveillance.ts` (keyless Overpass positions, viewport-bounded), `windy-webcams.ts` (optional keyed watchable webcams), and shared `types.ts`.
- `src/lib/provider-config.ts` merges a gitignored `config/providers.local.json` overlay over `process.env`; call `getProviderEnv()` in routes instead of reading `process.env` directly so runtime-set keys take effect.
- `src/lib/admin-guard.ts` gates the provider-admin routes: disabled unless `ENABLE_PROVIDER_ADMIN=true`, loopback Host only, cross-origin refused, custom write header required.
- `src/lib/cache-registry.ts` lets credential-dependent modules register a reset so a key change clears warm caches/tokens.
- `src/lib/provider-health.ts` is the canonical inventory of configured, keyless, disabled, missing-optional, and planned providers, and the source of the admin surface's managed-key allowlist.
- `src/lib/ssrf-guard.ts` is the security boundary for active scanner target validation.
- `src/lib/ais.ts` normalizes AIS messages used by maritime live state.
- `src/lib/aircraft-intel.ts` and `src/lib/aircraft-photo.ts` support the aircraft entity workflow.
- `src/lib/ai-engine.ts` bounds and contextualizes feed data before Gemini analysis.
- `src/lib/sdk/` contains SDK-facing types and adapter/client code; read route handlers with these modules because the current state is process-local.
