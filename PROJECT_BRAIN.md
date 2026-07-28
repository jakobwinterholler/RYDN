# Ultra Roadbook

**Status:** Product vision superseded by **`ULTRA_BRAIN.md`** (July 2026) — Ultra is now
one **experience platform**: Completed Ultras (trophy cabinet) + experience-based
planning. This file remains the source of truth for the *existing* Roadbook +
Companion implementation until Plan/Ride fold into the unified app.

> **Living document.** Update this file whenever a significant feature, architectural change, UX decision, or roadmap shift is completed. Append to history; do not erase past decisions.

**Current state (July 2026):** Desktop **0.5.0** · Companion **0.5.0** · Pipeline **0.15** · Bundle schema **v5** · Branch `feature/coros-export-v3` · Production companion: https://companion-flax.vercel.app

**Tagline:** Analyze. Plan. Ride.

> **Doc hygiene:** `RELEASE_NOTES.md` still says Desktop 0.15.0 / Companion 0.1.0 and "Dashboard first" — stale. Trust `package.json` and this file for current behavior.

---

## Vision

**Ultra Roadbook** is a premium planning and race-day execution system for ultra cyclists.

It transforms an uploaded GPX route into a **trusted resupply and climb plan** — not by editing the route, but by analysing it, suggesting real-world stops, and letting the rider verify what they will actually use. That plan syncs to a phone companion for race day and exports to GPS devices (primarily **Coros**) as waypoints on the **original, unmodified track**.

### Problem it solves

Ultra races are won or lost in planning: where to refill, which climbs matter, how long you can go unsupported, and whether you trust the POIs on your GPS. Riders today stitch together Komoot, spreadsheets, Google Maps, and device exports — with no single source of truth and no verification workflow.

Ultra Roadbook answers: *Where should I stop? Do I trust this stop? What happens next on the bike? What goes on my Coros?*

### Why it exists

The founder (Jakob) needed a tool that thinks like an ultra cyclist — prioritising water and food, respecting long unsupported gaps, preferring gas stations over anonymous fountains when it matters, and never silently changing the route.

### What makes it different

| Others | Ultra Roadbook |
|--------|----------------|
| Route editors / navigators | **Resupply intelligence** on a fixed GPX |
| Activity apps (Strava, Komoot) | **Verification-first** planning workflow |
| Generic POI dumps | **Suggested → Verified → Skipped** stop lifecycle |
| One app for everything | **Desktop plans · Phone executes** |
| Cloud or local only | **Cloud-only sync** with offline companion bundles |
| Export anything on the map | **Only real-world POIs** export to Coros; route integrity enforced |

---

## Product Philosophy

1. **The software should think.** Analysis, clustering, gap detection, and stop suggestions are automated. The rider does not configure algorithms.

2. **The rider reviews.** Every important stop passes through human judgment: Verify or Skip. No auto-commit of resupply plans.

3. **Desktop = planning.** Deep review, comparison, maps, elevation, Coros export preview, account management.

4. **Phone = execution.** During the race: next verified stop, resupply timeline, map focus, offline bundle. No re-analysis on the bike.

5. **Cloud-only.** Races live in Supabase. No LAN sync, no USB handoff, no peer-to-peer. One account, one truth.

6. **Original GPX is sacred.** The uploaded track is never modified. Coros/Garmin/Wahoo export adds waypoints only; route geometry checksum must pass or export is cancelled.

7. **Coros export must never modify the route.** Waypoints are appended; track points, distance, and elevation profile of the original file are verified before export.

8. **Only real-world POIs.** No synthetic "resupply hub" markers, no climb waypoints, no analysis artifacts in GPS export. Categories like gas station, supermarket, and drinking water only.

9. **Verification-first workflow.** Suggested stops are hypotheses. Verified stops are commitments. Skipped stops disappear from the plan.

10. **Simplicity over configuration.** No planning modes (Minimal/Balanced/Detailed). No mode pickers at import. One coherent path.

11. **Premium UX over feature overload.** Calm typography, purposeful animation, timeline over endless lists, next-stop focus on race day. Debug tooling hidden behind developer mode.

12. **Trust over quantity.** Fewer, better suggestions beat exhaustive POI tables.

13. **Water is usually more important than food.** Scoring and unsupported-section logic reflect this.

14. **Desktop and Companion must always match.** Same bundle schema, same `suggested_stops` + `verified_stops` pipeline, shared TypeScript modules in `shared/`.

---

## Target User Workflow

```
Import GPX
    ↓
Automatic analysis
    ↓
Review suggested stops
    ↓
Find Stops (optional)
    ↓
Verify / Skip
    ↓
Sync
    ↓
Ride
    ↓
Export to Coros
```

### 1. Import GPX

**Desktop:** Drop or select a GPX in My Races. No race-name dialog, no planning-mode picker. Import starts immediately.

**Companion:** + New Race → file picker (Files, AirDrop, downloads). Requires `VITE_API_BASE_URL` pointing at the FastAPI server for server-side analysis. Duplicate detection offers Replace / Import as duplicate / Cancel.

