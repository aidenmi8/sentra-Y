<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Working economically in this repo

This project has burned through a monthly spend cap before. Default to doing work
inline; delegation and fan-out are the expensive paths and need to earn their cost.

**Read narrowly.** Several files here are large enough that reading one whole is a
material fraction of a context window: `src/components/SentraMap.tsx` (~1,500
lines), `src/app/globals.css` (~2,400), `src/app/page.tsx` (~1,300),
`src/components/OsintPanel.tsx` (~1,000). Grep for the symbol, then `Read` with
`offset`/`limit`. `openwiki/source-map.md` maps concerns to owning files — start
there instead of sweeping the tree.

**Prefer inline work to subagents.** Spawn one only when the task is genuinely
parallel or the file set is unknown. For "where does X live" or "does Y exist",
use the `repo-scout` agent (Haiku, read-only); for "is this feed alive and what
does it return", use `provider-probe` (Haiku). Both are far cheaper than a
general-purpose agent and are defined in `.claude/agents/`.

**Keep workflows small.** `.claude/settings.json` sets `workflowSizeGuideline` to
`small` (under 5 agents). A verification fan-out that spawns one agent per finding
is the single most expensive thing you can do here — cap it, or verify inline.
Do not raise this without being asked.

**Measure once, reuse.** Live probes against OpenSky, adsb.lol, Overpass and
aisstream cost seconds and upstream goodwill. Record the numbers in your reply so
the next step builds on them instead of re-probing.

<!-- OPENWIKI:START -->

## OpenWiki

This repository uses OpenWiki for recurring code documentation. Start with `openwiki/quickstart.md`, then follow its links to architecture, workflows, domain concepts, operations, integrations, testing guidance, and source maps.

The scheduled OpenWiki GitHub Actions workflow refreshes the repository wiki. Do not hand-edit generated OpenWiki pages unless explicitly asked; prefer updating source code/docs and letting OpenWiki regenerate.

<!-- OPENWIKI:END -->
