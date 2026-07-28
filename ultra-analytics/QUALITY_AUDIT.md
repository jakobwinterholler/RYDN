# RYDN — Product Quality Audit

**Phase:** Product Quality (pre–public beta)  
**Date:** 2026-07-28  
**Scope:** `ultra-analytics/` (RYDN) — every screen, workflow, API, and interaction reviewed as Staff Engineering + Senior Product Design + QA.  
**Rule for this phase:** Do **not** add unrelated features. Polish what exists. Close trust gaps. Make the product feel premium and immediately understandable.

This document is the backlog. **Do not implement everything at once.** Follow the implementation order at the end.

---

## Executive verdict

RYDN’s **cabinet / Library / Ultra overview** direction is strong and close to the intended feeling. The product is **not** yet beta-ready.

Three gaps dominate:

1. **Trust & integrity** — OAuth binding, membership consistency, destructive actions without confirmation.
2. **Product honesty** — “Ultra Analytics” does not analyse an Ultra; Review still carries dark-theme leftovers that hurt readability.
3. **Polish system** — one design language is defined on shell screens; onboarding and Review still speak different dialects.

The atlas map is close. Ultra-as-one-activity analytics does not exist yet and is the largest product build remaining in this phase.

---

## Method

Reviewed in code (not assumed correct):

| Layer | Surfaces |
|-------|----------|
| Screens | Welcome, ConnectProvider, SyncProgress, Home (Ultras / Library / You), UltraPage, UltraAnalyticsPage, Review (+ Overview / Analysis / Curves / Compare), upload / create / edit / add-rides sheets |
| Navigation | `App.tsx` screen state |
| Visual system | `styles.css` tokens, buttons, chips, sheets, Review leftovers |
| Map | `RoutePreview.tsx` + `countries110m.json` |
| Backend | Auth, providers/OAuth, sync, store, ultras, analysis pipeline, ride delete |
| Cross-cutting | Loading / error / empty, a11y, mobile safe areas, performance |

---

## Critical

### C1 — Strava OAuth `state` is the user id (CSRF / account binding)

| | |
|--|--|
| **Problem** | `GET /api/providers/{pid}/connect` sets OAuth `state` to the raw user id. Callback loads that user and stores tokens **without verifying the session cookie**. Google auth uses a random state cookie; Strava does not. |
| **Why it matters** | An attacker who completes Strava OAuth can set `state` to a victim’s uid and bind (or overwrite) the victim’s Strava connection. Disqualifies public beta. |
| **Recommended solution** | Mirror Google: cryptographically random `state` in an HttpOnly cookie, bound to session uid; callback must match cookie + session; reject mismatches. |
| **Effort** | **S** (½ day) including regression test |

---

### C2 — No browser history / deep links (iOS back is broken)

| | |
|--|--|
| **Problem** | Navigation is React `useState` only. Ultra → Analytics → Day Review do not push history. Browser/Safari swipe-back cannot leave those screens; URLs never reflect location. |
| **Why it matters** | On iPhone this feels broken, not “web app quirky.” Shareable Ultra links are impossible. First-class beta blocker for a mobile-primary product. |
| **Recommended solution** | Minimal History API or tiny router: `/`, `/ultras/:id`, `/ultras/:id/analytics`, `/rides/:id` (+ query for tab). Sync `popstate` ↔ screen. Preserve back stack semantics already sketched in `App.tsx`. |
| **Effort** | **M** (1–2 days) |

---

### C3 — Ultra Analytics does not analyse an Ultra

| | |
|--|--|
| **Problem** | `UltraAnalyticsPage` re-fetches Ultra detail, lists days (opens per-ride Review), and shows a static Topics list. Five topics are marked `ready: true` with **no data, no charts, no handlers**. Backend has no stitched Ultra report—only summed `distanceKm` / `elevationGainM` / `durationS` on the Ultra object. |
| **Why it matters** | Directly contradicts product intent: *analyse an entire Ultra as one activity.* Misleading “ready” topics destroy trust. Overview vs Analytics philosophy is correct; the Analytics page is a stub. |
| **Recommended solution** | See **§ Ultra Analytics build** below. Until the API exists: mark all expedition topics as Later / remove false `ready`, and show only honest day entry + a clear “Expedition analytics coming” state—or ship the real aggregate. |
| **Effort** | Honesty patch **XS**; real Ultra analytics **XL** (1–2 weeks) |

