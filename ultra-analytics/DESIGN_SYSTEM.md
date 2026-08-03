# RYDN — Design System (as implemented)

> Documents **existing** tokens and conventions in `frontend/src/styles.css`.
> Do **not** invent a new visual system here. Brand aspiration lives in [`../RYDN_DESIGN.md`](../RYDN_DESIGN.md).
> AI entrypoint: [`RYDN_CONTEXT.md`](./RYDN_CONTEXT.md).

**Rule:** Implementation tokens win for day-to-day code. Do not “align” the app to the constitution by changing colors/fonts during unrelated tasks.

---

## Source of truth

| Layer | Location |
|-------|----------|
| CSS variables | `frontend/src/styles.css` `:root` (top of file) |
| Global base | same file — `html/body`, buttons, shell |
| Screen styles | same file — domain prefixes (see below) |
| Map atlas colors | `--map-*` + `routeBasemapTheme.ts` |
| Plan glyphs | `components/plan/icons/*` |

Single stylesheet imported from `main.tsx`. No CSS Modules, no Tailwind.

---

## Tokens (`:root`)

### Semantic color

| Token | Role |
|-------|------|
| `--paper` | Page background |
| `--paper-elevated` | Elevated surfaces |
| `--ink` / `--ink-secondary` / `--ink-tertiary` | Text hierarchy |
| `--line` / `--line-strong` | Borders / dividers |
| `--accent` / `--accent-soft` | Primary action / soft highlight (forest green) |
| `--success` / `--warning` / `--danger` | Status |

### Back-compat aliases

Still used widely — prefer semantic names in new CSS, but **do not mass-rename**:

`--bg`, `--bg-elev`, `--bg-elev-2`, `--text`, `--text-dim`, `--text-faint`, `--green`, `--amber`, `--red`, `--violet`

### Layout

`--radius-sm` · `--radius-md` · `--radius-lg` · `--radius-xl` · `--radius` · `--shadow`

### Typography

| Token | Family |
|-------|--------|
| `--font` | IBM Plex Sans (+ system fallbacks) |
| `--font-display` | Source Serif 4 (+ serif fallbacks) |

Base size ~15px; form controls forced to ≥16px on small screens (iOS zoom guard).

### Map atlas

`--map-sea`, `--map-land`, `--map-border`

---

## Component / class naming

BEM-ish blocks with domain prefixes:

| Prefix | Surface |
|--------|---------|
| `shell__*` / `shell-*` | App chrome |
| `space__*` | Home spaces |
| `plan-*` | Plan workspace / map chrome |
| `ride-*` | Ride mode |
| `review-*` / `review__*` | Day Review |
| `ultra-*` / `trips-*` | Trips cabinet |
| `you-*` | Account |
| `btn`, `btn--*` | Buttons |
| `sheet__*`, `modal__*` | Overlays |

Modifiers: `btn--primary`, `is-active`, `is-on`, `active`.

**Do not rename classes** that appear in TSX or Playwright selectors unless updating every call site in the same change. Prefer adding a new class over renaming a hot one.

---

## Buttons

Shared `.btn` system near the top of `styles.css`:

- `btn--primary` — main action
- `btn--secondary` / `btn--tertiary` / `btn--ghost`
- `btn--strava` — provider connect/sync
- `btn--block` — full width (sheets)

One primary action per view whenever possible.

---

## Layout patterns (existing)

- **Shell:** brand mark + wordmark, desktop tabs, mobile bottom nav, avatar → Account
- **Spaces:** `space__head` + title/sub + actions; lists/grids below
- **Plan:** map-first; briefing sheet / peek sheet; search chips
- **Ride:** sticky elev + glance bar; scroll timeline of verified stops
- **Sheets / modals:** `FocusLock` + `sheet__*` / `modal__*`

Cards exist where the product already uses them (route cards, trip cards, ride cards). Do not introduce a general “card system” for new marketing-style blocks inside the app shell.

---

## Motion

Existing motion is intentional and sparse (marker pop, review confirm/exit, import progress). Prefer matching nearby patterns. Do not add decorative animation systems.

---

## What not to do

- Purple-on-white / indigo gradient “AI default” themes
- Flat redesign of paper/ink/accent
- Inter/Roboto as primary fonts
- Dark mode toggle without an explicit product project
- Splitting `styles.css` mid-feature (cascade risk)
- Inline style sprawl for colors that already have tokens
