# Release Report — Final Release Audit

Ultra Roadbook, Release Candidate. Race in 2 days. This report summarizes the
final end-to-end audit (Desktop, Companion, Backend, Sync, API, GPX import, Coros
export, Auth, Offline, Performance, UI, Maps), what was fixed, and every remaining
issue with a "fix before the race?" call.

**Scope guardrail followed:** only safe, low-regression, tested fixes were made.
No architecture changes, no new features, no style refactors. Riskier findings are
documented in `KNOWN_ISSUES.md` rather than changed under time pressure.

---

## Verdict

- **App Store / TestFlight readiness:** ~80%. The app is polished and the core
  ride-day experience is reliable **offline**. The single true blocker is external:
  the Render analysis API is not deployed (KI-06), so **in-app (Companion) GPX
  import does not work yet**.
- **Race-day trust (offline execution):** High, provided the race is on the phone
  before the start (import + sync on Desktop, download in Companion while online).
- **Highest-ROI action before the race:** deploy + verify the Render API (KI-06),
  or simply **import on Desktop and download in the Companion at home** — which
  sidesteps import entirely.

---

## Fixed in this pass (safe, tested, builds + tests green)

| ID | Severity | Fix |
|----|----------|-----|
| FA-11 | **Critical** | Street View opened the wrong place and faced the wrong way: it used a snapped GPX route point as the `viewpoint` **and** forced a route-derived `heading`. Now the fallback URL is `map_action=pano&viewpoint=<POI>` with **no forced heading** — identical coordinates to the Google Maps link, and Google auto-faces the POI. Heading/`pano` id are only used on the (key-gated) metadata path. Added an identical-coordinates regression test. Remaining: no-coverage POIs still snap to the nearest pano (needs a server-side metadata proxy — documented). |
| FA-01 | **Critical** | Offline open no longer blocked when Desktop pushed a newer revision — falls back to the downloaded bundle when offline / on download failure. Prevents a start-line lockout. |
| FA-02 | **High** | Verifications spanning multiple races are now grouped by `raceId` before the direct-Supabase write. Fixes silent cross-race corruption. |
| FA-03 | **Medium** | Hidden persistent map no longer runs GPS-follow/focus camera animations or fires bounds re-renders while on other tabs. Saves GPU/battery mid-ride. |
| FA-04 | **Low** | Removed the dead `route-arrows` GeoJSON source (+builder) built on every map init. |

All three JS test suites + Python sync tests pass; companion and frontend
production builds succeed (see "Verification" below).

---

## Remaining issues

Likelihood/Impact/Complexity are relative. "Before race?" is the recommendation
given the 2-day window and offline-first usage.

### Critical (release-gating)

| ID | Issue | Likelihood | Impact | Fix complexity | Before race? |
|----|-------|-----------|--------|----------------|--------------|
| KI-06 | Render analysis API not deployed → **Companion GPX import fails** (`/api/health` returned 404). | Certain (if used) | High (import unusable in-app) | Low (deploy) — external | **Yes — deploy & verify, OR avoid by importing on Desktop.** |
| KI-05 | Physical-iPhone QA of the full race-day workflow not yet done. | — | High | — (manual) | **Yes — run `RELEASE_CHECKLIST.md` on the actual device.** |

### High

| ID | Issue | Likelihood | Impact | Fix complexity | Before race? |
|----|-------|-----------|--------|----------------|--------------|
| FA-05 | No offline access to downloaded races if there's no cached session (sign-out / long-offline token expiry / first-install offline). | Low–Med | High (can't open races) | Medium (touches auth gate) | No — mitigate: stay signed in + keep app installed before race day. |
| FA-07 | Long (800–2000 km) Companion imports may hit the Vercel proxy timeout. | Medium (ultras) | Medium | Medium | No — mitigate: import on Desktop, sync to phone. |

### Medium