---

### C4 — Ride delete orphans Ultra membership and stale totals

| | |
|--|--|
| **Problem** | `store.delete_ride` removes the ride file/stub but does **not** strip the id from Ultras or recompute totals. `ultra_detail` silently drops missing days while headline metrics can remain inflated. |
| **Why it matters** | Cabinet cards and Ultra score lines become lies. Silent data corruption is worse than a hard error. |
| **Recommended solution** | On delete: remove id from all Ultras’ `activityIds`, recompute totals/route metadata; or block delete while claimed (409 + copy). Prefer auto-cleanup + toast. |
| **Effort** | **S–M** (½–1 day) + tests |

---

## High

### H1 — Atlas map: geographical context still too weak

| | |
|--|--|
| **Problem** | `RoutePreview` is the right direction (paper plate, no labels/roads/terrain, segmented routes). Sea (`#f3f0ea`) vs land (`#f7f5f0`) contrast is subtle; borders (`#948c7e`, 1.25px) are easy to miss on iPhone; bbox expansion (~22%) sometimes clips neighbouring countries; coast is only “land edge against sea rect,” not a dedicated coastline emphasis. |
| **Why it matters** | User feedback: printed atlas context, route remains hero. Without clearer borders/coast/neighbours/sea, the plate reads as “abstract line art,” not place. |
| **Recommended solution** | Keep editorial style. (1) Cooler/slightly deeper sea vs warmer land. (2) Stronger but still quiet border stroke; optional second pass for coastline-only rings at slightly higher contrast. (3) Expand view bbox more (and/or min span) so surrounding countries stay visible. (4) Never darken borders above route ink. (5) No labels/roads/terrain. |
| **Effort** | **S** (½ day visual) · **M** if coastline layer / topology cleanup |

---

### H2 — Upload kind toggle: near-black text on black

| | |
|--|--|
| **Problem** | `.kind-toggle button.active` uses `background: var(--text)` and `color: #0a0b0d` — unreadable Training / Ultra race selection. |
| **Why it matters** | Core import path; looks unfinished; users may mis-tag rides. |
| **Recommended solution** | Active = ink fill + paper/white text. Align with `.btn--primary`. |
| **Effort** | **XS** |

---

### H3 — Review analytics: dark-theme leftovers on light paper

| | |
|--|--|
| **Problem** | Efficiency / night / hike pills and related Review CSS still use dark-theme pastels (`#86efac`, `#fca5a5`, `#c4b5fd`, …). `LineChart` backdrop stroke is near-invisible white. Curve zone bars mix toward `#0a0b0d`. Nested Analysis cards double-header with emoji icons vs SF `Icon` language. |
| **Why it matters** | Fails the 5-second readability test. Charts and pills fight the RYDN paper system. Feels like two products glued together. |
| **Recommended solution** | Remap Review tokens to paper/ink/accent. One chart stroke language. Strip nested titles when embedded. Replace emoji with `Icon`. Audit every Review tab at 390px width. |
| **Effort** | **M** (1–2 days) |

---

### H4 — Charts / analytics unreadable on small phones; inconsistent across breakpoints

| | |
|--|--|
| **Problem** | Review was improved for touch, but density, label collision, and dual theme leftovers still risk horizontal awkwardness and tiny type on iPhone SE–class widths. Desktop ultrawide gets the same narrow content with no intentional max-measure rhythm in Review. Compare tab is a placeholder presented as a first-class tab. |
| **Why it matters** | Explicit product requirement: equal premium on iPhone → ultrawide; no chart should require horizontal scroll or become unreadable. |
| **Recommended solution** | Mobile-first chart containers (full width, fixed aspect, abbreviated axis labels, touch scrub). Hide or badge Compare until real. Shared `ChartFrame` with max-width + centering on large screens. |
| **Effort** | **M** |

