# SqueekCity: The Wheel Life

A playable isometric hamster city for **Squeekchain Genesis Code**. Twelve hamsters (growing to at most fifteen) live on their own: they wake, commute, run wheels at the Wheel Corporation, eat, shop, socialise, shelter from rain and sleep. Their wheel running produces fictional **Wheel Energy (WE)**, which you spend on upgrades. A fresh reading from the real Squeekchain wheel adds a capped power surge.

WE is an in-game resource only. It is **not SQK** and has no value outside the game.

- Stack: Vite 6, React 18, TypeScript 5, viem 2 (wallet only). Canvas 2D renderer, no game engine.
- Static export in `dist/`, with relative asset URLs (`base: "./"`), one page, no server.
- Live URL: IMD publishes the committed `dist/` after the job (the brief prefers `squeekcity.imd.site`). This repository doesn't publish, buy domains or set up DNS.

## Install, preview, rebuild

```bash
npm install          # uses package-lock.json
npm run dev          # local dev server with hot reload
npm run build        # tsc --noEmit, then vite build into dist/
npm run preview      # serve the built dist/ locally
npm test             # vitest: simulation + API parser tests
npm run typecheck    # tsc --noEmit
```

`dist/` is committed on purpose: the host serves it as-is and does not rebuild. After any source change, run `npm run build` and commit `dist/` together with the source.

## What is in the game

| Area | What it does |
| --- | --- |
| City view | The full isometric map with day/night lighting, weather, street lamps and animated citizens. Drag to pan, scroll or pinch to zoom, or use the + / − buttons. Use the yellow "Enter …" buttons, or tap a building, to open a district. |
| Residential | Six homes, a commons kitchen, the neighbour garden and two building lots. Family dinners, neighbour visits, sleeping and eating at home. |
| Wheel Corporation | HQ, Wheel Hall A and B (7 wheels each, animated runners), Battery Depot. Shift stats, team efficiency, employee leaderboard. |
| Downtown | Sunflower Cafe, Cheese Bistro, Pip's Market, Clover Park (festival ground), Tunnel Arcade and **Squeek Live Studio**, which opens https://sepolia.squeekchain.com/ in a new tab. |
| Buildings | Every building has an activity that changes behaviour or needs (for example family dinner, dinner bell, sunflower snacks, team meeting, umbrella sale, picnic, screening party) and an upgrade with a visible change. |
| Citizens | Tap a hamster on the map or in the Citizens tab for its profile: age, personality, home, family, friends, needs, schedule, job, WE today and lifetime, productivity, skills, work history and promotion progress. |
| Careers | Intern → Employee → Senior → Team Leader → Manager → Director → CEO. Reviews run at 20:00 each game day. Each step needs XP and a 3-day average output. Leadership seats are limited (Team Leader 2, +1 per HQ level; Manager 1, 2 at HQ level 3; Director 1; CEO 1). Leaders on shift raise team efficiency (capped at ×1.35). |
| Economy | Wheels generate WE. Homes and facilities use it, and lights use more at night. Storage is capped by the Battery Depot and never goes negative. An empty store causes a brownout: dim lights and lower moods. The city grows on its own: the council builds on a free lot and new hamsters move in when mood, WE and housing allow. Population is capped at 15. |
| God mode | Sun, Rain, Festival (300 WE), Plant trees (120 WE), Pause, 1x and 2x. Each one changes behaviour, mood or resources. You never control a citizen directly. |
| Real wheel | Polls `https://api.squeekchain.com/v1/status` every 15 s and `/v1/events?category=measurement` every 60 s. See below. |
| Wallet | Optional EVM connection on Ethereum Sepolia (11155111): EIP-6963 discovery (MetaMask, Rabby, OKX and any other announcing wallet), a legacy `window.ethereum` fallback, and "Open in" links on phones. Shows the address, offers Disconnect and asks before switching networks. It never requests a payment, approval or signature. |
| Save | IndexedDB in this browser only: autosaves every 15 s and when the tab is hidden, plus a "Save now" button. Saves don't sync across devices or browsers, and the panel says so. "New city" deletes the save after you confirm. |