**Philosophy:** The route file is the contract. Name comes from GPX metadata or filename.

### 2. Automatic analysis

Single Python pipeline (`pipeline.py`): parse GPX → climbs → surface → POI extraction → resupply zone clustering → suggested stops → companion bundle.

Progress UI: **Import → Analyzing… → Ready** (one progress bar; detailed steps only in developer mode).

**Output:** `race.json` analysis artifact + schema v5 companion bundle + dashboard stats cache.

### 3. Review suggested stops

**Desktop Plan tab** (primary screen after import): left panel lists every suggested stop with icon, name, route km, resupply reason, opening hours, gap to next verified stop (distance + elevation). Actions: **Verify · Skip · Focus on map**. Undo last decision always available.

**Not configure:** Rider does not pick algorithms or spacing modes. They judge recommendations.

### 4. Find Stops (optional)

Bounds-based discovery on the visible map area. Returns up to **10 temporary** candidates (grey/blue sparkle markers). Re-search clears previous temps. Verified discoveries **promote** into `suggested_stops` and persist. Skipped temps disappear.

Use when the automatic engine missed a town or the rider wants alternatives in a specific map region.

### 5. Verify / Skip

**Verify** = commit this POI as a planned stop. Writes to `verified_stops`, updates bundle, bumps revision, syncs.

**Skip** = reject this suggestion. Hidden from resupply views and export (status `rejected`).

Discovered stops verified via **promote-discovery** API path insert into primary `suggested_stops`, not only `nearbyAlternatives`.

### 6. Sync

Push bundle + verifications to Supabase (`/api/sync/push`). Companion pulls race list and downloads bundle. Last-write-wins by `companion_revision`. Background queue with "waiting to sync" badge.

### 7. Ride

**Companion Race tab:** Next verified stop card, compact elevation profile (rider position + next stop), interactive map with Find Stops.

**Resupply tab:** "What happens next?" header, next verified stop card, timeline of **verified stops only** with distance/elevation gaps between stops.

Offline: bundle + GPX + verifications in IndexedDB after download/import.

### 8. Export to Coros

GPX export v3.0: original track + verified waypoints only (by default). Route integrity check (checksum, point count, distance, elevation). Smart naming, Coros `<sym>` icons (Water, Supplies, Supplies/Fuel, etc.). Priority tiers: Critical / Recommended / Optional. Preview before download.

---

## Current Features

### Analysis Engine

| | |
|---|---|
| **Purpose** | Turn GPX into structured route intelligence: distance, elevation, coordinates, bounds. |
| **Implementation** | `gpx_parser.py`, `pipeline.py`, SSE progress stream. Shared Collserola parity tests. |
| **Limitations** | Single-threaded per race; re-analysis blocks. Large races (800+ km) slow. Requires online server for companion import. |

### Climb Engine

| | |
|---|---|
| **Purpose** | Detect significant climbs; expose gradient stats (50 m–1 km windows) for preparation. |
| **Implementation** | `climb_detector.py`, `significant_climbs.py`. Surfaces on Dashboard, Climbs tab, bundle `climbs[]`, elevation overlays (dev mode). |
| **Limitations** | Climbs inform suggestions and unsupported risk; not exported as Coros waypoints. |

### Surface Engine

| | |
|---|---|
| **Purpose** | Classify paved vs gravel vs unknown from OSM; inform equipment and pacing context. |
| **Implementation** | `surface_detector.py`, Overpass fetch, route matching. Surface tab + timeline layers (dev mode). |
| **Limitations** | OSM coverage gaps in remote areas; unknown segments common. |

### POI Engine

| | |
|---|---|
| **Purpose** | Extract real-world POIs near the route from OpenStreetMap. |
| **Implementation** | `poi_detector.py`, `poi_types.py` with priority tiers. Active: P1 food/water (supermarkets, mini markets, gas, bakeries, drinking water) + P2 dining. P3 emergency (bike shops, pharmacies, ATMs) defined but disabled. |
| **Limitations** | 500 m route buffer. Opening hours often missing. Rural unnamed fountains scored lower. |

### Resupply Zones

| | |
|---|---|
| **Purpose** | Cluster nearby POIs into realistic stopping places (towns, service areas) — not fixed km windows. |
| **Implementation** | `resupply_zones.py` spatial union-find, merge radius 500 m, max zone diameter 2 km, orphan attachment rules. Zone cards show service summary (Food · Water · Fuel). |
| **Limitations** | Remote 40 km gaps correctly have zero zones. Zone naming uses km placeholders until rider verifies a named POI. |

### Resupply Intelligence / Suggested Stops

| | |
|---|---|
| **Purpose** | Select a curated list of stops from zones using spacing, unsupported gaps, climb context, and category scoring. |
| **Implementation** | `suggested_stops.py`, `resupply_intelligence.py`, `build_resupply_reason`. Gas/water/supermarket spacing rules; gap-fill before long unsupported sections; boost near climbs. |
| **Limitations** | Suggestions are heuristic; rider must verify. Scoring weights tunable but not exposed in UI. |

### Verification

