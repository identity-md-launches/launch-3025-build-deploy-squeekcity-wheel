# SqueekCity design system

This describes the implemented interface in `src/styles.css`, `src/App.tsx`, `src/ui/` and `src/render/render.ts`. Validation results and open findings are in `VALIDATION.md`.

## Overview

SqueekCity is a browser game for people following Squeekchain Genesis. The first screen is the game itself: a pixel-art isometric city on a near-black stage, with a flat dark interface around it.

- The canvas is the product. Interface chrome sits at its edges (header, god mode bar, side panel) and doesn't compete with it.
- Gold is reserved for main actions: the district pins, Connect, building upgrades and the Live Studio link.
- Panels are dense and read like a game's status screens: short rows, numbers in mono, no marketing copy.
- Data labels are part of the design. Live, stale, simulated, replayed and unavailable readings each have a visible text label, never colour alone.

## Colors

Tokens live in `:root` at `src/styles.css:2`. The `--sqk-*` values are the Squeekchain Genesis palette. The `--color-*` names are the roles to use in components.

| Role token | Value | Use |
| --- | --- | --- |
| `--color-bg` | `--sqk-bg` `#0b0b0d` | Page and canvas backdrop |
| `--color-surface` | `--sqk-bg-raised` `#0f0f12` | Header, panel, god mode bar, wallet sheet |
| `--color-control` | `--sqk-bench` `#1a1a20` | Buttons, stat chips, list rows, cards, notes |
| `--color-control-hover` | `#24242c` | Hovered control |
| `--color-control-press` | `#2e2e38` | Pressed control |
| `--color-border` | `--sqk-line` `#2a2a33` | Dividers and control borders |
| `--sqk-line-strong` | `#3a3a46` | Hovered control border |
| `--color-text` | `--sqk-ink` `#e6e6ec` | Primary text |
| `--color-text-muted` | `--sqk-muted` `#9a9aaa` | Secondary text |
| `--color-accent` | `--sqk-gold` `#f2c230` | Main action, pressed toggles, selected tab underline |
| `--color-accent-ink` | `#1a1a20` | Text on gold |
| `--color-focus` | `--sqk-active` `#7fd4ff` | Focus ring |

Status colours, used through badges and bars:

| Token | Value | Use |
| --- | --- | --- |
| `--sqk-green` | `#35d07f` | Live hardware, good needs bars, Sepolia chip |
| `--sqk-active` | `#7fd4ff` | Wheel idle, links, API chronicle entries |
| `--sqk-gold` | `#f2c230` | Stale, simulated, replayed and derived readings |
| `--sqk-warn` | `#ff8a7a` | Unavailable, failed checks, low needs bars, wallet errors |
| `--sqk-blue` / `--sqk-blue-deep` | `#5b7cfa` / `#2f4499` | Neutral bars / toasts and the power surge chip |
| `--sqk-cream` | `#fdfbc8` | Text on blue-deep |

Hover gold for accent controls is the literal `#ffd24d`. The canvas has its own palette, `PAL` at `src/render/render.ts:6`, which adds terrain tones to the same Genesis colours. Don't use canvas terrain colours in the interface.

There is one dark theme and no light theme. Measured contrast pairs are in `VALIDATION.md`.

## Typography

| Token | Value | Role |
| --- | --- | --- |
| `--font-ui` | `"Quicksand", ui-rounded, system-ui, -apple-system, "Segoe UI", sans-serif` | All interface text |
| `--font-data` | `"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace` | Numbers, addresses, timestamps (`.mono`, with tabular numerals) |

Neither named font is bundled and the page loads no web fonts, so visitors see their system's fallback faces. Measured widths depend on that fallback, which is one reason the header wraps rather than assuming a fixed width.

| Token | Size | Use |
| --- | --- | --- |
| `--text-xs` | 12px | Badges, wallet notes |
| `--text-sm` | 14px | Controls, stat chips, rows, secondary text |
| `--text-md` | 16px | Body, `h3`, the wordmark on narrow phones |
| `--text-lg` | 20px | `h1`, `h2`, icon glyphs |

Body line height is 1.45 and headings use 1.2 with `text-wrap: balance`. Headings and control labels are weight 600. Keep to these four sizes.

## Layout

The spacing scale is `--space-1` to `--space-5`: 4, 8, 12, 16 and 24px.

`.app` is a two-row grid: an `auto` header and a `minmax(0, 1fr)` stage, filling `100dvh`. The page itself doesn't scroll (`body { overflow: hidden }`); `.panel-body` scrolls instead.

`.stage` is a named grid with the areas `map`, `god` and `panel`.

| Width | Behaviour |
| --- | --- |
| Above 760px | Map and god mode bar on the left, `--panel-w` (380px) panel on the right, full height. Header stats show day, weather and the wheel label. |
| Up to 760px | One column: map, god mode bar, panel. The panel is capped at `42dvh` and collapses with `.sheet-toggle`. The god mode bar scrolls sideways. Weather and the wheel label move out of the header (`.hide-sm`); the Real wheel tab still shows the label. The wallet sheet docks to the bottom. |
| Up to 500px | Compact header: no logo, smaller wordmark, no day number (`.hide-xs`), tighter chips and wallet padding. |
| Up to 360px | Logo returns and the wordmark becomes visually hidden. |