---

### H5 — Destructive actions unsafe (swipe remove, nested delete)

| | |
|--|--|
| **Problem** | Ultra day swipe-left past threshold calls `onRemove()` with no confirm. Library `RideCard` nests a delete control inside a button; delete is hover-only (invisible on touch). Ride delete has no confirm and silent failure refresh. |
| **Why it matters** | Accidental ungroup/delete destroys trust; nested buttons are invalid HTML and flaky on iOS. |
| **Recommended solution** | Swipe reveals action → tap to confirm (or confirm sheet). Always-visible delete on touch. Confirm dialog for permanent delete. Fix card hit targets (≥44px). |
| **Effort** | **S–M** |

---

### H6 — Activity can belong to multiple Ultras (API)

| | |
|--|--|
| **Problem** | Exclusivity is UI-only. API accepts the same `activityId` in multiple Ultras → double-counting, confused Library “claimed” set, broken mental model. |
| **Why it matters** | Ultra = editable folder of source days; days shouldn’t live in two folders without an explicit product decision. |
| **Recommended solution** | Server-side exclusive membership; `409` with clear message if claimed elsewhere. |
| **Effort** | **S** |

---

### H7 — Sheets / modals lack dialog semantics

| | |
|--|--|
| **Problem** | Create Ultra / Edit / Add rides / Upload: no Escape-to-close, no focus trap, no restore focus, body scroll not locked; some fullscreens don’t dismiss on backdrop. |
| **Why it matters** | Feels non-native on iPhone and Arc/desktop keyboard users; a11y incomplete. |
| **Recommended solution** | Shared `Sheet` primitive: `role="dialog"`, `aria-modal`, focus trap, Esc, scroll lock, safe-area, 44px actions. |
| **Effort** | **M** |

---

### H8 — OAuth / provider errors invisible when already signed in

| | |
|--|--|
| **Problem** | `provider_error` / `auth_error` set `bootError`, but that prop is only passed to `Welcome`. Logged-in users returning from a failed Strava connect see nothing. |
| **Why it matters** | Silent failure after OAuth is a support nightmare. |
| **Recommended solution** | Global banner/toast on Home after redirect; clear query params after display. |
| **Effort** | **XS–S** |

---

### H9 — Tokens plaintext on disk; session cookie `Secure` / CORS wildcard

| | |
|--|--|
| **Problem** | Strava tokens in `users/<uid>.json` plaintext; `.secret` often `644`; cookies lack `Secure` for HTTPS; CORS `allow_origins=["*"]`. |
| **Why it matters** | Acceptable for local prototype; not for public beta on a shared or deployed host. |
| **Recommended solution** | Encrypt tokens at rest (`ULTRA_SECRET`); `chmod 600`; `secure=True` behind HTTPS; CORS = app origin(s); require `ULTRA_SECRET` in prod. |
| **Effort** | **M** |

---

### H10 — `GET /api/ultras/{id}` mutates and may call Strava

| | |
|--|--|
| **Problem** | Opening an Ultra can sort/patch fields, backfill polylines (multiple Strava calls), and geocode countries. Non-idempotent GET; rate-limit risk; slow open. |
| **Why it matters** | Feels laggy; couples reading with side effects; fragile under sync. |
| **Recommended solution** | Read-only GET; move backfill to sync / background / explicit “Refresh maps”; coalesce country detect. |
| **Effort** | **M** |

---

### H11 — CSS collisions (`.chip` defined twice, legacy overrides)

| | |
|--|--|
| **Problem** | `.chip` appears twice in `styles.css` (filter chips vs curve chips). Legacy `.group-row.on` color redefined. Welcome/home `.btn` overrides partially scoped but Review still has parallel button classes (`ghost-btn`, `primary-btn`, …). |
| **Why it matters** | Unpredictable UI; “fix hierarchy” work can regress silently. |
| **Recommended solution** | Rename to `.filter-chip` / `.curve-chip`; purge dead `home2` / replay / Instrument Serif blocks; one button system everywhere. |
| **Effort** | **S–M** |

