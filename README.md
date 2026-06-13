<div align="center">

# ⬡ Sentra Mi8

### Open Source Intelligence & Reconnaissance Integrated System

[![Local Docker](https://img.shields.io/badge/localhost-3005-00E5FF?style=for-the-badge&logo=docker&logoColor=white)](http://localhost:3005)
[![Next.js](https://img.shields.io/badge/Next.js-16-black?style=for-the-badge&logo=next.js)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://typescriptlang.org)
[![MapLibre](https://img.shields.io/badge/MapLibre_GL-GPU_Rendered-396CB2?style=for-the-badge)](https://maplibre.org)
[![License](https://img.shields.io/badge/License-MIT-D4AF37?style=for-the-badge)](LICENSE)

**A real-time global intelligence dashboard that aggregates live flight tracking, CCTV networks, earthquake monitoring, conflict zone mapping, and 24/7 news feeds into a single GPU-accelerated interface.**

[Local Docker](http://localhost:3005) · [Report Bug](https://github.com/aidenmi8/sentra-Y/issues) · [Request Feature](https://github.com/aidenmi8/sentra-Y/issues)

</div>

---

## Overview

Sentra Mi8 is a production-grade OSINT platform that provides situational awareness across multiple intelligence domains. Built with Next.js 16 and MapLibre GL, every data point is rendered via WebGL for 60fps performance even with thousands of concurrent entities on-screen.

### Key Capabilities

| Domain | Data Points | Sources |
|--------|------------|---------|
| **Aviation** | Commercial, Private, Military, Jets | adsb.lol |
| **Maritime** | 39 Global Ports, 10 Chokepoints, optional live AIS | Static Naval Intel, aisstream.io |
| **CCTV** | 2,000+ Cameras | TfL, WSDOT, Caltrans, NYC DOT, VicRoads + more |
| **Seismic** | Real-time M2.5+ | USGS Earthquake API |
| **Fires** | Active Hotspots | NASA FIRMS |
| **News** | 24/7 Live Streams, IPTV Country Lists | Global Broadcasters, iptv-org |
| **Weather** | Severe Events | NASA EONET |
| **Space** | Solar Weather, Satellites | NOAA SWPC, public TLE feeds |
| **Cyber** | CVE Threats, Vulnerability Scanning | NVD, Custom Scanner |
| **Conflict** | 13 Active Zones | Static OSINT Intel |
| **Crypto** | BTC + ETH Wallet Tracing, OFAC SDN Match | blockstream.info, Blockscout, OpenSanctions |
| **Sanctions** | Person / Org / Vessel SDN Search | OpenSanctions (US OFAC SDN mirror) |
| **Telegram OSINT** | Geoparsed Posts from Public Channels | `t.me/s/<channel>` web preview |

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│                  Sentra Mi8 CLIENT                   │
│  ┌──────────┐  ┌──────────┐  ┌───────────────┐ │
│  │ MapLibre  │  │  HUD     │  │  RECON Toolkit│ │
│  │  GL (GPU) │  │ Panels   │  │  Port Scan    │ │
│  │  WebGL    │  │ Layers   │  │  DNS / WHOIS  │ │
│  │  Render   │  │ Controls │  │  Vuln Scanner │ │
│  └──────────┘  └──────────┘  └───────────────┘ │
├─────────────────────────────────────────────────┤
│               NEXT.JS API ROUTES                 │
│  /api/flights         /api/earthquakes          │
│  /api/cctv            /api/news                 │
│  /api/fires           /api/maritime             │
│  /api/gdelt           /api/satellites           │
│  /api/weather         /api/scanner              │
│  /api/provider-health /api/iptv/*               │
│  /api/sentinel        /api/sdk/*                │
│  /api/osint/*  (whois, dns, ip, cve, sanctions, │
│                 crypto, sweep, threats, …)      │
├─────────────────────────────────────────────────┤
│              EXTERNAL DATA SOURCES               │
│  adsb.lol · USGS · NASA · NOAA · TfL · NVD     │
│  GDACS · EONET · FIRMS · RSS Feeds · iptv-org  │
│  blockstream.info · Blockscout · OpenSanctions  │
│  t.me public previews                            │
└─────────────────────────────────────────────────┘
```

---

## Features

### Intelligence Layers
- **16 toggleable data layers** with real-time entity counts
- **GPU-accelerated rendering** — all map data rendered via WebGL, not DOM
- **Progressive loading** — data fetched on-demand when layers are activated
- **Viewport-aware** — only loads relevant data for the visible region

### RECON Toolkit
- **Port Scanner** — TCP connect scan with service fingerprinting
- **DNS Lookup** — Full record resolution (A, AAAA, MX, NS, TXT, CNAME)
- **WHOIS** — Domain/IP registration data (auto-cross-checked against OFAC SDN)
- **SSL/TLS Inspector** — Certificate chain analysis
- **IP Intelligence** — Geolocation, ASN, threat reputation (auto-cross-checked against OFAC SDN)
- **Vulnerability Scanner** — CVE lookup against NVD database
- **Crypto Wallet Trace** — BTC + ETH lookup (balance, tx history, OFAC SDN sanctions flag)
- **OFAC Sanctions Search** — query persons, organizations, vessels and aircraft against the US OFAC SDN list

### Live Broadcast Network
- **25+ live 24/7 news streams** from global broadcasters
- Click any news dot on the map to open the live stream
- Feeds from NBC, CBS, ABC, Sky News, Al Jazeera, France 24, NHK, WION, and more
- **IPTV country lists** from [iptv-org](https://github.com/iptv-org/iptv), searchable by country with manual selected-country refresh
- Sentra Mi8 links to public IPTV streams directly; it does not host or proxy video

### Telegram OSINT Layer
- **Public-channel feed** scraped from the unauthenticated `t.me/s/<channel>` web preview — no Bot API token, no MTProto
- Default curated set of 4 public channels, overridable via `SENTRA_MI8_TELEGRAM_CHANNELS`
- Posts are geoparsed against a multilingual place dictionary (EN + Cyrillic + Arabic) and plotted on the map
- Click any cyan dot to read the post and jump to the original on Telegram

### Crypto Wallet Intelligence
- **BTC** lookups via [blockstream.info](https://blockstream.info) (Esplora API, keyless)
- **ETH** lookups via [Blockscout](https://github.com/blockscout/blockscout)'s public ETH instance (`eth.blockscout.com`, keyless)
- Every lookup is cross-checked against the OFAC SDN sanctioned-address list (mirrored from [`0xB10C/ofac-sanctioned-digital-currency-addresses`](https://github.com/0xB10C/ofac-sanctioned-digital-currency-addresses))
- Sanctioned wallets surface a red **SANCTIONED — OFAC SDN** badge in the RECON panel

### OFAC SDN Cross-Check
- Standalone `SANCTIONS` tab in the RECON toolkit — full-text search across persons, organisations, vessels and aircraft
- WHOIS and IP-intel routes auto-cross-check registrant / ASN-owner names against the SDN list and surface an inline alert
- Data sourced from [OpenSanctions](https://www.opensanctions.org) (CC-BY 4.0) — keyless, ~7 MB cached in-memory for 24h

### Conflict Zone Monitoring
- **13 active conflict/tension zones** with severity-coded warning markers
- Active Wars: Ukraine, Gaza, Sudan, Myanmar, DRC, Yemen
- High Tension: Syria, Lebanon, Sahel, Somalia, Red Sea
- Elevated: Taiwan Strait, Korean DMZ

### Performance Optimized
- **75% reduction in edge requests** vs initial release
- Aggressive polling relaxation (15-30 min intervals for stable data)
- Static data served from memory (zero external API calls for news feeds)
- `layerFetchedRef` prevents duplicate API requests

---

## Quick Start

```bash
git clone https://github.com/aidenmi8/sentra-Y.git
cd sentra-Y
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

### Docker / Self-Hosting

For a laptop-local build that does not depend on the full CasaOS stack, use the
single-container compose file:

```bash
git clone https://github.com/aidenmi8/sentra-Y.git
cd sentra-Y
cp .env.template .env     # optional — configure keys / scanner backend
docker compose -f docker-compose.local.yml up -d --build
curl -fsS http://localhost:3005/api/health
curl -fsS http://localhost:3005/api/provider-health
```

Open [http://localhost:3005](http://localhost:3005). The local container is
named `sentra-mi8-local` and the image is tagged `sentra-mi8:local`.
To use another host port, set `LOCAL_SENTRA_MI8_PORT`, for example:

```bash
LOCAL_SENTRA_MI8_PORT=3010 docker compose -f docker-compose.local.yml up -d --build
```

The default `docker-compose.yml` is still available for the broader
self-hosting/CasaOS stack.

```bash
git clone https://github.com/aidenmi8/sentra-Y.git
cd sentra-Y
cp .env.template .env     # optional — configure keys / port
docker compose up -d
```

Open [http://localhost:3000](http://localhost:3000). The image is a multi-stage
`node:22-alpine` standalone build (~220 MB, non-root). The compose file also
carries CasaOS app metadata (`x-casaos:`) for one-click install on
[CasaOS](https://casaos.io). See **[DOCKER.md](DOCKER.md)** for the full Docker,
CasaOS and API-key guide.

**Plain Docker image** — build the same standalone image without Compose:

```bash
docker build -t sentra-mi8:latest .
docker run -d --name sentra-mi8 -p 3000:3000 --env-file .env --restart unless-stopped sentra-mi8:latest
```

**Custom port** — the container always listens on `3000`; set `SENTRA_MI8_PORT` in
`.env` to change the published host port (e.g. `SENTRA_MI8_PORT=3005`) without
editing the compose file.

### Environment Variables

Sentra Mi8 runs its core feeds without third-party API keys. Copy
[`.env.template`](.env.template) to `.env` and set only what you need:

```env
# Published host port (container always listens on 3000). Default: 3000
SENTRA_MI8_PORT=3000

# AI analyst / briefing
GEMINI_API_KEY_1=

# RECON scanner backend
SCANNER_URL=
SCANNER_KEY=

# Live maritime AIS
AIS_API_KEY=

# Optional write/webhook/analytics integrations
SDK_INGEST_KEY=
GITHUB_WEBHOOK_SECRET=
GITHUB_WEBHOOK_FORWARD_URL=
UMAMI_ENDPOINT=
UMAMI_WEBSITE_ID=

# Optional runtime/feed overrides
SENTRA_MI8_INTEL_URL=
SENTRA_MI8_TELEGRAM_CHANNELS=OSINTtechnical,Faytuks,Liveuamap,CyberKnow
IPTV_ORG_BASE_URL=
```

Use `curl http://localhost:3005/api/provider-health` to see redacted runtime
configuration status. OpenSky, N2YO, and keyed FIRMS variables are documented in
`DOCKER.md` as planned/reserved adapters; the current routes do not consume
them yet. `.env` is gitignored — only the template is committed.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router, Turbopack) |
| Language | TypeScript 5 |
| Map Engine | MapLibre GL JS (WebGL) |
| Animations | Framer Motion |
| Icons | Lucide React |
| Styling | Custom CSS Design System |
| Deployment | Vercel Edge Network |

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `F` | Toggle flight layers |
| `E` | Toggle earthquakes |
| `S` | Toggle satellites |
| `D` | Toggle day/night cycle |
| `Escape` | Close panels |

---

## License

MIT — see [LICENSE](LICENSE) for details.

---

<div align="center">

**Sentra Mi8**

Local-first OSINT dashboard for authorized intelligence and reconnaissance workflows.

</div>