| ID | Issue | Likelihood | Impact | Fix complexity | Before race? |
|----|-------|-----------|--------|----------------|--------------|
| FA-06 | Import SSE final buffer not flushed → could miss the final `complete` event. | Low–Med | Medium | Low | No — only affects Render import (gated on KI-06); fix after import is live. |
| FA-08 | Post-import cloud-push warning never shown; no re-push action for local-only imports. | Medium | Medium | Low–Med | No — local offline use unaffected. |
| FA-09 | Verification sync uses a non-refreshed token and fails silently (queue is retained, so no data loss). | Medium | Low (UX only) | Low | No — data is safe; add feedback post-race. |
| FA-10 | Cloud verification updates are last-write-wins (no compare-and-set); concurrent devices can overwrite. | Low (single rider) | Medium | Medium | No — single-rider risk is low. |
| KI-02 | Bundle checksum self-heal accepts a recomputed checksum on download (won't reject a corrupt download). | Low | Medium | Medium | No — needs careful fix to not break verification persistence. |

### Low

| ID | Issue | Likelihood | Impact | Fix complexity | Before race? |
|----|-------|-----------|--------|----------------|--------------|
| KI-07 | Haptics are a no-op on iOS (Web Vibration unsupported). | Certain (iOS) | Low | — | No — graceful no-op. |
| KI-03 / KI-04 | No manual "I am here" km override when GPS is denied/unavailable. | Low | Medium | Medium (feature) | No — deferred feature. |
| Perf | Monolithic `CompanionContext` re-renders the tree on every GPS tick. | High | Low–Med | Medium (context split) | No — measurable but not a correctness risk; FA-03 removes the worst of the hidden-tab churn. |

---

## Workflow trace results

### Coros / GPS export — verified good, no changes needed
- **Route integrity:** before/after fingerprint (point count, distance, elevation
  gain **and descent**, geometry checksum, raw `<trk>` byte checksum) — export
  throws `GpxTrackModifiedError` if the original track changes. Waypoints are
  inserted strictly before `</gpx>`; the track is never rewritten.
- **Verified-only (Coros):** `shouldExportStop` requires
  `verificationStatus === "verified"` for the Coros profile.
- **No climb / artificial checkpoints:** only `bundle.stops` (resupply POIs) are
  exported; climbs are not in `stops`. Excluded categories are filtered out.
- **Icons:** `resolveCorosWptIcon` assigns `<sym>`/`<type>`; validation fails if a
  Coros waypoint is missing an icon.
- **Ordering / dedup:** sorted by km (primary before alternative); de-duplicated by
  OSM key, zone, and name+coord.
- **GPX validity:** requires a `</gpx>` tag, escapes XML, well-formed `<wpt>`.

### Import experience — blocked externally
- Files picker, Share Sheet (Android SW), and launch-queue paths are wired; iOS
  Safari share-target delivery is unreliable, so the **Files picker is the primary
  path** (documented). Real SSE progress, duplicate pre-check, and offline
  persistence after import all exist.
- **Everything import-related depends on KI-06** (Render `/api`). Until deployed,
  the reliable path is: **import on Desktop → sync → download in Companion.**

### Offline / sync / auth — hardened
- FA-01 removes the offline-open lockout. Active-race bundle is protected from
  background swaps (RH-02) and revision churn (RH-01). Pending verifications
  persist in IndexedDB and re-apply on download. Remaining gaps are FA-05/FA-09/
  FA-10 (documented, low single-rider risk).

---

## Verification (this pass)

- `npm run build --prefix companion` → `test:sync` (22 Python tests + 6 tsx
  suites) pass, `tsc -b` clean, `vite build` + PWA generate OK.
- `npm run build --prefix frontend` → `tsc -b` clean, `vite build` OK.
- `npx tsx shared/race/gpsGpxExport.test.ts` → all export tests pass.
- No new linter errors in edited files.

---

## Roadmap to v1.0 (post-race)

1. **Deploy + monitor the Render API** and switch Companion import to call it
   directly (removes FA-07); then land FA-06 (SSE flush).
2. **Offline-without-session** read-only mode (FA-05) + surface local-only imports
   with a re-push action (FA-08).
3. **Verification sync robustness:** fresh-token refresh + user feedback (FA-09)
   and compare-and-set cloud updates (FA-10).
4. **Performance:** split GPS state out of `CompanionContext` to stop per-tick
   whole-tree re-renders; memoize the shared route track across map layers.
5. **GPS-denied UX:** manual "I am here" km override (KI-03/KI-04).
6. **"Active Race" mode** (the v1.0 north star already captured in PROJECT_BRAIN):
   fold Map/Resupply/Verify into one ride-centric session.

---

## Before you hand the phone to another rider

Do this the day before, on Wi-Fi, on the actual iPhone:
1. Sign in, import/sync the race on Desktop, and **download it in the Companion**
   (so it's `offlineReady`).
2. Open the race once, switch Map ↔ Resupply ↔ Verify, confirm the map keeps
   position and returns instantly.
3. Put the phone in airplane mode and confirm the race still opens and the map,
   resupply and verify all work.
4. Export to Coros and confirm the waypoints/icons look right on the device.

See `RELEASE_CHECKLIST.md` for the full gate.