| | |
|---|---|
| **Purpose** | Human trust layer on automated suggestions. |
| **Implementation** | `verified_stops` in race project; `saveVerifiedStop` API; readiness score in `shared/race/readiness.ts` (85% = READY TO RIDE). Companion offline verification queue syncs on reconnect. Desktop review panel + legacy StopVerificationPage (not primary tab). |
| **Limitations** | Readiness threshold fixed at 85%. Estimated review time ~30 s/stop. No merge UI for conflicting edits. |

### Find Stops (Discovery)

| | |
|---|---|
| **Purpose** | Rider-driven search for additional stops in a map region. |
| **Implementation** | `shared/race/discoverStops.ts`, `DISCOVERY_MAX_RESULTS = 10`, bounds-only, temp marker layer. `promoteDiscoverStop.ts` + `POST /api/races/{id}/promote-discovery`. Desktop + companion parity. |
| **Limitations** | Max 10 per search. Temps cleared on re-search. Requires POI data in analysis or bundle `discoverPois`. |

### Unsupported Sections

| | |
|---|---|
| **Purpose** | Highlight gaps between reliable resupply with risk bands and water/carb guidance. |
| **Implementation** | `unsupported_sections.py`, rider assumptions (speed, water ml/h, carbs g/h, max gap km). Low/Medium/High risk. |
| **Limitations** | Risk bands use defaults; configurable in settings but not per-race wizard. |

### Cloud Sync

| | |
|---|---|
| **Purpose** | Single source of truth across desktop and phone. |
| **Implementation** | Supabase (`profiles`, `races`, RLS, storage). `src/cloud/race_sync.py`, `/api/sync/*` endpoints. Bundle checksum + `companion_revision`. Google OAuth via Supabase. |
| **Limitations** | Last-write-wins. Push queued in background. Delete account clears local only — cloud deletion needs support. JWT required except localhost dev service-role fallback. |

### Companion (PWA)

| | |
|---|---|
| **Purpose** | Race-day execution: next stop, resupply timeline, map, offline bundle, optional field verification. |
| **Implementation** | React PWA, IndexedDB, MapLibre, tabs: Race · Resupply · Verify · Share · Account. `RaceScreen`, `NextVerifiedStopCard`, `GpxImportFlow`. |
| **Limitations** | Portrait-first. iOS Share Sheet → PWA unreliable. Map tiles not fully offline (1500 tile cache). No turn-by-turn navigation. |

### Coros / GPS Export

| | |
|---|---|
| **Purpose** | Get verified stops onto the bike computer without altering the route. |
| **Implementation** | `shared/race/gpsGpxExport.ts`, `src/race_gpx_export.py`, v3.0 integrity checks, `corosWaypointNaming`, priority assignment. Desktop dialog + companion Share tab. |
| **Limitations** | Coros icon mapping is best-effort. Max 500 m off-route for export. Garmin/Wahoo profiles exist; Coros is primary. |

### Mobile GPX Import

| | |
|---|---|
| **Purpose** | Analyse a route on iPhone without desktop. |
| **Implementation** | `POST /api/sync/import-gpx` SSE pipeline, fingerprint duplicate check, push to Supabase, cache locally. |
| **Limitations** | Requires deployed FastAPI (`ultra-roadbook-api` on Render). Cannot analyse offline on device. |

### Account System

| | |
|---|---|
| **Purpose** | Identity, sync, storage visibility, device connection hints. |
| **Implementation** | Google OAuth, Supabase profile, shared `accountDevices.ts`, sync-now, sign out. |
| **Limitations** | Google only in UI. Device "connected" is 30-day metadata heuristic, not live presence. |

### Readiness Dashboard

| | |
|---|---|
| **Purpose** | At-a-glance: is this race ready to ride? |
| **Implementation** | `computeReadiness` weights supermarkets, fuel, water, opening hours, unsupported gaps, verification %. Dashboard tab; cached in `dashboard_stats`. |
| **Limitations** | Fixed 85% threshold. Zero supermarkets on remote routes triggers warnings even if accurate. |

### Route Visualization (Desktop)

| | |
|---|---|
| **Purpose** | Inspect route spatially and vertically. |
| **Implementation** | Plan tab: MapLibre/Leaflet route map + elevation profile sync. Purple route, stop markers, discover layer. Premium `easeTo` focus (~150 m zoom) on POI select. |
| **Limitations** | Timeline, inspector, POI debug only in developer mode. Narrow sidebar (~380px) needs manual QA. |

### Developer Mode

| | |
|---|---|
| **Purpose** | Hide complexity from normal riders; keep power tools for debugging. |
| **Implementation** | `developer_mode_enabled` in settings. Unlocks timeline, climb debug, POI debug, detailed import steps. |
| **Limitations** | Not password-protected — setting only. |

---

## Architecture

Conceptual map — no code.

