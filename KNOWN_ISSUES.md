# Known Issues

Single source of truth for bugs, risks, and deferred work. Every issue has a
**Priority**, a **Status**, and either a **Fixed in** version or a **Deferred
reason**. Nothing gets lost.

Priority: **P0** = blocks release / can break trust mid-race · **P1** = important
before App Store · **P2** = quality / polish · **P3** = nice-to-have.

Status: `open` · `in-progress` · `fixed` · `deferred` · `wontfix`.

---

## Fixed in v0.7 "Release Hardening"

### RH-01 — Newer cloud revision wiped the offline bundle
- **Description:** When the cloud `companion_revision` advanced, the companion
  race-list refresh deleted (`invalidateStaleBundle`) the working offline bundle
  and marked the race as "needs download". A rider at an aid station with signal
  could lose their offline route until a re-download completed — catastrophic if
  connectivity then dropped.
- **Priority:** P0 · **Status:** fixed · **Fixed in:** v0.7
- **Fix:** `resolveOfflineReady` now keeps the downloaded bundle openable offline
  and only surfaces the update via the revision mismatch. Bundles are still
  invalidated when genuinely missing/corrupt.

### RH-02 — Background sync could swap the active race's bundle
- **Description:** `useAutoCloudSync` auto-downloaded updated bundles in the
  background, including for the race the rider currently had open, changing data
  under them mid-execution.
- **Priority:** P0 · **Status:** fixed · **Fixed in:** v0.7
- **Fix:** Background auto-download now skips the active race
  (`liveBundleRef.current`). The in-race update banner still lets the rider apply
  it deliberately.

### RH-03 — Screen slept during race execution
- **Description:** No Screen Wake Lock, so the phone screen slept mid-ride and
  the rider lost the live map/next-stop glance.
- **Priority:** P1 · **Status:** fixed · **Fixed in:** v0.7
- **Fix:** `useWakeLock` acquires a screen wake lock while a race is open and
  re-acquires it on visibility change. Non-fatal on unsupported devices.

### RH-04 — Map matching snapped backward on loops / out-and-backs
- **Description:** `matchPositionToRoute` did a global nearest-point search, so on
  self-intersecting routes (loops, lollipops, out-and-backs) GPS could snap to a
  spatially-overlapping segment at a different distance, jumping `currentKm`
  backward or forward.
- **Priority:** P1 · **Status:** fixed · **Fixed in:** v0.7
- **Fix:** Matching now prefers candidates within a km-window around the last
  known position (2 km back / 6 km ahead), falling back to a global search for the
  first fix or when rejoining after leaving the route.

### RH-05 — GPS status only visible on the Resupply tab
- **Description:** The GPS status badge (Acquiring/Active/Degraded/Lost/Denied)
  only rendered on Resupply; on the Map tab the rider had no signal on whether
  position tracking was healthy.
- **Priority:** P1 · **Status:** fixed · **Fixed in:** v0.7
- **Fix:** The execution header (km + GPS badge) now also shows on the Map tab.

### RH-06 — Destructive dev tool exposed to riders
- **Description:** "Reset Local Race Cache" (wipes IndexedDB + bundles + SW
  caches) was always visible in Account → Developer. A mis-tap could delete all
  offline races with no confirmation.
- **Priority:** P1 · **Status:** fixed · **Fixed in:** v0.7
- **Fix:** The Developer section is hidden until the version row is tapped 7×
  (reveal resets on reload).

### RH-07 — No server-side GPX upload size limit
- **Description:** All GPX upload endpoints did `await file.read()` with no cap,
  reading arbitrarily large uploads fully into memory (DoS / OOM risk on the
  public API).
- **Priority:** P1 · **Status:** fixed · **Fixed in:** v0.7
- **Fix:** `_read_gpx_upload` streams in 1 MB chunks with a 60 MB hard cap
  (413 on exceed) and checks the size hint up front.

---

## Fixed in v0.7 RC hardening

### RH-08 — Persistent map created a duplicate hidden stop sheet on Resupply
- **Description:** After keeping the map alive across tabs (KI-08), `RaceScreen`
  stayed mounted while hidden. Both `RaceScreen` and `ResupplyScreen` render a
  `StopSheet` bound to the shared `selectedStop`, so selecting a stop on Resupply
  spun up a second, hidden `StopSheet` — including a duplicate `StopDetailMap`
  MapLibre mini-map and a duplicate Street View metadata fetch.
- **Priority:** P2 · **Status:** fixed · **Fixed in:** v0.7 RC
- **Fix:** `RaceScreen` takes an `active` prop (`tab === "map"`) and only renders
  its stop/climb sheets when the Map tab is actually visible.