---

### H12 — Ride back label always “← Rides”

| | |
|--|--|
| **Problem** | `RideHeader` ignores whether the user came from Ultra, Ultra Analytics, or Library. |
| **Why it matters** | Breaks spatial memory; fails native-app feel. |
| **Recommended solution** | Pass `backLabel` from `App` (`← Ultra`, `← Analytics`, `← Library`). |
| **Effort** | **XS** |

---

## Medium

### M1 — Brand / icon language inconsistent

| | |
|--|--|
| **Problem** | `RydnMark` on Welcome/Connect; `∞` on SyncProgress; text-only RYDN in shell/Review; Analysis/Stops still emoji-heavy. |
| **Why it matters** | Premium products have one mark language. |
| **Recommended solution** | `RydnMark` on all onboarding + favicon (done) + optional subtle chrome; replace emoji with `Icon`. |
| **Effort** | **S** |

---

### M2 — Welcome / onboarding atmosphere vs paper system

| | |
|--|--|
| **Problem** | Dark radial welcome card, pink error text, missing safe-area on `.welcome`. Connect shows local `.env` / callback-domain instructions to end users. |
| **Why it matters** | First impression ≠ product; setup copy belongs in DEV only. |
| **Recommended solution** | Light paper welcome; safe-area; gate setup URIs behind DEV/`setup` flag. |
| **Effort** | **S** |

---

### M3 — SyncProgress auto-advances; failure still onboards

| | |
|--|--|
| **Problem** | After reveal, auto-calls `onDone`; “Continue anyway” on error still completes onboarding. |
| **Why it matters** | Users can land in an empty Library without understanding sync failed. |
| **Recommended solution** | Explicit “Open Library” CTA; on failure offer Retry vs Skip with clear copy. |
| **Effort** | **S** |

---

### M4 — Tab / space state lost when returning from Ultra

| | |
|--|--|
| **Problem** | Opening an Ultra then Back always lands on Ultras, even if user was in Library. |
| **Why it matters** | Extra taps; breaks task continuity. |
| **Recommended solution** | Lift `space` into `App` or `sessionStorage`. |
| **Effort** | **XS** |

---

### M5 — Double `getUltra` fetch; full report N+1 on library list

| | |
|--|--|
| **Problem** | Ultra → Analytics refetches. Backend `list_rides` parses every full report JSON for summary fields. Ultra detail may load each ride repeatedly for route/quality/countries. |
| **Why it matters** | Slow cabinets as libraries grow; wasted mobile battery. |
| **Recommended solution** | Client cache / lift Ultra detail; sidecar summaries; prefer stub polylines for maps. |
| **Effort** | **M** |

---

### M6 — File-store races (sync + polyline + token refresh)

| | |
|--|--|
| **Problem** | JSON read–modify–write without locks/atomic replace. |
| **Why it matters** | Occasional lost stubs/tokens under parallel requests. |
| **Recommended solution** | Per-user lock + temp file + `os.replace`; in-flight analyze dedupe. |
| **Effort** | **M** |

---

### M7 — Analysis schema bump skips uploads

| | |
|--|--|
| **Problem** | Stale recompute requires a provider stub; uploads stay on old semantics after `ANALYSIS_SCHEMA` bumps. |
| **Why it matters** | Upload users see permanently wrong analytics after improvements. |
| **Recommended solution** | Persist raw upload or samples; or document limitation + `reanalyze` when possible. |
| **Effort** | **M–L** |

---

### M8 — Accessibility baseline missing

| | |
|--|--|
| **Problem** | Almost no `:focus-visible`; tabs lack `aria-controls`; sync spinner `aria-label` on non-role element; sheets incomplete; little `prefers-reduced-motion`. |
| **Why it matters** | Keyboard/AT users and motion-sensitive riders are first-class. WCAG contrast issues in Review pills (H3). |
| **Recommended solution** | Focus ring token; dialog/tab patterns; `role="status"` live regions; reduced-motion cuts. |
| **Effort** | **M** |

---

### M9 — Touch targets below 44px in places

