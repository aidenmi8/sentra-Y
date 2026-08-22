---
type: Integration Reference
title: Provider Integrations and Configuration
description: Documents keyless and optional provider boundaries, environment-variable ownership, fallback behavior, and the redacted runtime health inventory.
tags: [integrations, providers, configuration, environment]
---

# Provider integrations

`src/lib/provider-health.ts` is the canonical runtime inventory. It classifies providers as `configured`, `keyless`, `disabled`, `missing_optional`, or `planned`, lists owning routes and environment-variable names, and never returns secret values. `/api/provider-health` is dynamic and sends `Cache-Control: no-store`.

## Configuration groups

| Group | Variables | Behavior |
|---|---|---|
| Public feeds | none | Aviation, subsea cables, worldwide camera positions, satellites, earthquakes, fires, weather, news, GDELT, and markets work from public sources. |
| Aviation | `OPENSKY_CLIENT_ID`, `OPENSKY_CLIENT_SECRET` | OpenSky OAuth is the primary global source and is enriched by keyless adsb.lol (type, registration, military bit, nav accuracy); adsb.lol is also the full fallback when OpenSky is unconfigured, empty, or rate-limited. |
| Subsea cables | none (`SUBMARINE_CABLE_BASE_URL` overridable) | Keyless TeleGeography cable geometry and lifecycle status. |
| Worldwide cameras | `WINDY_API_KEY` (optional), `OVERPASS_ENDPOINT` (overridable) | OpenStreetMap surveillance positions are keyless (viewport-bounded); Windy adds watchable webcams when a key is set. |
| AI | `GEMINI_API_KEY_1` through `_8` | Enables server-side Gemini rotation for analyze and briefing routes; the UI can also supply a key according to the route contract. |
| Maritime | `AIS_API_KEY` | Enables live AISStream WebSocket data; static maritime intelligence remains available without it. |
| RECON scanner | `SCANNER_URL`, `SCANNER_KEY` | Enables the scanner proxy. Both are required; missing configuration yields a controlled unavailable response. |
| SDK ingest | `SDK_INGEST_KEY` | Authenticates external writes to `/api/sdk/ingest`; the stream route exposes process-local entities. |
| Webhook bridge | `GITHUB_WEBHOOK_SECRET`, `GITHUB_WEBHOOK_FORWARD_URL` | Enables HMAC-verified GitHub webhook forwarding. |
| Analytics | `UMAMI_ENDPOINT`, `UMAMI_WEBSITE_ID` | Enables middleware page-view and network events; both are required. |
| Provider admin | `ENABLE_PROVIDER_ADMIN` | Off by default. When `true`, exposes the loopback-only runtime credential admin (see below). |
| Optional services | `SENTRA_MI8_INTEL_URL`, Telegram and IPTV overrides | Selects an intel service or public preview/channel sources. |

Use `.env.template` and `DOCKER.md` for setup descriptions. Do not document or copy values from `.env`.

## Runtime credential administration

Keys can also be set at runtime instead of only through the environment. `src/lib/provider-config.ts` reads a gitignored `config/providers.local.json` overlay and merges it over `process.env`; routes call `getProviderEnv()` so an updated key takes effect without a restart. The writable set is derived from the provider-health inventory, so arbitrary process variables (for example `PATH`) cannot be set, and a successful write clears credential-dependent caches through `src/lib/cache-registry.ts`.

The admin surface (`/admin/providers`, `/api/admin/providers`) carries no password by design and is protected instead by `src/lib/admin-guard.ts`: it is disabled unless `ENABLE_PROVIDER_ADMIN=true`, refuses any request whose `Host` is not a loopback address (the DNS-rebinding defence), refuses cross-origin requests, and requires a custom `x-sentra-admin` header on writes. Reads report only whether a key is set and where it came from — never the value. `/api/admin/status` returns whether the surface is reachable so the client can decide whether to show the link.

## Fallback and planned-provider semantics

A provider being `keyless` means the route is intended to work without credentials, not that the upstream is guaranteed available. Aviation merges OpenSky (coverage) with adsb.lol (identity) and degrades to adsb.lol alone; maritime falls back to static/cached state when AIS is absent; worldwide cameras serve OpenStreetMap positions when Windy is unconfigured; entity expansion can use local fallback data when its optional intel service is unavailable. `planned` entries such as keyed N2YO satellite passes and keyed FIRMS are inventory markers, not active integrations.

Two provider distinctions are worth internalizing. First, OpenStreetMap camera records are camera *positions*, not viewable feeds (a `kind` field marks each), so the UI must not present them as watchable. Second, Florida FDOT cameras (`src/app/api/cctv/fl511.ts`) come from FL511's keyless list endpoint as still snapshots; their HLS is on DIVAS and origin-locked to `fl511.com`. The first-party player mints a token through `/api/cctv/fl511-live` and plays via `/api/cctv/fl511-hls` so the browser never sends our Origin to DIVAS.

The [data-loading workflows](../workflows/data-loading.md) explain how provider selection and route caches affect freshness. The [operations runbook](../operations/runbook.md) explains how to inspect the redacted inventory.

## Security boundaries

Provider configuration does not replace request security:

- Scanner requests pass through `src/lib/ssrf-guard.ts`, which blocks private/reserved destinations, validates resolved addresses, and re-checks redirects; the scanner route also validates scan types and rate-limits clients.
- OSINT routes validate inputs and apply their own in-memory rate limits. API middleware does not protect them because `/api` is excluded from `src/middleware.ts`.
- SDK ingest requires the shared key in the request body. The stream route is read-only at the route level and currently exposes stored entities without equivalent authentication.
- GitHub webhook forwarding verifies `x-hub-signature-256` with timing-safe comparison before forwarding.
- Umami middleware includes an IP-derived network event when configured. Treat that as a privacy-sensitive deployment choice.

These controls are per process or isolate where implemented in memory. They are not a substitute for a shared rate-limit store or network policy in a multi-replica deployment.