```
┌─────────────────────────────────────────────────────────────────┐
│                        DESKTOP (frontend/)                       │
│  Plan / Dashboard / Climbs / Surface / Unsupported / Resupply / Export │
│  Planning context · Verification UI · Coros export dialog        │
└────────────────────────────┬────────────────────────────────────┘
                             │ REST + SSE
┌────────────────────────────▼────────────────────────────────────┐
│                     BACKEND (src/ · FastAPI)                       │
│  pipeline.py · race_project.py · companion_bundle.py             │
│  suggested_stops · resupply_zones · sync routes · GPX export     │
└────────────┬───────────────────────────────┬────────────────────┘
             │                               │
┌────────────▼────────────┐    ┌─────────────▼────────────────────┐
│   CLOUD (Supabase)      │    │   SHARED (shared/)                 │
│   Auth · races table    │    │   Types · discoverStops · sync     │
│   Bundle storage · RLS  │    │   readiness · gpsGpxExport · etc.  │
└────────────┬────────────┘    └──────────────────────────────────┘
             │
┌────────────▼────────────────────────────────────────────────────┐
│                   PHONE (companion/ · PWA)                       │
│  IndexedDB offline · direct Supabase read · API for import       │
│  Race · Resupply · Verify · Share · Account                      │
└─────────────────────────────────────────────────────────────────┘
```

### Bundle generation

1. Analysis produces resupply zones, climbs, unsupported sections, POI datasets.
2. `suggested_stops` algorithm picks primary stops per strategic rules.
3. `companion_bundle.py` resolves zone primaries from **`suggested_stops`** (not raw ranked POI only).
4. Merges `verified_stops`, computes `resupplyReason`, dashboard stats, route coordinates + elevations.
5. Canonical JSON → SHA-256 `bundleChecksum` → schema version field → upload.

### Bundle schema (conceptual)

- **Identity:** `schemaVersion`, `bundleVersion`, `revision`, `bundleChecksum`, `generatedAt`
- **Race:** id, name, distanceKm, elevationGainM, analyzedAt
- **Route:** coordinates[], elevationsM[], bounds
- **stops[]:** zoneId, poiId, osmId, km, lat/lon, category, verificationStatus, openingHours, services flags, resupplyReason, alternatives[]
- **discoverPois[]:** full searchable POI set for Find Stops (optional)
- **climbs[]:** significant climbs with gradient stats
- **unsupportedSections[]:** gaps with risk, water/carb hints
- **dashboardStats:** readiness score, verified/unverified counts
- **riderAssumptions:** speed, water, carbs, max gap

### Sync pipeline

1. Desktop saves race project locally → pushes bundle + metadata to Supabase.
2. `companion_revision` monotonic increment per upload.
3. Companion lists races from Supabase → compares revision/checksum → downloads if newer.
4. Verifications: companion can queue offline → `POST /api/sync/verifications` → desktop reviews in verification updates panel.
5. Conflict: higher revision wins; no three-way merge.
6. **Self-healing:** `shared/sync/selfHealingBundle.ts` migrates local schema or triggers server `regenerate-bundle` when bundle is stale or incompatible.

**Field verification loop:** Companion Verify tab queues observations offline → `POST /api/sync/verifications` → desktop **Verification Updates** on Dashboard (accept/reject companion field reports).

### Coros export pipeline

1. Load original GPX bytes + current bundle.
2. Verify track fingerprint matches analysis (point count, distance, elevation, checksum).
3. Collect verified stops (and optionally high-confidence unverified if toggled).
4. Filter: real POI categories only, valid names, ≤500 m off-route, priority Critical+Recommended (Optional off by default).
5. Assign Coros sym icons and smart labels (brand + category rules).
6. Emit GPX: original `<trk>` unchanged + appended `<wpt>` elements.

---

## UX Philosophy

### One question per screen (v0.7)

Desktop workflow: **Import → Dashboard → Planning → Export → Sync → Ride**. Each
screen answers exactly one question; information is *moved* to the screen where it
belongs, never deleted:

- **Dashboard** → "What should I know before I start planning?" (high-level summary
  only). Slimmed in v0.7: the full Key Climbs section and the Export block were
  removed (the hardest climb still appears as a briefing highlight for context).
- **Planning** → "Where should I stop?" · **Climbs** → "Which climbs matter?" ·
  **Surface** → "What terrain will I ride?" · **Resupply** → "What happens next?"
  - Planning tightened in v0.7: selecting a climb no longer takes over the plan
    map with the full `ClimbDetailView`. Climbs remain visible/highlightable on the
    map + elevation profile as *context* for stop placement; the full climb detail
    lives on the **Climbs** tab (moved, not removed).
- **Export** → "Is my device ready?" — now its **own tab/screen** (`ExportPage`),
  no longer buried in the Dashboard footer. Tab bar: Plan · Dashboard · Climbs ·
  Surface · Unsupported · Resupply · Export.

### Workflow simplification (v0.5)

- **No planning modes** at import. Removed Minimal/Balanced/Detailed pickers.
- **No separate Verify tab** on desktop tab bar. Verify/Skip lives in **Plan** tab review panel. Legacy `StopVerificationPage` still reachable from Dashboard for batch/deep review.
- **Companion still has Verify tab** for race-day field checks (offline queue).
- **Default tab after import: Plan** (internal id `route`), not Dashboard — changed in v0.5 (v1.0 RC docs are stale).
- **Import → Analyzing… → Ready** — single progress bar for riders.

