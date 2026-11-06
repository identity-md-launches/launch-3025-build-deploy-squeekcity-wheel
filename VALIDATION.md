# SqueekCity validation record

Worker-side record for IMD job `efe690bc-8404-4b07-9ec6-44c3d6022c53`, revision round, 2026-11-06. It reports what this worker ran. It is not an independent certification.

## 1. Scope and assumptions

- Reviewed: the finished `dist/` export. The primary-flow run served it under a subpath (`/game/squeek/`) to exercise relative asset URLs.
- This round answers five review findings and leaves the rest of the accepted game unchanged. The six-domain review below covers the whole interface, but findings outside the five are recorded in section 3 rather than fixed, as the revision instructions require.
- Browser: Playwright with Chromium (`chromium-headless-shell` build 1254). Scripts lived in `test/scratch/`, which is not delivered.
- Test wallet: an injected EIP-6963 provider that answers `eth_requestAccounts`, `eth_accounts`, `eth_chainId` and `wallet_revokePermissions`. It is a stand-in. No real wallet was used.

## 2. Coverage

| Domain | Status | Inspected | Not performed |
| --- | --- | --- | --- |
| Accessibility | Checked | Keyboard walk of the wallet sheet at 390 and 1440, including Tab, Shift+Tab, Escape, focus return and `inert`. A phone user agent's Open-in links. Computed tab semantics. Hit areas at 390. CSS under `prefers-reduced-motion`. Focused-row screenshot. | Screen reader session. Automated accessibility scan. Native 200% zoom. |
| Layout | Checked | Connected header on Sepolia and on a wrong network at 320, 360, 390, 430, 600, 761, 800, 1024 and 1440. Disconnected header at 320, 360, 390, 421, 430, 481, 500, 501, 520, 600 and 761. Screenshots at 320, 390 and 1440. Horizontal overflow. Map height after the header grows. | Physical devices. Landscape phones. |
| Writing | Checked | Status, failure and stale messages, wallet copy, button labels (source and rendered). | None for the reviewed states. |
| Typography | Checked | Rendered sizes, type scale of four sizes, tabular numerals. The probe's type checks. | The named fonts could not be checked: they aren't bundled, and the browser reported 0 loaded font faces. |
| Colors | Checked | Computed foreground and background pairs across the city, district, citizens, hamster, real wheel, chronicle and wallet states at 390. | Pairs over the canvas (pins, toasts, zoom buttons sit on moving art; their own backgrounds are solid). The disabled-button state. The connected-wallet error note. Text on `.warn` and `.stat.surge` states, which were not on screen during the measurement. |
| UI | Checked | Component states used in the flows: hover and press from source, pressed toggles, disabled from source, loading, empty and error states. Modal overlay screenshot. | A power surge's visual effect was not inspected by eye this round. |

Lowest measured contrast ratios (text colour on its solid background, 8 distinct pairs in the states listed above, all at 390):

| Ratio | Size | Example |
| --- | --- | --- |
| 6.25 | 14px | muted row text |
| 6.90 | 14px | unselected tab |
| 7.56 | 12px | Unavailable badge |
| 10.34 | 14px | gold Connect button; gold pressed 1x |
| 11.63 | 14px | blue link |
| 13.93 | 14px | stat chip |
| 15.40 | 16px | wordmark |

## 3. Findings and fixes

Fixed this round:

| Severity | Source | Evidence before | Change | Recheck |
| --- | --- | --- | --- | --- |
| High | `src/styles.css:70`, `:75`, `:202` | At 390 connected: scrollWidth 416 against clientWidth 390, Disconnect ended at 415.75, `.stats` 0 wide. | Header wraps and grows, wallet row wraps, `.stats` uses an auto basis. | scrollWidth 390, wallet right edge 382, stats 269.6 wide, all stats and controls visible at all nine widths. |
| Medium | `src/App.tsx:203`, `src/api/squeek.ts:57`, `:63`, `:129`, `src/ui/Panels.tsx:347`, `:353` | With later polls hanging, 121 s after the reading the header and panel still said Live hardware and online. | Expiry derived on each UI refresh. Requests time out after 10 s. A failed request keeps the last reading and reports the failure. | At +121 s header and panel say Stale and freshness says stale, with RPM and timestamps kept. A later success recovers. A first request that hangs reaches Unavailable. |
| Medium | `src/ui/WalletControl.tsx:10`, `:46`, `:83` | Tab left the sheet for Back to City, and Enter changed district behind it. | Sheet portalled to `body`, `#root` inert while open, Tab and Shift+Tab wrap. | Tab cycles inside on every tested case. Back to City can't take focus. Escape, Close and backdrop all clear `inert`; Escape and Close were confirmed to return focus to Connect. |
| Medium | `src/App.tsx:14`, `:19`, `:161` | At 390: zoom 0.45, then 0.6 after Zoom out, and it stayed there. | One `MIN_ZOOM` shared by `cityCam` and `zoomBy`. | 0.45 stays 0.45 on Zoom out, then Zoom in gives 0.54. |
| Low | `src/App.tsx:292` | "Upgraded to level 2." appeared on the untouched Battery Depot. | `BuildingPanel` keyed by building id. | The message is gone on Battery Depot. |

