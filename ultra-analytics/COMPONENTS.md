# RYDN — Major Components Map

> Where UI lives. Pair with [`ARCHITECTURE.md`](./ARCHITECTURE.md) and [`RYDN_CONTEXT.md`](./RYDN_CONTEXT.md).

Paths are under `frontend/src/` unless noted.

---

## App shell & entry

| Component | Path | Job |
|-----------|------|-----|
| `App` | `App.tsx` | Auth gate, URL↔screen, mount surfaces |
| `AppShell` | `components/shell/AppShell.tsx` | Planning / Trips / Library / You chrome |
| `Home` | `components/Home.tsx` | Cabinet fetch, space router, modals |
| `Welcome` / `ConnectProvider` / `SyncProgress` | `components/*` | Pre-home auth flows |
| `Onboarding` | `components/onboarding/Onboarding.tsx` | Product tour overlay |
| `ProGate` | `components/account/ProGate.tsx` | Upgrade / Race Pass sheet |

---

## Home spaces (`components/home/`)

| Component | Job |
|-----------|-----|
| `PlanningSpace` | Planned route list + upcoming ultras |
| `TripsSpace` | Multi-day trip cabinet (filter/sort/year groups) |
| `LibrarySpace` | Source days, sync, suggestions, coach card |
| `YouSpace` | Profile, billing, redeem, quick resume, connections |
| `GroupUltraModal` | Create trip from library days |
| `UploadModal` | Planned GPX stream import / completed ride import |

---

## Plan + Ride

| Component | Path | Job |
|-----------|------|-----|
| `RoutePage` | `components/RoutePage.tsx` | Plan/Ride orchestration |
| Helpers | `plan/routePageUtils.ts` | Pure formatters, review apply, checklist config |
| `PlanMap` | `plan/PlanMap.tsx` | Interactive MapLibre map |
| Layers / search | `plan/planLayers.ts`, `planSearchUi.ts`, `planSearchLifecycle.ts`, `workspaceLayers.ts` | Marker visibility, search chips, verify layers |
| Icons | `plan/icons/*` | Category glyphs + map sprites |
| `RidePanel` | `plan/RidePanel.tsx` | Ride glance UI |
| `ElevProfileChart` | `plan/ElevProfileChart.tsx` | Sticky elev SVG |
| `useRideLocation` | `plan/useRideLocation.ts` | Optional GPS progress |
| `CustomPoiSheet` / `customPoi` | `plan/CustomPoiSheet.tsx`, `customPoi.ts` | Rider-defined stops |
| `StreetViewLink` | `plan/StreetViewLink.tsx` | External Street View / maps |

---

## Review / Analyze (day)

| Component | Path | Job |
|-----------|------|-----|
| `Review` | `components/Review.tsx` | Tab shell |
| `OverviewPage` | `review/OverviewPage.tsx` | Headline metrics |
| `CurvesPage` / `CurveCard` | `review/CurvesPage.tsx`, `CurveCard.tsx` | Performance curves |
| `DurabilityChart` | `review/DurabilityChart.tsx` | Fatigue / durability |
| `RideCoachCard` | `review/RideCoachCard.tsx` | Heuristic tips UI |
| `RideShareScreen` / `RideShareMap` | `review/*` | Shareable ride presentation |
| Coach logic | `coach/rideCoach.ts` | Deterministic tip generation |

---

## Trips (Ultras)

| Component | Path | Job |
|-----------|------|-----|
| `UltraCard` | `components/UltraCard.tsx` | Cabinet card |
| `UltraPage` | `components/UltraPage.tsx` | Trip detail / edit |
| `UltraAnalyticsPage` | `components/UltraAnalyticsPage.tsx` | Multi-day analytics |
| Trip helpers | `trips/kind.ts`, `sort.ts`, `badges.ts`, `paintGate.ts` | Filter/sort/shelf paint |

---

## Shared UI (`components/ui/`)

| Component | Job |
|-----------|-----|
| `RouteBasemap` / `RoutePreview` | Non-interactive atlas / shelf maps |
| `CurveChart` / `curveChartModel` / `useChartScrub` | Chart rendering + scrub |
| `ScoreLine` | Distance · elev · time line |
| `Icon`, `RydnMark`, `RydnLoader`, `FocusLock` | Chrome primitives |
| `LibrarySortControl`, `TripKindControl` | List controls |
| `titles.ts`, `format.ts` | Display helpers |

---

## Harnesses (not product UI)

| File | Purpose |
|------|---------|
| `planmapHarness.tsx` + HTML | Plan marker e2e |
| `onboardingHarness.tsx` + HTML | Onboarding screenshots |
| `routeBasemapHarness.tsx` + HTML | Manual basemap QA |

Keep these; they reduce regressions.

---

## Adding a component (policy)

1. Prefer colocating under the domain folder (`home/`, `plan/`, `review/`, `ui/`).
2. Extract only when the block is already a clear function component or pure helper.
3. Re-export or update imports mechanically — **no visual/API changes**.
4. Keep CSS class names stable; extend `styles.css` with the same prefix family.
5. Update this file when you add a major surface (not every 20-line helper).