### Stop states

| State | Meaning | Map | Resupply list | Coros export |
|-------|---------|-----|---------------|--------------|
| **Suggested** | Algorithm recommends; not yet reviewed | Visible | Visible (desktop) | No |
| **Verified** | Rider committed | Highlighted | Yes | Yes (default) |
| **Skipped/Rejected** | Rider declined | Hidden | No | No |
| **Discovered (temp)** | Find Stops candidate | Grey/blue temp markers | No until promoted | No until verified |

### Find Stops UX

- **Temporary layer** — not part of plan until verified.
- **Max 10** results per visible-bounds search.
- **Re-search clears** previous temporary markers.
- **Verified discoveries persist** via promote into `suggested_stops`.
- **Skipped discoveries disappear** from map.

### Maps

- **Simple, purposeful.** Purple route. Selected stop > alternatives > suggested > temp discover.
- **Premium focus animation** — ~1 s `easeTo` at street level (~150 m, zoom ~18.2) on stop select. `map.stop()` before animate to prevent glitches.
- **Street View** opens at POI coordinates with nearest panorama search — not place photos or wrong locations.

### Lists vs timelines

- **Resupply timeline** (companion) shows verified stops with distance + elevation gaps — not an exhaustive POI dump.
- **Race page focuses on next verified stop** — not the full route inventory.

### Delete UX

- Safe delete: hold/swipe or typed confirmation — no destructive one-click.
- Simpler confirmation flow (no typing race name required on companion).

### Complexity budget

- Elevation timeline, route inspector, POI/climb debug → **developer mode only**.
- Dashboard remains for readiness overview; **Plan is the work surface**.

### Visual identity

- Desktop: light canvas, ink typography, accent highlights.
- Companion: dark `#0a0a0a`, purple route, sky/orange nav accents.
- Shared design tokens in `shared/` and `companionMapTheme.ts`.

### Page guardrails (from VISION.md)

Every page answers one question. If a component does not help the rider leave with that knowledge, it belongs elsewhere (companion, dev mode, or cut).

---

## Important Feedback History

Decisions distilled from product conversations and iteration — preserve these when suggesting features.

### Resupply & POI preferences

- **Gas stations preferred over fountains** for reliability — cold sugary drinks, food, shelter, certainty of being open. Fountains still scored but lower; unnamed fountains penalised.
- **Priority 1 POIs only** for core roadbook: mini/supermarkets, drinking water, gas, bakeries. Dining (P2) included; emergency POIs (P3) deferred.
- **Close beats big** — a nearby mini market can outrank a distant hypermarket (detour penalty in scoring).
- **Resupply zones are spatial clusters** (towns), not fixed 2 km windows. A Lidl + bakery + fountains + gas in one town = one zone.
- **Last stop before long unsupported/climb is usually best** — gap-fill and `resupplyReason` mark critical stops; Coros export assigns Critical priority for "last", "before climb", "no water for", etc.
- **Only verified POIs should export** by default. Suggestions alone never land on Coros.
- **Real POI names on GPS** — smart naming strips generic "Stop 3", "Fuel station 2", road names. Brand + category when name weak.

### Route & export integrity

- **Route must never change.** Export cancelled if track modified. User feedback drove v3.0 integrity checks.
- **Street View must open the actual POI** at lat/lon with panorama fallback — not Google Place center photos.

### Desktop ↔ Companion parity

- **Desktop and Companion must always match** on stop lists, verification state, and bundle checksum.
- **Discovered stops are temporary** until verified and promoted.
- **Verified discoveries remain** in `suggested_stops` and sync.
- **Only 10 temporary discoveries** per search — keeps map readable.
- **Resupply list uses primary `bundle.stops`** from suggested_stops — not only `nearbyAlternatives` (bug fixed Jul 2026).

### Workflow feedback

- **Intelligent resupply planner, NOT GPX editor** — repeated in v0.3/v0.5 overhauls.
- **Software recommends, rider reviews** — no auto-verification.
- **Reduce settings and clutter** — planning modes removed, import simplified.
- **Water usually more important than food** — encoded in unsupported guidance and scoring.
- **Trust over quantity** — fewer suggested stops with reasons beats 200 POI rows.

### Cloud & platform

- **Moved from local-only (v0.6) to cloud-only** — Supabase Phase 1. LAN/USB sync explicitly not pursued.
- **Mobile import needs deployed API** — companion reads Supabase directly but analysis requires Render/FastAPI.
- **Original vision: companion does not re-analyse** — still true; companion runs analysis only via server import endpoint, not on-device engine.

### UX polish requests

- Premium map focus on POI select (purple route, ~150 m context in stop detail sheet).
- Simpler race delete (hold/swipe vs typing full race name).
- Fade-up animations on import/race entry.
- "What happens next?" framing on resupply screen.

---

## Decisions We Explicitly Rejected