## Squeekchain integration

Schemas were checked against the live API and https://docs.squeekchain.com/developers/api/ on 2026-11-06 (`/v1/status` schemaVersion 1, `/v1/events` schemaVersion 4). Parsing lives in `src/api/squeek.ts`.

- RPM = `measurement.rpmMilli / 1000`. The panel also shows speed, day distance, `coreStatus`, wheel module state, `provenance`, `freshness`, `observedAt` and `receivedAt`.
- Labels: *Live hardware*, *Live, wheel idle*, *Stale* (the API says stale, or `receivedAt` is older than `staleAfterSeconds` on this device's clock), *Simulated*, *Replayed*, *Derived*, and *Unavailable* (network error, HTTP error, unknown schema, `measurement: null`, `COUNTER_FAULT`). Unknown values show as "Unknown", never as zero.
- Bonus: only for fresh `provenance: "hardware"` readings with `coreStatus: "ACTIVE"` and RPM > 0. The bonus is RPM × 0.3, capped at 25 WE per reading and 300 WE per real hour. Each reading is keyed by `counterEpoch:observedAt` and credited once. A bonus triggers a visible power surge (glowing halls and battery, faster wheels).
- Milestones: only accepted `measurement.*` events go into the City Chronicle, deduplicated by event `id`. Each one pays 150 WE once, and only if it happened after this city was founded. Older milestones are recorded with "no bonus".
- If the API is down, the city keeps running on its own wheels.

## Source map

- `src/sim/engine.ts`: clock, needs, hamster state machine (`decide`), road pathfinding (BFS), economy, careers, growth, god mode, capped API crediting
- `src/sim/world.ts`: map, roads, buildings, citizens
- `src/sim/actions.ts`: building activities and upgrade descriptions
- `src/render/render.ts`: isometric pixel renderer (half-resolution canvas scaled ×2 with `image-rendering: pixelated`)
- `src/api/squeek.ts`: Squeekchain client and parsers
- `src/wallet/wallet.ts`, `src/ui/WalletControl.tsx`: viem + EIP-1193/EIP-6963 wallet
- `src/save.ts`: IndexedDB persistence
- `src/App.tsx`, `src/ui/Panels.tsx`, `src/styles.css`: interface

## Validation (worker-side, 2026-11-06)

Full record in `artifacts/validation.md`. Summary:

- `npm run build` (tsc + vite): passed. `npx tsc --noEmit`: passed.
- `npx vitest run`: 13/13 passed. Covers routines (sleep, walk, work, eat), WE bounds, promotions and seat limits, rain sheltering, upgrade cost and refusal, festival and trees, the population cap, bonus caps and dedupe, and API parsing for live, idle, stale, simulated, replay, fault and unavailable.
- Playwright (Chromium) against the built `dist/` served under a subpath, at 1440×900 and 390×844: 34/34 checks passed. These covered district entry, Back to City, building upgrade, leaderboard, Live Studio link, rain, trees, pause, hamster profile, wallet sheet and Escape, a save that survives reload, and the live API. The status label read "Live, wheel idle" because the real wheel was idle. There were no console errors.
- Design probe `taste.mjs`: 16/16 at 320, 390 and 1440.

**Limitations:**
- Not tested: a real wallet connection (no wallet extension in the test browser), a WebKit/Safari run (that browser build isn't installed here), a physical phone and a screen reader.
- A WE bonus from a live ACTIVE reading wasn't seen end to end, because the real wheel was idle during testing. The unit tests cover that path.
- Hamsters inside closed buildings show as occupancy badges, not interior scenes.
- Fonts fall back to system faces. Quicksand and IBM Plex Mono are named but not bundled.

IMD job `efe690bc-8404-4b07-9ec6-44c3d6022c53`.