Two problems came up while fixing these and were also fixed:

- `flex: 1` on `.stats` kept the same clipping at 360, 600, 761, 800 and 1024, which the reported width didn't show. The auto basis fixes this at every tested width.
- The auto basis made a disconnected header wrap between 421 and about 500. The compact header breakpoint moved from 420 to 500.

Open, not fixed (outside the five findings):

| Severity | Source | Evidence | Suggested correction |
| --- | --- | --- | --- |
| Medium | `src/App.tsx` `.tabs` | `role="tab"` with no arrow keys or roving `tabindex`, and no `aria-controls` or `aria-labelledby`. Tabs do work with Tab and Enter. | Add the APG tabs pattern, or remove the tab roles. |
| Low | `src/ui/WalletControl.tsx` | After connecting or disconnecting, the pressed control unmounts, so keyboard focus falls to `body`. | Move focus to Disconnect or Connect. |
| Low | `src/render/render.ts` | No `prefers-reduced-motion` check, so the canvas and camera ease keep animating. CSS transitions are reduced. | Skip camera easing and calm ambient animation when reduced motion is requested. |
| Low | `src/styles.css` `.seg`, `.sheet .x`, `.link` | Leaderboard sort and Close are 32px tall and inline links 24px. These meet the 24px AA baseline but miss the guide's 40 to 44px aim. | Raise heights where the layout allows. |

## 4. Verification

`npm ci` ran at the start of the round; `package.json` and the lockfile did not change. Everything else ran on the final source, after `rm -rf dist`:

| Command | Result |
| --- | --- |
| `npm ci` | Passed |
| `npm run build` | Exit 0. `dist/` is 546,688 bytes. Asset URLs in `dist/index.html` are relative. |
| `npx tsc --noEmit` | Exit 0 |
| `npx vitest run` | 20 of 20 passed, 7 of them new this round (reading expiry, failed-request handling, timeouts) |
| Finding reproduction script | All five reproduced on the previous export and none on the final export |
| Extended browser script | 53 of 53 passed |
| Primary-flow browser script, 1440×900 and 390×844 | 30 of 30 passed |
| `node .imd/reads/skills/design-critic/scripts/taste.mjs --out test/scratch/taste` | 16 of 16 passed at 320, 390 and 1440 |

The extended script covers the header widths above, the wallet flows and network states, modal keyboard behaviour, a silent reconnect arriving while the sheet is open, the reading timeline, and the WE bonus on fixtures. The primary-flow script covers district entry and Back to City, Live Studio link, a building upgrade that spends WE, hamster profile, leaderboard and sorting, Rain, Sun, Plant trees, Pause and 2x, and a save and upgrade that survive reload.

Bonus on fixtures: an ACTIVE hardware reading polled 5 times paid 23 WE once. Simulated, replayed and idle readings paid 0 and carried their own labels.

Not exercised in the primary-flow script: autonomous career promotions and rain sheltering in the browser. Those are covered by the simulation unit tests.

## 5. Real API status

**The live API could not be read from this machine in this round.** Every request to `api.squeekchain.com` returned HTTP 403 with a Cloudflare "Just a moment..." challenge page. That was true for all origins tried, including `squeekchain.com`, and for a request with no `Origin` header. A browser reports this as a CORS failure, because the challenge page has no CORS headers. `docs.squeekchain.com` also returned a near-empty page.

The challenge was not bypassed. What this means:

- The game correctly showed Unavailable on status and on events, and the city kept running. That part was seen in the browser.
- API behaviour this round was tested only on fixtures written from the schema recorded on 2026-11-06. Those fixtures are controlled data, not evidence of real wheel activity.
- A live read in a visitor's browser wasn't confirmed this round. The previous round recorded one, with the label "Live, wheel idle". Whether visitors meet this challenge is for Squeekchain to confirm. If they do, the game will show Unavailable rather than a live reading.

## 6. Completion

**Incomplete in one respect, complete for the rest of the stated scope.** All five findings are fixed and rechecked, and the build, typecheck, tests, interaction checks and design probe pass. The live API read could not be confirmed this round, for the reason in section 5.

Remaining limitations:

- Not tested: a real wallet extension, a WebKit or Safari run, a physical phone and a screen reader.
- The open findings in section 3 remain.
- Hamsters inside closed buildings show as occupancy badges, not interior scenes.
- Quicksand and IBM Plex Mono are named but not bundled, so system fonts are used.
- The site's URL comes from IMD's publishing step. This repository doesn't publish or buy domains, so `squeekcity.imd.site` is unconfirmed.