| Rejected | Why |
|----------|-----|
| **LAN / local sync** | Cloud-only simplifies conflict model, enables phone import anywhere, one account truth. USB/LAN adds pairing UX without ultra-scale benefit. |
| **Community verification** | Trust is personal pre-race judgment, not crowdsourced. Would dilute verification meaning and add moderation burden. |
| **Planning modes (Minimal/Balanced/Detailed)** | False choice — rider should not pick algorithm personality. One tuned suggestion engine; rider verifies. Removed in v0.5. |
| **Resupply hubs (synthetic map markers)** | Only real OSM POIs. Hubs as abstract markers confused export and Coros. Zones are analytical grouping; map shows real places. |
| **GPX route editing** | Sacred original track. App analyses, never redraws. |
| **Turn-by-turn navigation** | Not a bike computer. Companion executes plan, not discovers route. |
| **Activity recording / social** | Not Strava. Focus is ultra planning + execution. |
| **Fixed 2 km decision windows** | Replaced by spatial resupply zone clustering early in development. |
| **Exporting climbs/unsupported as waypoints** | GPS clutter; excluded by category filters. |
| **On-device analysis engine (companion)** | Python pipeline too heavy for phone; server-side import with offline cache instead. |
| **Persistent POI tables for riders** | POI tab/engine exists for analysis; rider-facing UI is zones → suggestions → verification. |
| **Stages generator (so far)** | Deferred repeatedly until resupply workflow excellent. Settings retain `preferred_stage_length_km` for future use. |

---

## Current Known Bugs

> **Live bug tracker: [`KNOWN_ISSUES.md`](KNOWN_ISSUES.md).** As of v0.7 that file
> is the source of truth for open/fixed issues (with priority, status, fixed
> version, deferred reason). The table below is retained for historical context.

### Release Hardening (v0.7) — reliability batch fixed

- **Offline bundle no longer wiped by a newer cloud revision** — race-list refresh
  keeps the working offline copy and only surfaces the update (RH-01).
- **Background sync skips the active race** — never swaps a bundle out from under a
  rider mid-execution (RH-02).
- **Screen Wake Lock** during race execution (RH-03).
- **Windowed map matching** — no backward snap on loops / out-and-backs (RH-04).
- **GPS status visible on Map tab** (RH-05).
- **Destructive dev "Reset cache" gated** behind a hidden reveal (RH-06).
- **Server GPX upload size cap** (60 MB, chunked read) (RH-07).

Still open before release: public-API multi-tenant isolation (KI-01), checksum
fail-closed on download (KI-02), physical-device QA (KI-05), live Render API
verification (KI-06). See `KNOWN_ISSUES.md`.

### Final Release Audit (v0.7) — fixed

- **Offline open lockout removed** — a downloaded race now opens offline even when
  Desktop pushed a newer revision; falls back to the local bundle on download
  failure (FA-01, was the one true race-day blocker in-app).
- **Cross-race verification corruption fixed** — pending verifications are grouped
  by race before the direct-Supabase write (FA-02).
- **Hidden map no longer animates** — GPS-follow/focus camera work is gated on tab
  visibility; no background moveend/bounds re-render cascade (FA-03).
- **Dead `route-arrows` map source removed** (FA-04).

The only remaining hard release gate is external: **deploy + verify the Render
analysis API (KI-06)** for in-app Companion import — or avoid it entirely by
importing on Desktop and downloading in the Companion. Full breakdown and scores in
[`RELEASE_REPORT.md`](RELEASE_REPORT.md); manual gate in
[`RELEASE_CHECKLIST.md`](RELEASE_CHECKLIST.md).

| Bug | Cause (if known) | Priority | Status |
|-----|------------------|----------|--------|
| Branch 2 commits ahead of origin (`b7b9036`, `ab11ee3`) | Not pushed | Low | Open |
| Desktop undo verify when no `activeRaceId` | Offline/edge race context | Medium | Needs QA |
| Narrow desktop Plan sidebar (~380px) | New split layout | Low | Needs QA |
| E2E verify → sync → Coros on real race | Manual QA gap | High | Not fully tested |
| Companion race screen with live GPS | Manual QA gap | Medium | Not fully tested |
| Duplicate GPX import dialog on companion | Needs real duplicate file test | Low | Not tested |
| TS sync tests blocked locally (`npm ECOMPROMISED`) | npm lock integrity in sandbox | Low | Skipped on Vercel by design |
| Conflict resolution UI | By design last-write-wins | Medium | Known limitation |
| Delete account cloud purge | Not implemented | Medium | Local clear only |
| Large races slow dashboard/map | No lazy splitting | Medium | Known limitation |
| iOS Share Sheet → PWA import | iOS PWA limitation | Low | Documented workaround (Files picker) |
| Map tiles not fully offline | 1500 tile cache cap | Medium | Known limitation |
| Opening hours stale/missing | OSM data quality | Medium | Ongoing |
| Readiness warns on zero supermarkets for remote routes | Fixed threshold logic | Low | By design, may feel harsh |

---

## Current Priorities

### Build next (ordered)

