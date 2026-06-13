# Self-Hosting Sentra Mi8 with Docker

Sentra Mi8 ships as a self-contained Next.js standalone build. This guide covers
running it with Docker / Docker Compose, deploying it as a [CasaOS](https://casaos.io)
app, and configuring the optional API keys.

> **TL;DR:** Sentra Mi8 runs fully **without any API keys**. All core feeds
> (aviation, satellites, fires, earthquakes, weather, news, CVEs) use public
> keyless sources. Keys only matter for optional AI, live AIS, RECON, SDK ingest,
> webhook forwarding, analytics, or source overrides.

---

## 1. Laptop-local Docker Compose (recommended for development)

Use `docker-compose.local.yml` when you want to build this checkout and run the
Next.js app locally without the auxiliary nginx cache, intel service, or
external networks used by the full self-hosting stack.

```bash
git clone https://github.com/aidenmi8/sentra-Y.git
cd sentra-Y

# optional: configure keys / scanner backend
cp .env.template .env        # then edit .env

docker compose -f docker-compose.local.yml up -d --build
curl -fsS http://localhost:3005/api/health
curl -fsS http://localhost:3005/api/provider-health
```

Open <http://localhost:3005>.

What the local compose file does:

- **`image: sentra-mi8:local`** — tags the image built from this checkout.
- **`container_name: sentra-mi8-local`** — avoids colliding with another local
  dashboard container.
- **`ports: ${LOCAL_SENTRA_MI8_PORT:-${LOCAL_OSIRIS_PORT:-3005}}:3000`** —
  publishes the app on host port
  `3005` by default while the container continues listening on `3000`.
- **`env_file: .env` (`required: false`)** — if `.env` exists, values are
  injected into the container; if it is missing, Sentra Mi8 still starts with the
  keyless feeds.

Use another host port by setting `LOCAL_SENTRA_MI8_PORT`:

```bash
LOCAL_SENTRA_MI8_PORT=3010 docker compose -f docker-compose.local.yml up -d --build
curl -fsS http://localhost:3010/api/health
curl -fsS http://localhost:3010/api/provider-health
```

Deprecated compatibility alias: `LOCAL_OSIRIS_PORT`.

Common local commands:

```bash
docker compose -f docker-compose.local.yml build sentra-mi8
docker compose -f docker-compose.local.yml up -d
docker compose -f docker-compose.local.yml logs -f
docker compose -f docker-compose.local.yml down
```

## 2. Full Docker Compose / CasaOS stack

```bash
git clone https://github.com/aidenmi8/sentra-Y.git
cd sentra-Y

# optional: configure keys / scanner backend
cp .env.template .env        # then edit .env

docker compose up -d
```

Open <http://localhost:3000>.

This path uses the repository's default `docker-compose.yml`. It is intended
for broader self-hosting and CasaOS-style deployments, and includes the app,
nginx tile cache, intel service, and an external `umami_default` network. For a
first local laptop run, prefer `docker-compose.local.yml` above.

What the compose file does:

- **`image:` + `build:`** — tags the local image as `sentra-mi8:latest` and
  builds from this checkout's `Dockerfile`.
- **`env_file: .env` (`required: false`)** — if a `.env` file exists its
  values are injected into the container; if it's missing, Sentra Mi8 still starts
  with the keyless feeds.
- **`ports: ${SENTRA_MI8_PORT:-${OSIRIS_PORT:-3000}}:3000`** — the web UI. The container always
  listens on 3000; the published **host** port is `SENTRA_MI8_PORT` (default
  `3000`). Set `SENTRA_MI8_PORT` in `.env` to remap it, e.g. `SENTRA_MI8_PORT=3005`
  when 3000 is already in use — no need to edit the compose file.
- **`restart: unless-stopped`** — survives reboots.

Common commands:

```bash
docker compose logs -f          # follow logs
docker compose up -d --build    # rebuild locally after pulling new code
docker compose down             # stop & remove
```

### Plain `docker run`

```bash
docker build -t sentra-mi8:latest .
docker run -d --name sentra-mi8 -p 3000:3000 --env-file .env --restart unless-stopped sentra-mi8:latest
```

### Image details

Multi-stage build on `node:22-alpine`, runs as a non-root user (`nextjs`,
uid 1001), serves Next.js standalone via `node server.js` on port 3000.
Final image is ~220 MB. Build excludes `node_modules`, `.next`, `.git` and the
repo's large `*.diff` artifacts via `.dockerignore`.

---

## 3. CasaOS

The compose file includes an `x-casaos:` metadata block (title, description,
icon, port map, env descriptions) that plain Docker Compose ignores but CasaOS
reads.

**Install:**

1. On the CasaOS host, clone the repo somewhere persistent (e.g.
   `/DATA/AppData/sentra-mi8`).
2. CasaOS dashboard → **`+`** → **Install a customized app** → paste the
   contents of `docker-compose.yml`.
   *(or simply run `docker compose up -d` from the cloned directory).*
3. Sentra Mi8 appears on the dashboard with its icon, reachable on host port
   `3000` (or whatever `SENTRA_MI8_PORT` you set in `.env`).

The app icon is the Sentra Mi8 tactical SM8 mark in
`public/casaos-icon.png` (512×512 PNG), referenced by the `icon:` URL in the
metadata.

> CasaOS stores imported compose files under `/var/lib/casaos/apps/`, so a
> relative `build:` context may not resolve there. If importing the YAML
> directly, build/tag `sentra-mi8:latest` first:
> `docker build -t sentra-mi8:latest /path/to/sentra-Y`.

---

## 4. API keys & data sources

Copy `.env.template` to `.env` and fill in only what you need.

### Active provider variables

Use `/api/provider-health` to inspect these at runtime. The response is
redacted: it shows configured/missing/keyless/planned state, never secret
values or resolved private URLs.

| Variable | Purpose | Required for |
|----------|---------|--------------|
| `GEMINI_API_KEY_1` ... `GEMINI_API_KEY_8` | Gemini key rotation | AI analyst and briefing routes |
| `AIS_API_KEY` | aisstream.io WebSocket key | Live AIS vessel updates in `/api/maritime` |
| `SCANNER_URL` | RECON scanner backend base URL | RECON toolkit |
| `SCANNER_KEY` | Shared secret; **must equal the backend's `SENTRA_MI8_KEY`** | RECON toolkit |
| `SDK_INGEST_KEY` | Shared write key | `/api/sdk/ingest` writes |
| `GITHUB_WEBHOOK_SECRET` | GitHub webhook HMAC secret | `/api/github-webhook` signature validation |
| `GITHUB_WEBHOOK_FORWARD_URL` | Internal bridge endpoint | `/api/github-webhook` forwarding |
| `UMAMI_ENDPOINT` | Umami `/api/send` endpoint | Optional analytics middleware |
| `UMAMI_WEBSITE_ID` | Umami site id | Optional analytics middleware |
| `SENTRA_MI8_INTEL_URL` | Intel service override | `/api/entity/expand` |
| `SENTRA_MI8_TELEGRAM_CHANNELS` | Public Telegram preview channel list | `/api/news` |
| `IPTV_ORG_BASE_URL` | IPTV-org-compatible source override | `/api/iptv/*` |

Without `SCANNER_URL`/`SCANNER_KEY` the RECON endpoints return `503` and the
rest of Sentra Mi8 works normally. Without `SDK_INGEST_KEY`, SDK ingest rejects
writes with `503`. Without both GitHub webhook variables, webhook forwarding is
disabled with `503`. Without both Umami variables, analytics middleware makes no
network calls.

Generate shared secrets with `openssl rand -hex 32`. Deprecated compatibility
aliases remain where needed: backend `OSIRIS_KEY`, `OSIRIS_INTEL_URL`, and
`OSIRIS_TELEGRAM_CHANNELS`.

### Planned / reserved keys

These are documented for completeness and forward-compatibility. The current
data routes use **keyless** public feeds for these capabilities, so these are
reported as `planned` by `/api/provider-health` and are not consumed yet.

| Variable | Service | How to get it (all free) |
|----------|---------|--------------------------|
| `FIRMS_API_KEY` | NASA FIRMS active fires | Enter an email at <https://firms.modaps.eosdis.nasa.gov/api/map_key/> — the `MAP_KEY` is emailed instantly. Limit 5000 req / 10 min. |
| `OPENSKY_CLIENT_ID` / `OPENSKY_CLIENT_SECRET` | OpenSky aviation | Create an account at <https://opensky-network.org/>, open **Account → API client**, create a client and copy id/secret. **OAuth2 only since March 2025** (username/password auth removed). |
| `N2YO_API_KEY` | N2YO satellites | Register at <https://www.n2yo.com/login/register/>, then **Profile → generate API key**. Limit 1000 req / hour; key can't be regenerated. |

> Keep `.env` out of version control — it is already in `.gitignore`. Only
> `.env.template` (no secrets) is committed.

### Optional runtime overrides

| Variable | Purpose | Default |
|----------|---------|---------|
| `SENTRA_MI8_TELEGRAM_CHANNELS` | Comma-separated list of public Telegram channel usernames (no `@`) to scrape for the **Telegram OSINT** map layer. Overrides the curated default set. | `OSINTtechnical,Faytuks,Liveuamap,CyberKnow` |
| `IPTV_ORG_BASE_URL` | Optional override for the IPTV-org country playlist/API source. Sentra Mi8 links to streams directly and does not proxy video. | `https://iptv-org.github.io` |
| `SENTRA_MI8_PORT` | Host port the compose file publishes (container itself always listens on 3000). | `3000` |
| `LOCAL_SENTRA_MI8_PORT` | Host port published by `docker-compose.local.yml` for laptop-local runs. | `3005` |

Deprecated compatibility aliases: `OSIRIS_TELEGRAM_CHANNELS`, `OSIRIS_PORT`,
and `LOCAL_OSIRIS_PORT`.

### Keyless sources (no configuration needed)

Aviation → `adsb.lol` · Satellites → `celestrak.org` (TLE) · Fires →
NASA FIRMS open-data CSV · Earthquakes → USGS · Weather → NASA EONET · Space
weather → NOAA SWPC · CVEs → NVD · News → public RSS / HLS streams · CCTV →
public traffic-authority feeds · Crypto (BTC) → `blockstream.info` · Crypto
(ETH) → `eth.blockscout.com` ([Blockscout](https://github.com/blockscout/blockscout)
open-source explorer) · IPTV country playlists → [iptv-org](https://github.com/iptv-org/iptv)
public M3U lists · OFAC SDN sanctions → [OpenSanctions](https://www.opensanctions.org)
mirror (CC-BY 4.0) · Telegram OSINT → public `t.me/s/<channel>` web preview.