| | |
|--|--|
| **Problem** | Sheet header save / some chips at ~40px; ghost compact actions inconsistent. |
| **Why it matters** | iPhone thumb accuracy; Apple HIG. |
| **Recommended solution** | Enforce min 44×44 on interactive controls (optical padding OK). |
| **Effort** | **S** |

---

### M10 — Normalized Power assumes ~1 Hz

| | |
|--|--|
| **Problem** | NP window is sample-count based after dropping non-riding points. |
| **Why it matters** | Wrong NP/VI on irregular GPX/TCX. |
| **Recommended solution** | Time-based 30s window on the timeline (as curves already grid). |
| **Effort** | **S** |

---

### M11 — Time ledger: unknown long stops → “Rest / Hotel”

| | |
|--|--|
| **Problem** | Unknown ≥40 min buckets into hotel/rest. |
| **Why it matters** | Inflates sleep/rest narrative for unclassified stops. |
| **Recommended solution** | Keep Unknown until classifier confidence is high. |
| **Effort** | **XS** |

---

### M12 — Countries GeoJSON ~247KB always in main bundle

| | |
|--|--|
| **Problem** | `countries110m.json` imported by `RoutePreview` → any Ultra open pays the cost. |
| **Why it matters** | Mobile parse/layout cost; larger JS. |
| **Recommended solution** | Dynamic `import()` when map mounts; optional server-clipped land for bbox. |
| **Effort** | **S** |

---

### M13 — Relative dates on expedition day lists

| | |
|--|--|
| **Problem** | `fmtDate` “3 days ago” on Ultra days/archives confuses race chronology. |
| **Why it matters** | Expeditions are dated events; absolute dates read clearer. |
| **Recommended solution** | Absolute short dates in Ultra / Analytics lists; relative OK in Library “recent.” |
| **Effort** | **XS** |

---

### M14 — Experience profile never filled

| | |
|--|--|
| **Problem** | Ultra `experience` is empty defaults forever. |
| **Why it matters** | Core ULTRA_BRAIN promise (learn → plan next) has no data path yet. |
| **Recommended solution** | Derive after Ultra report exists (post C3); until then don’t surface empty experience UI. |
| **Effort** | Tied to Ultra analytics **L** |

---

## Low

### L1 — Flag emoji for countries (Windows / “no emoji” tension)
ISO text fallback optional. **Effort: XS**

### L2 — Reorder days uses rotated chevrons
Add up/down icons. **Effort: XS**

### L3 — Create Ultra always `status: "reviewed"`
Map from UX when planning exists. **Effort: XS**

### L4 — `oauth-debug` exposed to signed-in users
Gate behind env flag. **Effort: XS**

### L5 — CurveChart hover values not keyboard-accessible
Keyboard scrub or table alternative. **Effort: S**

### L6 — Google Fonts runtime dependency
Self-host subset for PWA/offline. **Effort: S**

### L7 — Test coverage thin
Missing: OAuth state, membership exclusivity, delete orphan cleanup, Ultra aggregate, sheet a11y smoke. **Effort: M** ongoing

### L8 — Pull-to-refresh / PWA / landscape
No PTR; no install manifest polish; landscape Review unreviewed. Acceptable for private beta; schedule before public. **Effort: M** combined

### L9 — RoutePreview polygon holes stroked like land
Lakes/holes can look odd. Treat exteriors vs holes. **Effort: S**

### L10 — Empty GPS Ultra: map empty with little explanation near Analytics entry
Soften copy when no route. **Effort: XS**

---

## § Map improvement (product brief → engineering)

**Intent:** Printed atlas plate. Route always darkest.

| Keep | Change |
|------|--------|
| No labels, roads, terrain, Google style | Clearer country borders |
| Segmented day strokes (no teleport) | Visible coastline |
| Start/end marks | Surrounding countries in frame |
| Editorial paper | Subtle sea vs land distinction |

**Acceptance tests**

1. On iPhone, at arm’s length, landmass edges are noticeable without competing with the route.  
2. At least one neighbouring country is typically visible for multi-country Ultras.  
3. Sea is cooler/quieter than land.  
4. Route stroke remains the darkest element in the SVG.  
5. Still zero labels/roads/hillshade.

