# RYDN — AI Entrypoint Context

> **Read this file first.** It is the single onboarding document for any AI (or human) working on RYDN.
> Product snapshot tag: `v1-architecture-freeze` — preserve shipped behavior unless the user explicitly asks to change it.

**Related docs (do not contradict):**
- This file → product + coding constitution for the living app
- [`ARCHITECTURE.md`](./ARCHITECTURE.md) → code map (frontend + backend)
- [`DESIGN_SYSTEM.md`](./DESIGN_SYSTEM.md) → tokens / CSS conventions **as implemented**
- [`COMPONENTS.md`](./COMPONENTS.md) → major UI surfaces
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) → how to change code safely
- Repo root [`../ULTRA_BRAIN.md`](../ULTRA_BRAIN.md) → long-horizon product vision
- Repo root [`../RYDN_DESIGN.md`](../RYDN_DESIGN.md) → design constitution (aspirational + brand)

When documents disagree on **what ships today**, trust the code + this file. When they disagree on **long-term vision**, trust ULTRA_BRAIN / RYDN_DESIGN, but do not implement vision as if it were already built.

---

## Product Vision

**RYDN** (pronounced *ridden*) is the experience platform for ultra cyclists and serious endurance riders. Domain: [rydn.bike](https://rydn.bike).

It is **not** a Strava clone, fitness tracker, or chart dump. The hero object is an **Ultra / multi-day trip** — a named event or expedition that may contain multiple source days (Strava activities, FIT/TCX/GPX uploads). Completed trips form a trophy cabinet; every finished Ultra should eventually make the next plan smarter.

One sentence:

> RYDN builds the rider’s experience over years of ultra racing — plan with past Ultras, ride the verified plan, review what happened, save the Ultra, get better.

Implementation lives in `ultra-analytics/` (FastAPI + Vite/React). Older “Roadbook / Companion / Analytics” product splits are historical; there is **one app**.

---

## Principles

1. **Clarity over cleverness** — tired riders at midnight; one purpose per screen.
2. **Experience compounds** — Completed Ultras feed future planning (vision); do not fake insight.
3. **Humans create Ultras** — software may suggest groupings; never auto-create trips.
4. **Suggestions, then verification** — Plan proposes; rider verifies. No silent commitments.
5. **Calm under fatigue** — Ride mode: big targets, few words, offline-friendly.
6. **Honesty over coverage** — thin data → say so; never fabricate metrics.
7. **API and CSS contracts are frozen unless asked** — camelCase JSON, class names, routes.
8. **Backend is source of truth** for reports, entitlement, and analysis schemas.
9. **No drive-by redesigns** — architecture work must not change look or UX.
10. **Prefer mechanical extraction** over clever abstractions; no single-use framework layers.

---

## Core Workflow (PLAN → VERIFY → RIDE → ANALYZE)

```
Import planned GPX
  → PLAN (map-first workspace: POIs, climbs, stages, gaps)
  → VERIFY (mark stops verified / rejected / later; checklist)
  → RIDE (glance metrics, elev profile, verified stop timeline, optional live GPS)
  → ANALYZE / Review (day report: overview, curves, durability, coach heuristics)
  → Library / Trips (group days into Ultras; trophy cabinet)
```

| Phase | Home space / route | Primary files |
|-------|-------------------|---------------|
| Plan / Verify | `/routes/:id` | `RoutePage.tsx`, `plan/*` |
| Ride | `/routes/:id?mode=ride` | `RoutePage` + `RidePanel` |
| Analyze (day) | `/rides/:id` | `Review.tsx`, `review/*` |
| Trips cabinet | Home → Trips | `home/TripsSpace`, `UltraPage` |
| Source days | Home → Library | `home/LibrarySpace` |
| Account / billing | Home → You | `home/YouSpace` |

Custom URL router in `App.tsx` (no React Router). Auth: Google OAuth (+ dev login). Entitlement: Free vs Pro (+ Race Pass per-route unlock).

---

## Finished Features (FROZEN — do not “improve” casually)

Treat these as **shipped product**. Change only with explicit product request + careful regression.

| Feature | Notes |
|---------|--------|
| **App shell** | Planning · Trips · Library · Account (avatar) |
| **Onboarding** | Welcome → connect → sync → product tour (`onboarding/*`) |
| **Library** | Strava sync, file import (FIT/TCX/GPX), sort, delete, coach card |
| **Trips / Ultras** | Create trip from days, kind filter/sort, shelf cards, Ultra detail |
| **Planned routes** | GPX import (stream + progress), Race Pass / Pro gates |
| **Plan POIs** | Corridor search, quick actions, layers, verify workflow |
| **Custom POIs** | Rider-defined stops (`customPoi.ts`, `CustomPoiSheet`) |
| **Race Pass + Stripe billing** | Checkout, portal, webhooks, redeem codes |
| **Ride glance** | Next water/shop, remaining km/elev, elev profile, stop timeline |
| **Live ride location** | Optional GPS progress (`useRideLocation`) |
| **GPX export** | Verified waypoints on original course |
| **Street View link** | External maps link (`StreetViewLink`) — not embedded Maps JS |
| **Day Review** | Overview, curves, durability, share map/screen |
| **Coach heuristics** | Deterministic tips (`coach/rideCoach.ts`) — not LLM |
| **Share maps / basemap** | `RouteBasemap`, `RoutePreview`, paint gate for Trips shelf |
| **Feature gates** | `subscription/features.ts` ↔ backend `subscription/features.py` |

---

## Features Under Development

Not finished — do not invent UI for these unless asked:

- Experience-based planning (“base this plan on Ultra X”)
- Aggressive / Balanced / Comfort strategy packs
- Full plan-vs-actual Review for Ultras
- Compare tab (placeholder removed; CSS may linger)
- Privacy controls / account deletion
- Apple subscription path (`appleActive` placeholder)
- Offline-first Ride packaging beyond current browser behavior
- Deeper Ultra analytics / certificates polish

---

## Future Roadmap (vision — not a build order)

From ULTRA_BRAIN / RYDN_DESIGN, roughly:

1. Stronger **experience replay** into Plan
2. Richer **Verify** readiness scoring
3. Ultra-level Review as the primary analytics hero
4. Signature metrics (stop efficiency, unsupported sections, etc.)
5. Multi-device / deeper offline Ride
6. Broader provider support beyond Strava

Do **not** implement roadmap items during architecture or cleanup tasks.

---

## Coding Philosophy

- **Behavior freeze first** — if a refactor risks UX/API change, skip it.
- **Extract, don’t rewrite** — move code; keep class names, copy, and response shapes.
- **Small modules when obvious** — hooks/utils/components with clear boundaries; no god frameworks.
- **Tests for race-sensitive paths** — plan search, GPX export, entitlement, corridor.
- **Strict TypeScript** — avoid `any`; mirror backend camelCase in `types.ts`.
- **One stylesheet** — `styles.css`; prefer existing tokens; do not rename classes lightly.
- **Schema bumps are releases** — ride `analysisSchema`, ultra `ultraAnalysisSchema`, route `schemaVersion` need coordinated cache + frontend updates.
- **Harnesses are tools** — `*Harness.tsx` + HTML entries support e2e/QA; not dead product code.

---

## Things AI Should Never Change

Unless the user **explicitly** requests it:

1. Visual design, layout, copy, motion, or information hierarchy
2. API paths, methods, or JSON field names / shapes
3. CSS class names that UI or e2e depend on (`plan-*`, `ride-*`, `shell-*`, layer IDs)
4. MapLibre layer/source IDs and marker sprite contracts
5. Entitlement semantics (Free / Pro / Race Pass)
6. Analysis math semantics (speed curves start rules, hike-a-bike, fatigue, stop classifier)
7. Auto-creating Ultras or silently modifying verified plans
8. Adding LLM/AI narrative as default Review content
9. Speculative memoization / over-abstraction “for performance”
10. Committing, force-pushing, or deploying without a clear green build + user intent
11. Expanding scope into new features during cleanup/architecture tasks
12. “Fixing” frozen finished features with drive-by UX tweaks

---

## How to start a task

1. Read **this file**.
2. Skim [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the module you will touch.
3. For UI work, read [`DESIGN_SYSTEM.md`](./DESIGN_SYSTEM.md) + [`COMPONENTS.md`](./COMPONENTS.md) — document existing rules; do not invent a new system.
4. Follow [`CONTRIBUTING.md`](./CONTRIBUTING.md).
5. Prefer changing the smallest surface that achieves the goal.
6. Run frontend build + unit tests and relevant backend tests before declaring done.