### RH-09 — Debug logging shipped to production consoles
- **Description:** `logStreetViewDebug` (every stop view), `logSyncDebug` (every
  sync stage), `raceOpenTrace` and a RoutePreview mount log wrote to the console
  unconditionally.
- **Priority:** P3 · **Status:** fixed · **Fixed in:** v0.7 RC
- **Fix:** All are gated to `import.meta.env.DEV`; the sync ring buffer (in-app
  log) is retained. Removed the RoutePreview mount log.

---

## Fixed in v0.7 final release audit

### FA-01 — Offline open blocked when a newer cloud revision existed
- **Description:** `HomeScreen.handleOpenRace` treated any `companion_revision >
  downloadedRevision` as a mandatory re-download and never fell back to the
  already-downloaded bundle. A rider who downloaded a race, then had Desktop push
  an update, then went offline (airplane mode / no signal at the start line) could
  not open a race they had fully downloaded — a race-day lockout.
- **Priority:** P0 · **Status:** fixed · **Fixed in:** v0.7 audit
- **Fix:** Opening now prefers the working offline copy when the update can't be
  fetched (offline or no session), and falls back to the local bundle if the
  update download fails. Updates are still downloaded when online with a session.

### FA-02 — Multi-race verification batch applied to the wrong race
- **Description:** In the production companion (direct-to-Supabase path, no API
  server), `submitCompanionVerifications` sent *all* pending verifications to
  `submissions[0].raceId`. If a rider verified stops in race A and race B before a
  sync, race B's verifications were written onto race A's cloud row — silent data
  corruption of the exported/prepared stops.
- **Priority:** P1 · **Status:** fixed · **Fixed in:** v0.7 audit
- **Fix:** The direct path now groups pending submissions by `raceId` and calls
  `submitCompanionVerificationsDirect` once per race, aggregating accepted ids.

### FA-03 — Hidden persistent map kept animating the GPS camera
- **Description:** After KI-08 the map stays mounted (hidden) across tabs. Its
  GPS-follow and focus `easeTo` animations still ran on every fix while the rider
  was on Resupply/Verify, moving the hidden camera, firing `moveend`→bounds
  callbacks and re-rendering the tree — wasting GPU/battery mid-ride.
- **Priority:** P2 · **Status:** fixed · **Fixed in:** v0.7 audit
- **Fix:** `RouteMapView` takes a `visible` prop (`tab === "map"`); both camera
  animations are skipped when hidden and re-apply on return to the map, so no
  moveend/bounds cascade fires in the background.

### FA-11 — Street View opened the wrong place / faced the wrong way
- **Description:** Two independent defects, both in `shared/race/streetViewUrl.ts`,
  made Street View diverge from the (correct) Google Maps link:
  1. **Wrong location.** `computeStreetViewApproach` set the pano `viewpoint` to
     `interpolateTrackAtKm(track, stop.km)` — a point snapped onto the GPX route,
     not the POI. Google's `map_action=pano&viewpoint=` shows the panorama *closest
     to the viewpoint*, so for off-route resupply stops it opened a panorama near
     the road, i.e. the wrong place. (Google Maps hid this because it uses the POI
     coords / `place_id`.)
  2. **Wrong direction / unrelated imagery.** The URL always forced a `heading`
     computed from that route point. Per the Google Maps URLs API, if `heading` is
     omitted Google auto-orients the camera toward the viewpoint from the panorama
     it actually snaps to. Forcing a route-derived heading overrode that and could
     point the camera away from the POI (walls, opposite side, etc.).
  There is no `VITE_GOOGLE_MAPS_API_KEY` in any environment and the Street View
  Static *metadata* endpoint is CORS-blocked from browsers, so the metadata/pano
  path never runs client-side — production always used this single, doubly-wrong
  fallback URL.
- **Priority:** P0 (trust / release blocker) · **Status:** fixed · **Fixed in:** v0.7 audit
- **Fix:** The fallback Street View URL is now `map_action=pano&viewpoint=<POI>`
  with **no forced heading** — byte-identical coordinates to the Google Maps link,
  and Google auto-faces the POI from whatever panorama it snaps to. A heading is
  only set on the metadata path (`buildStreetViewUrlFromPanorama`) where the real
  panorama location is known, and that path also pins the official `pano=` id.
  Metadata is searched from the POI itself (never a route point). Added a
  regression test (`shared/race/streetViewUrl.test.ts::testMapsAndStreetViewUseIdenticalCoordinates`)
  asserting Maps and Street View use identical coordinates for on-route, off-route,
  southern-hemisphere and place-id stops. Removed the stale, broken
  `scripts/test_street_view_url.mjs`.