1. **Push + tag v0.5** — sync `feature/coros-export-v3` to origin; tag release.
2. **E2E QA: verify → sync → Coros** on a real ultra route (Collserola or race GPX).
3. **Production API for mobile import** — ensure Render `ultra-roadbook-api` matches desktop analysis parity.
4. **Narrow viewport polish** — Plan tab at 380px sidebar width.
5. **Offline edge cases** — undo verify without active race; checksum mismatch recovery UX.

### Do NOT build yet

- Stage generator / balanced stage planner
- Route flythrough film (backlog in VISION.md)
- Community features, segments, social
- LAN sync, peer transfer, USB export workflows
- GPX route editing, re-routing, course creation
- Turn-by-turn navigation, live recording
- Planning mode toggles or algorithm pickers
- New POI categories (P3 emergency) until resupply loop proven in field
- PDF roadbook export (mentioned as later in early vision)

---

## Roadmap

### v0.3 (shipped)

- Mobile analysis engine & cloud reconciliation
- Find Stops bounds discovery (desktop + companion)
- Discovery verify → promote into route plan
- Resupply list honors `suggested_stops`
- UX overhaul: review panel, Race screen, simplified import
- Tag: `v0.3` (companion analysis milestone)

### v0.4 (shipped incrementally on branch)

- Coros GPX export v3.0 (integrity, smart naming, preview)
- Street View POI coordinate fix
- Cloud sync reliability (session refresh, false failure fix, stale bundle detection)
- Premium race list design system
- Safe delete UX, map focus polish

### v0.5 (shipped — current)

- **Desktop 0.5.0 · Companion 0.5.0**
- Resupply-first workflow: Plan tab primary, suggested stops review panel
- No planning modes; import → analyze → ready
- Companion Race + Resupply focus on next verified stop
- Developer mode gates debug panels
- Production: https://companion-flax.vercel.app

### Long-term vision

- **Active Race mode (proposed v1.0 north star — do NOT build yet)** — Today the
  Companion is still a set of tabs (Map / Resupply / Verify / Share). During an
  actual ultra the rider isn't thinking in tabs; they're thinking *"I'm riding this
  race."* v1.0 should evolve toward a single **Active Race session** where
  everything revolves around the current ride, and the tabs become *tools within*
  that session rather than separate destinations. Sketch:

  ```
  THE CAPITALS · 823 km
  ─────────────────────
  Next verified stop   ↓
  Next climb           ↓
  Current unsupported gap
  ─────────────────────
  Quick actions: Map · Street View · Google Maps · Verify · Search stops · Export
  ```

  This makes Ultra Roadbook feel less like "an app with multiple pages" and more
  like "a dedicated race companion," which aligns with this document's core vision
  (a calm, trusted co-pilot for the ride). Deferred intentionally: the current
  architecture is still being polished (persistent map, consistent sheets, haptics)
  and that groundwork — a live map that survives navigation, one shared sheet
  primitive, a single `CompanionContext` for the open race — is exactly what an
  Active Race session would sit on top of.
- **Stages** — balanced stage breaks using verified resupply anchors (`preferred_stage_length_km` in settings reserved)
- **PDF roadbook** — printable export alongside Coros
- **Route flythrough** — cinematic pre-race briefing film (VISION.md backlog); POC in `tools/route-preview-poc/`, linked from Dashboard, not a main tab
- **Field verification loop** — companion queue → desktop review (partially built)
- **Single tool for entire ultra prep** — no Komoot + spreadsheets + custom GPX hacks
- **Companion as pure execution** — next stop, timeline, offline trust (approaching this now)

---

## Changelog

| Date | Milestone |
|------|-----------|
| 2026-07 | **Companion v0.3 Race Library & Sync UX** — clean home screen, invisible background sync with toast, fix stuck updates loop, direct Supabase delete, mobile GPX share/import |
| 2026-07 | **Companion nav & home** — race library always on launch, back-to-library header + tab, simplified cards, swipe/long-press delete |
| 2026-07 | **Dev environment** — `./start`, `./stop`, `./restart`, `./doctor` one-command workflow |
| 2026-07 | **Companion mobile polish** — stable stop-detail mini map, safe-area insets, 44px touch targets |
| 2026-07 | **v0.5 UX** — Plan-first desktop, Race screen, next-stop resupply, simplified import |
| 2026-07 | **Find Stops** — bounds discovery, 10 temp max, promote on verify |
| 2026-07 | **Discovery fix** — verified discoveries persist to `suggested_stops` + resupply list |
| 2026-07 | **Mobile import** — server-side GPX analysis on companion |
| 2026-07 | **Coros export v3** — route integrity, waypoint priority, preview |
| 2026-07 | **Cloud Phase 1** — Supabase auth, sync, bundle storage |
| 2026-07 | **v1.0 RC** — readiness dashboard, verification queue, account parity |
| 2026-06 | **Resupply zones** — spatial clustering replaces km windows |
| 2026-06 | **POI engine** — OSM extraction with priority tiers |
| 2026-06 | **v0.6 app** — React desktop shell, FastAPI backend |
| 2026 (early) | **CLI milestones** — GPX parse, climbs, surface, Excel export |