---

## § Ultra Analytics build (product brief → engineering)

**Intent:** One Ultra = one coherent activity. Not three Review screens stacked.

### What exists today

- Summed distance / elevation / elapsed on Ultra  
- Per-day Review (full pipeline)  
- Analytics page = day launcher + inert topics  

### What “done” looks like (MVP for beta)

**Backend**

1. Stitch member activities into one prepared timeline (preserve day boundaries + overnight gaps—policy: overnight counts as stopped/elapsed, documented).  
2. `GET /api/ultras/{id}/analysis` → cached Ultra report (`ultraAnalysisSchema`), invalidate on membership/order/member schema change.  
3. Ensure members analyzed (or lazy-analyze with progress).  

**Frontend**

1. Ultra Analytics page: **hero metrics first** (5-second test): total distance, elevation, elapsed, moving, stopped, avg moving speed.  
2. Then: elevation profile (full expedition), moving vs elapsed (ledger), climbing distribution, speed duration (and power when present).  
3. Day list remains secondary (“Explore a day”).  
4. Future: weather, nutrition, sleep, AI — listed as Later, never marked ready.

**Do not** sum independent mean-max curves naively and call it done—restitch or explicitly document limitations per metric.

**Effort:** **XL** (design + API + UI). Highest product value after trust fixes.

---

## UI consistency checklist (system debt)

| Token / pattern | Shell (good) | Debt |
|-----------------|--------------|------|
| Buttons 44px, primary/secondary/tertiary/strava | Library | Welcome/Sync/Review parallel classes |
| Paper / ink / line | Ultra overview | Review pastels, welcome dark |
| `Icon` SF lines | Ultra / cabinet | Analysis emoji, Sync `∞` |
| Safe areas | Shell, Ultra, sheets | Welcome |
| Empty / loading | `empty`, `space-loading` | Many one-off strings |
| Score line order | Cabinet / Ultra | RideHeader partially custom |
| Focus / motion | Weak globally | Add once, reuse |

---

## Mobile review (iPhone-primary)

| Area | Status |
|------|--------|
| Safe areas / Dynamic Island | Mostly OK on shell + Ultra; Welcome weak |
| Touch targets | Mostly 44px; sheets/chips gaps |
| Sheets | Fullscreen pattern good; dialog a11y incomplete |
| Scrolling | OK; body scroll under sheets risk |
| Keyboard | Forms in sheets — untested systematically |
| Pull-to-refresh | Absent |
| Landscape | Unreviewed |
| Safari back | **Broken** (C2) |
| PWA | Favicon only; no install/manifest polish |
| One-handed | Cabinet grid + bottom tabs good; tall Review tabs less so |

**Rule:** If it feels like a desktop site squeezed onto a phone, redesign that surface (Review + Analytics are the main suspects).

---

## Desktop / browser review

| Area | Status |
|------|--------|
| Resize / breakpoints | Shell OK; Review not intentionally designed for ultrawide |
| Keyboard nav | Weak focus rings; sheets lack Esc |
| Safari / Chrome / Arc / Firefox / Edge | No automated matrix; OAuth cookie `Secure`/SameSite must be verified per browser before beta |
| Performance | Countries JSON + full-report listing; Review remount on tab |
| Accessibility | Below beta bar (M8) |

---

## Performance (priority hits)

1. `countries110m.json` eager import (M12)  
2. `list_rides` full JSON parse (M5)  
3. Mutating Ultra GET + Strava backfill (H10)  
4. Review `key={tab}` full remount (Medium polish)  
5. Dead CSS weight (~3.9k lines with unused blocks) (H11)  

---

## Accessibility (priority hits)

1. Contrast on kind-toggle (H2) and Review pills (H3)  
2. Focus-visible + sheet dialog pattern (H7, M8)  
3. Nested interactive RideCard (H5)  
4. Reduced motion on tab fades  
5. Touch target floor 44px (M9)  

---

## What’s already strong (do not regress)