- **Remaining limitation (documented, not a regression):** where a POI has no
  nearby official Street View coverage, `viewpoint` can still snap to a distant
  panorama or a user photo-sphere. Eliminating that requires the Street View
  metadata API with `source=outdoor` to confirm coverage and pin the official
  pano — which needs an API key **and** a server-side proxy (browser CORS blocks
  the metadata call). Recommended as the v1.0 robust follow-up. For race day the
  Google Maps link remains the guaranteed-correct fallback.

### FA-04 — Dead `route-arrows` GeoJSON source built on every map init
- **Description:** `RouteMapView` added a `route-arrows` source (a full O(n)
  `buildRouteArrowPoints` pass) that no layer ever referenced — direction chevrons
  use the `route` source with `symbol-placement: line`.
- **Priority:** P3 · **Status:** fixed · **Fixed in:** v0.7 audit
- **Fix:** Removed the unused source and its builder (`routeDirectionArrows.ts`),
  saving one full-track pass and a GeoJSON source on every map load.

---

## Open / Deferred

### FA-05 — No offline access to downloaded races without a cached session
- **Description:** Any `session === null` (sign-out, refresh-token expiry after a
  long offline stint, first install offline) forces the Welcome screen and clears
  the active bundle, even though downloaded races live in IndexedDB and can be read
  without a token.
- **Priority:** P1 · **Status:** open
- **Notes:** Fix would add a read-only "open downloaded races offline" path when
  `offlineReady` races exist and there is no session. Deferred from the audit as it
  touches the auth/gate flow (`App.tsx`) and needs on-device testing — higher
  regression risk than the race is worth. Mitigation: keep the app installed and
  signed in before race day (see RELEASE_CHECKLIST).

### FA-06 — Import SSE final buffer not flushed
- **Description:** `parseImportStream` processes events as chunks arrive but does
  not flush the trailing `buffer` after the reader completes, so a final `complete`
  event delivered in the last packet can be missed.
- **Priority:** P2 · **Status:** open
- **Notes:** Low-risk one-line fix (flush buffer after the loop) but only exercises
  the Render-import path, which is itself gated on KI-06. Deferred until import is
  live and can be re-tested end to end.

### FA-07 — Long imports may hit the Vercel proxy timeout
- **Description:** Companion import streams SSE through the Vercel `/api` rewrite to
  Render. Very long analyses (800–2000 km) risk hitting a proxy timeout.
- **Priority:** P1 · **Status:** open
- **Notes:** Mitigation: import the race on Desktop and let it sync to the
  companion (recommended flow anyway). Consider calling Render directly for import
  via `VITE_API_BASE_URL` once the service is deployed (KI-06).

### FA-08 — Post-import cloud-push warning is never shown
- **Description:** When analysis succeeds but the cloud push fails, the import emits
  a `sync_warning`; the flow then unmounts on completion before the warning paints,
  so the rider isn't told the race is local-only. There is also no companion action
  to re-push a failed local import.
- **Priority:** P2 · **Status:** open
- **Notes:** Surface the warning via the Home sync toast and add a "Sync to cloud"
  action for `source: "local-import"` races not present in the cloud. Deferred;
  local offline use is unaffected.

### FA-09 — Verification sync uses a non-refreshed token and fails silently
- **Description:** `useVerificationSync` submits with the raw `session.access_token`
  (not `getFreshAccessToken`) and, on failure, only writes a debug log. The pending
  queue is retained (no data loss) but the rider gets no "will sync when online"
  feedback and there's no proactive retry on token refresh.
- **Priority:** P2 · **Status:** open
- **Notes:** Data is safe (queue persists; API path already retries 401). UX-only
  gap. Deferred to avoid touching the sync path pre-race.

### FA-10 — Cloud verification updates use last-write-wins with no CAS
- **Description:** `submitCompanionVerificationsDirect` reads the race row, patches
  preparation, and writes `companion_revision + 1` with no compare-and-set.
  Concurrent updates from two devices / Desktop can overwrite each other.
- **Priority:** P2 · **Status:** open
- **Notes:** Real for multi-device, unlikely for a single rider. A compare-and-set
  update (`WHERE companion_revision = ?` + merge/retry) is the fix. Deferred:
  schema/flow change, needs testing.

### KI-07 — Haptics are a no-op on iOS Safari / installed PWA
- **Description:** The companion haptics utility (`companion/src/lib/haptics.ts`)
  uses the Web Vibration API, which iOS Safari and installed PWAs do not
  implement. Haptic feedback therefore fires on Android but is a graceful no-op
  on iPhone — the actual target device.
- **Priority:** P3 · **Status:** open
- **Notes:** No reliable web API for iOS haptics today. Utility is centralized so
  it "just works" if/when support arrives, or if wrapped natively later.

### KI-08 — Companion Map tab remounts (map re-init) on every tab switch
- **Description:** The companion workspace rendered tab content with `key={tab}`,
  so returning to the Map tab tore down and recreated the MapLibre instance,
  costing time and a visible flash mid-race.