---

## Local Development

**One command:** `./start` — starts everything, opens browsers, enables auto-recovery.

| Command | Purpose |
|---------|---------|
| `./start` | Start backend (:8000), Desktop (:5173), Companion (:5175) if not already running; open both in browser; start crash watcher |
| `./stop` | Stop all managed dev processes cleanly |
| `./restart` | `./stop` then `./start` |
| `./doctor` | Diagnose ports, API, Supabase env, dependencies |

**URLs:** Desktop `http://127.0.0.1:5173` · Companion `http://127.0.0.1:5175` · API `http://127.0.0.1:8000/api/health`

**Behaviour:**
- Skips services already running (no duplicate instances)
- Logs in `.run/` (gitignored): `backend.log`, `frontend.log`, `companion.log`, `watcher.log`
- Background watcher restarts backend or Vite if a managed process exits unexpectedly
- Legacy: `run_dev.sh` and `launcher/launch.sh` delegate to `./start`

**Setup:** Copy `.env.example` → `.env`, `frontend/.env.local`, `companion/.env.local`. Run `./doctor` if cloud sync fails.

---

## Advice For Future ChatGPT Sessions

You are helping build **Ultra Roadbook** — not a generic fitness app.

### Before suggesting anything, remember:

1. **Product type:** Intelligent resupply planner for ultra cyclists. NOT a GPX editor, NOT a bike computer, NOT Strava.

2. **Current version:** 0.5.0 desktop + companion. Primary workflow: Import → Analyze → Plan (review/verify) → Find Stops → Sync → Race → Coros.

3. **Architecture:** Python FastAPI analysis engine · React desktop · React PWA companion · Supabase cloud · shared TypeScript in `shared/`. Bundle is the contract between all surfaces.

4. **Sacred rules:** Original GPX never modified. Only verified real-world POIs export. Desktop plans, phone executes. Cloud-only sync.

5. **UX bias:** Remove decisions, don't add settings. One path. Premium calm UI. Next verified stop on race day. Temporary discover layer, permanent verify.

6. **Stop lifecycle:** Suggested → Verified or Skipped. Discovered temps → promote → verify. Never auto-verify.

7. **Things to avoid proposing:** LAN sync, community verification, planning modes, resupply hub markers, route editing, navigation, social features, POI dumps for riders, exporting analysis artifacts to GPS.

8. **Scoring intuition:** Gas > anonymous fountain. Close > big. Last stop before gap/climb = critical. Water > food in unsupported logic.

9. **Key files:** `src/pipeline.py`, `src/companion_bundle.py`, `src/suggested_stops.py`, `shared/race/discoverStops.ts`, `shared/race/gpsGpxExport.ts`, `frontend/.../SuggestedStopsReviewPanel.tsx`, `companion/.../RaceScreen.tsx`.

10. **Deploy:** `vercel --prod --yes` from **repo root** (not `companion/`). **Local dev:** `./start` only. Mobile import needs `VITE_API_BASE_URL` on Vercel.

11. **Testing:** Python sync tests are authoritative; TS tests may skip on Vercel or npm lock issues locally. Collserola parity tests guard analysis consistency.

12. **When unsure:** Read this file first. Prefer extending existing bundle/sync/export pipelines over new parallel systems. Ask before adding backend analysis changes — engine was declared stable unless explicitly requested.

### Maintenance instruction

When you complete a significant change, **update this document**: add to Changelog, adjust Current Features / Known Bugs / Priorities, record new Feedback History or Rejected decisions if applicable. Keep prose concise. Never delete historical decisions — strike through or move to Rejected if reversed.

---

## Key Paths (quick reference)

| Area | Path |
|------|------|
| This file | `PROJECT_BRAIN.md` |
| Vision (historical) | `VISION.md` |
| Limitations | `KNOWN_LIMITATIONS.md` |
| Cloud setup | `docs/CLOUD_SETUP.md` |
| Mobile import | `docs/MOBILE_GPX_IMPORT.md` |
| Backend API | `src/server.py`, `src/pipeline.py` |
| Bundle build | `src/companion_bundle.py`, `src/suggested_stops.py` |
| Cloud sync | `src/cloud/race_sync.py` |
| Coros export | `src/race_gpx_export.py`, `shared/race/gpsGpxExport.ts` |
| Find Stops | `shared/race/discoverStops.ts`, `shared/race/promoteDiscoverStop.ts` |
| Bundle contract | `shared/sync/bundleContract.ts`, `shared/types/sync.ts` |
| Desktop Plan UI | `frontend/src/components/route-workspace/RouteWorkspace.tsx`, `SuggestedStopsReviewPanel.tsx` |
| Companion Race | `companion/src/screens/RaceScreen.tsx`, `NextVerifiedStopCard.tsx` |
| Supabase schema | `supabase/migrations/001_phase1.sql` |
| Local race data | `data/races/{id}/` |
| Dev workflow | `./start`, `./stop`, `./restart`, `./doctor`, `launcher/` |

---

*Last updated: July 17, 2026 — dev environment overhaul (`./start` workflow).*
