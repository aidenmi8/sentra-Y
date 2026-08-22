---
type: Repository Guide
title: Sentra Mi8 Code Wiki Quickstart
description: Entry point for engineers and future agents working on Sentra Mi8, a Next.js and MapLibre OSINT dashboard with progressive data feeds, intelligence tools, and optional integrations.
tags: [sentra-mi8, quickstart, osint, nextjs]
---

# Sentra Mi8 Code Wiki

Sentra Mi8 is a browser-based open-source intelligence dashboard. The main client combines a MapLibre/WebGL world map with HUD panels for aviation, maritime, CCTV, news, incidents, weather, space, cyber, sanctions, crypto, and reconnaissance. Next.js route handlers normalize public and optional provider data for the client; most core feeds are designed to work without API keys (`README.md`, `src/lib/provider-health.ts`).

## Start here

For the system boundary and UI ownership, read the [architecture overview](architecture/overview.md). For where to edit a feature, use the [source map](source-map.md). The [data-loading workflows](workflows/data-loading.md) explain progressive layer fetches, normalization, caching, and the representative aviation path. Domain behavior is summarized in [intelligence surface](domains/intelligence-surface.md), while [provider integrations](integrations/providers.md) lists configuration and fallback semantics.

For local deployment, follow the [operations runbook](operations/runbook.md). Before opening a pull request, use [testing guidance](testing/guidance.md).

## Local development

```bash
npm install
npm run dev
```

The development server is normally available at `http://localhost:3000`. The recommended laptop-local container publishes the app at port `3005` while the container listens on `3000`:

```bash
cp .env.template .env
docker compose -f docker-compose.local.yml up -d --build
curl -fsS http://localhost:3005/api/health
curl -fsS http://localhost:3005/api/provider-health
```

The core feed path is keyless. Add only the optional variables needed for AI, live AIS, RECON scanning, SDK ingest, webhook forwarding, analytics, or provider overrides. Never commit `.env`; use `.env.template`, `DOCKER.md`, and the redacted `/api/provider-health` response as the configuration references.

## Current shape and recent direction

The client shell in `src/app/page.tsx` owns URL-serialized map state, active layers, polling, panels, entity clicks, and global status. `src/components/SentraMap.tsx` owns the browser-only MapLibre instance and GeoJSON sources. API routes under `src/app/api` validate requests, call provider libraries in `src/lib`, and return client-oriented JSON. The latest committed feature (`db01742`, aircraft live intel) deepened entity-level workflows; the preceding foundation commit (`bae9f8f`) standardized the Sentra Mi8 product, local Docker path, provider health, AIS/IPTV/SDK support, and broad route structure.

## Engineering watch-outs

- Several caches, rate limiters, AIS state, and SDK entities are process-local. They reset on restart and do not coordinate across replicas.
- `/api/health` reports process health and representative endpoints; `/api/provider-health` reports configuration state, not live dependency latency.
- Middleware excludes API routes and is primarily Umami analytics. Route-specific validation, rate limiting, SSRF checks, and authentication must be reviewed at the route being changed.
- The repository uses script-based tests rather than a conventional unit-test framework, run via `npm test` (see [testing guidance](testing/guidance.md)).
- The runtime is Next.js 16 (`package.json` pins `next` accordingly, and `next.config.ts` is used); an accidental downgrade of that range will break the App Router build, so verify the lockfile before changing dependency ranges.
- Provider credentials can be set at runtime through `/admin/providers` (loopback-only, off unless `ENABLE_PROVIDER_ADMIN=true`) in addition to the environment; see [provider integrations](integrations/providers.md).

## Backlog

- Route-by-route API ownership and response schemas — anchor: `src/app/api/`; deferred because the surface is broad and this first pass documents representative patterns rather than every route.
- Complete domain catalog and provider provenance/freshness — anchor: `src/lib/` and `src/app/api/`; deferred to keep the initial wiki navigable while preserving the major domains in the intelligence page.
- Multi-instance deployment and privacy runbook — anchors: `src/middleware.ts`, process-local caches, and Docker/Next runtime; deferred because the source exposes caveats but no tested distributed deployment contract.