- Product IA: Ultras · Library · You; Ultras never auto-created  
- Ultra overview question: *What was this expedition?*  
- Editorial atlas direction (segmented routes, no teleport lines)  
- Button hierarchy intent: Sync Strava / Group / Upload GPX  
- Cabinet as recognition shelf; Score line contract  
- Mobile fullscreen sheets with footer primary  
- Analysis pipeline quality for a **single** ride (curves, stops, climbs)  
- RYDN mark (route → finish flag)

---

## Recommended implementation order

Ship in waves. Each wave should be releasable and feel better than before.

### Wave 0 — Stop the bleeding (2–3 days) ✅ Done 2026-07-28

1. **C1** Strava OAuth state — random CSRF `state` + session binding  
2. **H2** Kind-toggle contrast — ink on white active label  
3. **C4** Delete orphan Ultra cleanup — detach + `recompute_ultra`  
4. **H6** Exclusive membership — `409` on create/patch conflicts  
5. **H8** Surface provider errors — Home banner for `bootError`  
6. **C3 honesty** — Ultra Analytics topics all “Coming soon” (no false ready)

*Also in Wave 0:* central `recompute_ultra` (distance, elevation, elapsed, moving, dayCount, year, dates, countries); heal on cabinet/get; recompute after ride save/analyze.

### Wave 1 — Ultra Analytics (stitched expedition) ✅ Done 2026-07-28

User-ordered as product Wave 1 (audit Wave 3). Shipped:

- `GET /api/ultras/{id}/analysis` — stitch member Activities → `build_report`
- Sample caching on analyze/import; legacy report reconstruction when needed
- Aggregation + validation vs day sums; overnight gaps in elapsed
- Ultra Analytics page: Overview, Pacing, Elevation, Performance (hide empty)

### Wave 1 — Native feel & trust (3–5 days)

1. **C2** History / URLs / iOS back  
2. **H5** Destructive action UX  
3. **H12** Contextual back labels  
4. **H7** Sheet dialog primitive  
5. **M4** Remember Library/Ultras tab  

*Exit:* Feels like an app, not a state machine trapped in a tab.

### Wave 2 — Readability & one design system (4–6 days)

1. **H1** Atlas map pass (borders / coast / sea / neighbours)  
2. **H3 + H4** Review light theme + mobile chart frames  
3. **H11 + M1 + M2** CSS purge, buttons, brand, welcome paper  
4. **M8 + M9** Focus, reduced motion, touch targets  
5. **M13** Absolute dates on Ultra days  

*Exit:* 5-second test passes on Overview + day Review on iPhone and laptop.

### Wave 3 — Ultra as one activity (1–2 weeks)

1. Backend stitch + `GET /api/ultras/{id}/analysis`  
2. Ultra Analytics hero metrics + elevation / ledger / climbs / curves  
3. Day list secondary  
4. Invalidate on membership change  
5. Wire `experience` fields that are knowable  

*Exit:* Analytics answers *How did I ride it?* for the whole expedition.

### Wave 4 — Hardening for public beta (ongoing)

1. **H9** Token encryption, Secure cookies, CORS  
2. **H10 + M5 + M6 + M12** Performance & idempotent reads  
3. **M7** Upload reanalyze story  
4. **M10 + M11** Metric correctness  
5. **L7 + L8** Tests, PWA, landscape matrix  

---

## Explicit non-goals this phase

- Nutrition / sleep / weather / AI insights (list as Later only)  
- New providers  
- Compare-tab implementation (hide or Soon)  
- Roadbook / Companion feature merge  
- Visual redesign of cabinet concept (polish only)

---

## How to use this document

1. Pick the next **Wave**.  
2. Implement only items in that wave (plus blockers discovered while doing them).  
3. After each wave: iPhone Safari pass + desktop Arc/Chrome pass using the checklists above.  
4. Update this file: move fixed items to a **Resolved** section with date.

**Priority is no longer features. Priority is a polished, premium product users immediately understand and enjoy.**

---

*End of audit. Next action: approve Wave 0 (or request a different wave order), then implement.*