- **Priority:** P2 · **Status:** fixed (v0.7)
- **Fix:** `RaceScreen` (map) now stays mounted for the entire race session and is
  hidden with `visibility` (not `display:none`) when another tab is active, so its
  layout box — and the MapLibre canvas size — is preserved. Zoom/bearing/pitch,
  loaded tiles, route rendering, GPS position and the selected stop all persist,
  and return to the map is instant with no white frame. `RouteMapView` also gained
  a `ResizeObserver` so the canvas re-fits when the header height changes between
  tabs (Execution header is only on Map/Resupply) — the resize happens while
  hidden, so there is no reflow flash on show.
- **QA:** Final confirmation is on-device — switch Map ↔ Verify ↔ Resupply mid-ride
  and confirm the map keeps position/tiles and returns instantly.

### KI-09 — StopDetailSheet lacks visible-state enter/exit + drag-to-dismiss
- **Description:** The verification `StopDetailSheet` was mounted conditionally
  (no exit animation, no drag-to-dismiss) unlike the shared `BottomSheet`.
- **Priority:** P3 · **Status:** fixed (v0.7)
- **Fix:** Migrated `StopDetailSheet` onto the shared `BottomSheet`. It self-manages
  an `open` flag and defers the parent `onClose` until after the exit animation, so
  it now has the same iOS spring enter/exit, drag-to-dismiss, backdrop and grab
  handle as every other sheet. Removed the bespoke `.stop-detail-sheet*` CSS.



### KI-01 — Public API multi-tenant isolation for local planning endpoints
- **Description:** The `/api/races/*` local planning endpoints use a filesystem
  race store with an optional user and no per-user ownership checks. Safe for the
  single-user desktop app, but if the same server is exposed publicly it is not
  multi-tenant safe. The sync endpoints (`/api/sync/*`) do require a user.
- **Priority:** P0 (if planning endpoints are ever public) · **Status:** open
- **Notes:** Needs a design decision: run desktop planning strictly local, and
  have the public Render API expose only `/api/sync/*` + import + health (e.g. via
  a `CLOUD_API` mode flag). Not changed this batch to avoid breaking desktop.

### KI-02 — Bundle checksum self-heal accepts recomputed checksum
- **Description:** On checksum mismatch the client recomputes and accepts the
  bundle rather than failing closed. This is intentional for locally-mutated
  bundles (verification patches recompute the checksum), but it means a corrupted
  download isn't rejected on the download path.
- **Priority:** P1 · **Status:** open
- **Notes:** Fix should verify against the *cloud-provided* checksum on the
  download path while still allowing recompute for local mutations. Deferred:
  needs care to avoid breaking verification persistence.

### KI-03 — No manual "I am here" km override when GPS is denied/unavailable
- **Description:** With GPS denied/unavailable, `currentKm` stays at 0 and the
  next-stop / resupply views assume the start of the route. Status is now visible
  (RH-05) but the rider can't tell the app where they are.
- **Priority:** P2 · **Status:** deferred
- **Deferred reason:** New feature, not a regression. Track for a focused UX pass.

### KI-04 — Auto-scroll / next-stop trust when position is unknown
- **Description:** Resupply auto-scroll and "next stop" pick from km 0 when
  position is unknown, which can mislead. Tied to KI-03.
- **Priority:** P2 · **Status:** deferred
- **Deferred reason:** Address together with KI-03 (manual km override).

### KI-05 — Physical-device QA outstanding for race-day workflow
- **Description:** GPX import, race deletion, persistence, sync, wake lock,
  map-matching on loops, and offline continuation need verification on a physical
  iPhone (PWA / Safari) before production deploy.
- **Priority:** P0 (release gate) · **Status:** open
- **Notes:** Cannot be verified from the dev environment. Required before deploy.

### KI-06 — Render analysis API deployment not verified live
- **Description:** Companion GPX import proxies `/api/*` to the Render FastAPI
  service via `companion/vercel.json`. The service must be deployed and healthy
  (`/api/health`) for import to work.
- **Priority:** P0 (release gate) · **Status:** open — **verified NOT live**
- **Notes:** `curl https://ultra-roadbook-api.onrender.com/api/health` returned
  **404** during RC hardening (route exists in `src/server.py`, so the service is
  not deployed / not routed). Companion GPX import will fail until this is fixed.
  Deploy via Render Blueprint (`render.yaml`), set Supabase env vars, then verify
  with `scripts/verify_production_api.sh`. Desktop import is unaffected (local).

---

## How to use this file

- Add an entry the moment a bug or risk is found — don't rely on memory.
- When fixing, move the entry to the "Fixed in <version>" section with the fix
  summary. When deferring, record the **Deferred reason**.
- Keep P0/P1 items at the top of the open list.
