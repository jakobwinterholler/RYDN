# RYDN / ultra-analytics — Architecture

> Companion to [`RYDN_CONTEXT.md`](./RYDN_CONTEXT.md). Code map only — no product redesign.

**Stack:** FastAPI (Python) + Vite / React 18 / TypeScript + MapLibre GL. Deployed as one service (API serves SPA in production).

---

## Top-level layout

```
ultra-analytics/
├── RYDN_CONTEXT.md          ← AI entrypoint
├── ARCHITECTURE.md          ← this file
├── DESIGN_SYSTEM.md
├── COMPONENTS.md
├── CONTRIBUTING.md
├── backend/
│   ├── app/                 ← FastAPI application
│   └── tests/
├── frontend/
│   ├── src/                 ← React app
│   ├── e2e/                 ← Playwright
│   └── *Harness*            ← QA / screenshot harnesses
├── founder/                 ← Internal ops dashboard (separate)
├── scripts/
└── Dockerfile / railway.toml / dev.sh
```

---

## Frontend (`frontend/src`)

| Area | Role |
|------|------|
| `main.tsx` / `App.tsx` | Boot, custom URL router, auth gating, screen switch |
| `api.ts` / `types.ts` | HTTP client + domain types (mirror backend JSON) |
| `auth/useAuth.ts` | Session, providers, profile, redeem |
| `components/Home.tsx` | Shell orchestration + cabinet fetch |
| `components/home/*` | Planning / Trips / Library / You spaces + modals |
| `components/RoutePage.tsx` | Plan + Ride workspace |
| `components/plan/*` | Map, layers, search, ride panel, custom POI, icons |
| `components/Review.tsx` + `review/*` | Day analytics |
| `components/UltraPage.tsx` / `UltraAnalyticsPage.tsx` | Trip detail / aggregate |
| `components/onboarding/*` | Product tour overlay |
| `components/shell/AppShell.tsx` | Primary nav chrome |
| `components/ui/*` | Shared charts, maps, cards, icons |
| `coach/`, `library/`, `trips/`, `subscription/`, `prefs/` | Domain helpers |
| `styles.css` | Single global stylesheet (~10k lines) — do not casually split |
| `replay/` | Race Replay engine (legacy report surfaces) |

### Routing

Custom history sync in `App.tsx` (`pathToScreen` / `screenToPath`):

- `/` — Home spaces (`?space=` optional)
- `/routes/:id` — Plan; `?mode=ride` — Ride
- `/rides/:id` — Day Review
- `/ultras/:id` — Trip detail; `/ultras/:id/analytics` — trip analytics

### Oversized / high-coupling modules

| Module | Notes |
|--------|--------|
| `styles.css` | Tokens at `:root`; domain prefixes `shell-*`, `plan-*`, `ride-*`, `review-*`, `ultra-*` |
| `RoutePage.tsx` | Search/verify lifecycle; helpers in `plan/routePageUtils.ts` |
| `PlanMap.tsx` | MapLibre layers + effects — treat as behavior-sensitive |
| `Home.tsx` + `home/*` | Cabinet UI split into spaces/modals |
| `api.ts` / `types.ts` | Contract surface with backend |

### Intentional dual map stacks

- **Interactive Plan:** `PlanMap` (MapLibre, live markers/search)
- **Shelf / share atlas:** `RouteBasemap` / `RoutePreview` + `routeBasemapTheme` + `trips/paintGate`

Do not merge these without a dedicated project.

---

## Backend (`backend/app`)

| Module | Responsibility |
|--------|----------------|
| `main.py` | Domain HTTP routes + SPA mount |
| `auth.py` | `/api/auth/*` |
| `store.py` | Completed ride library |
| `routes_store.py` | Planned routes + analysis cache + GPX export |
| `ultras.py` | Ultra CRUD, cabinet, suggestions |
| `users.py` | User records / encrypted tokens |
| `maps.py` | `/api/maps/*` (key + Street View metadata; frontend uses external links today) |
| `analysis/` | Ride report pipeline + route planning intelligence |
| `parsing/` | FIT / TCX / GPX (+ route GPX export) |
| `providers/` | Strava OAuth + sync |
| `billing/` | Stripe checkout, portal, webhooks, bootstrap |
| `subscription/` | Tiers, redeem codes, Race Pass, FastAPI deps |
| `models.py` | Canonical Sample / Activity / Race |
| `lifecycle.py` | Status normalization for summaries |

### Object model (do not mix)

```
Planned Route  ≠  Ride (library day)  ≠  Ultra (trip of ride IDs)
```

- Routes never enter the ride library or Ultra membership.
- Ultras group **ride** IDs only.
- `GET /api/cabinet` composes ultras + planned routes + ungrouped rides + suggestions.

### Analysis pipelines

**Completed ride report** (`analysis/report.py`):

```
parse → prepare (1 Hz) → overview / performance / curves / climbs / stops
                       → time_ledger → pacing → summary
```

Schema: `analysisSchema` (bump = cache invalidation + frontend awareness).

**Planned route analysis** (`routes_store.get_route_analysis`):

```
GPX → elevation heal → route_plan → route_pois → route_stops
                     → decisions → weather → cache (.analysis.json)
```

Route `schemaVersion` invalidates stale caches.

**Ultra analysis** (`analysis/ultra_report.py`): stitched multi-day; own schema counter.

### Entitlement

```
Stripe webhook / redeem → entitlement.recompute → subscriptionTier
Race Pass credit → applied on planned GPX import → route.proUnlock
Gates: require_can_import_route, require_route_planning_access
```

Feature map must stay synced: `subscription/features.py` ↔ `frontend/src/subscription/features.ts`.

---

## Data on disk

Under `ULTRA_DATA_DIR` (or local `backend/data/`):

- `users/<uid>.json`
- `users/<uid>/rides/`, `routes/`, `ultras/`
- caches for POI corridor / elevation
- `stripe_billing.json`, redeem codes

---

## Tests

| Suite | Command (from package dirs) |
|-------|-----------------------------|
| Frontend unit | `cd frontend && npm test` |
| Frontend build | `cd frontend && npm run build` |
| Backend unit | `cd backend && python -m pytest` (or project’s usual invoker) |
| E2E | `cd frontend && npm run test:e2e` (needs browser + app) |

High-value backend areas: routes/GPX export, subscription/Race Pass, POI corridor, ultra suggestions, curves/fatigue.

---

## Deliberate non-goals (architecture freeze)

- Splitting `styles.css` without a cascade plan
- Rewriting `PlanMap` / plan search lifecycle “for cleanliness”
- Bumping analysis schemas without a migration story
- Removing MapLibre harnesses or glyph preview scripts
- Introducing React Router, Redux, CSS-in-JS, or a component library