**The header grows with its content.** `.top` has `min-height: var(--header-h)` (56px, or 52px up to 760px) and wraps. `.stats` uses `flex: 1 1 auto` so its real content width decides the line break: the wallet moves to its own row before any stat clips. A connected wallet therefore takes two rows at phone widths, and three on a wrong network at 390px and below. The map takes the remaining height.

The canvas follows `.canvas-wrap` through a `ResizeObserver` and renders at half resolution, scaled 2× with `image-rendering: pixelated` (`PX` in `src/App.tsx`).

Camera zoom runs from `MIN_ZOOM` 0.45 to `MAX_ZOOM` 3.2 (`src/App.tsx:14`). City framing (`cityCam`) and every zoom control share those limits.

## Elevation & Depth

The interface is flat: layers are separated by tone and 1px borders, not shadows. The exceptions:

- `.pin`: a solid `0 2px 0 #84660f` lip plus a soft drop shadow, because pins float over the canvas.
- `.toast`: a soft drop shadow over the canvas.
- `.sheet-bg`: a `rgba(0, 0, 0, 0.6)` overlay at `z-index: 20`, the only stacked layer above the app.

## Shapes

`--radius` (8px) is the default for controls, chips and rows. `--radius-lg` (12px) is for cards and the wallet sheet. Small markers use 2 to 6px. Canvas art is square-pixel and has no radii. On phones the sheet rounds only its top corners.

## Components

These are CSS patterns plus React components, not a published library.

- **Button** (`.btn`, `src/styles.css`). 40px minimum height. Variants: `.btn-accent` for the main action, `.btn-block` for full width, `.btn.icon` for the 40px square zoom controls. Hover and press change tone, press also scales to 0.96. `aria-pressed="true"` shows a gold border and text. Disabled is 0.55 opacity with a `not-allowed` cursor.
- **District pin** (`.pin`, `src/App.tsx`). Gold buttons positioned over the canvas each frame and clamped to stay on screen. They are the keyboard path into a district.
- **Stat chip** (`.stat`). Header values. `.stat.surge` turns blue-deep during a power surge. `.badge-*` classes set the wheel label's colour.
- **Tabs** (`.tabs`). Panel navigation with a gold underline on the selected tab. Keyboard limits are listed in `VALIDATION.md`.
- **Rows and cards**. `.list-row` for 40px tappable rows, `.card-btn` for district choices, `.kv` for label and value lists, `.table` for the leaderboard and work history, `.seg` for the leaderboard sort, `.chron` for timelines.
- **Bar** (`.bar`, `Bar` in `src/ui/Panels.tsx`). A labelled value with `.bar-fill`, `.good` and `.warn`.
- **Building panel** (`BuildingPanel`, `src/ui/Panels.tsx`). Keyed by building id in `src/App.tsx`, so its status message belongs to one building and resets when the selection changes.
- **Reading status** (`src/api/squeek.ts`). `.badge` with `LABEL_TEXT`. Always pass the result of `ageReading` to the interface, so expiry shows on every refresh. If a request fails, `mergeReading` keeps the last reading and its timestamps, and a `.warn` line reports the failed check.
- **Wallet control** (`src/ui/WalletControl.tsx`). A Connect button that opens a modal sheet. The sheet is portalled to `document.body` so `#root` can be `inert` while it is open. It takes focus on open, wraps Tab and Shift+Tab, closes on Escape, the backdrop or Close, and returns focus to Connect. When connected: `.wallet-on` with a Sepolia chip or a Switch to Sepolia button, plus the address and Disconnect.

Loading and empty states: `.loading` while the save opens, "Checking" until the first status request ends, "Empty right now" for vacant buildings, and "Unknown" for missing values, never zero.

## Do's and Don'ts

- Do use `--color-*` role tokens in components, and `--sqk-*` directly only for the status colours above.
- Do use `.btn-accent` for main actions only. Secondary actions, such as building activities and the god mode bar, are plain `.btn`.
- Do give every data state a text label. Colour only reinforces it.
- Do let header content wrap. Don't give `.top` or `.app`'s first row a fixed height, and don't put `flex: 1` (a zero basis) on `.stats`.
- Do portal any new modal to `document.body` and reuse the wallet sheet's inert, Tab and focus-return handling.
- Don't show a stored reading without `ageReading`, and don't present WE as SQK or as having outside value.
- Don't add a fifth type size, a second accent or a light theme without a reason in the brief.

**To add a panel page:** add a component in `src/ui/Panels.tsx` that returns a `.stack`, start with an `h2`, use `.kv`, `.list` and `Bar` for content, and add it to the tab list in `src/App.tsx`. Actions go in `.btn`, using `.btn-accent` only for the main one, and report results in a `.note` with `role="status"`.
