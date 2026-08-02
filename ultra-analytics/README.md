# 🧠 Ultra Analytics — Phase 1

Local-first ride analysis for ultra cyclists. Upload a training ride or an
entire multi-day ultra and get a **question-led race report** that explains what
happened — not just a wall of charts.

> Part of the ecosystem: **Ultra Roadbook** (plan) → **Ultra Companion**
> (execute) → **Ultra Analytics** (learn). See `../ULTRA_ANALYTICS_BRAIN.md`
> for the full product architecture.

## Run it

```bash
./dev.sh
```

Opens **https://rydn.bike** (Cloudflare Tunnel → your Mac).  
Validate anytime: `./doctor.sh`  
Full setup (new Mac): see **SETUP.md**.  
**Production (Railway):** see **DEPLOYMENT.md**.

## What it does

- **Imports** FIT, TCX and GPX files.
- **Merges** multiple files (`Day1.fit`, `Day2.fit`, …) into one race — the
  rider never has to think about how many files there were.
- **Explains** the ride across seven sections, each answering one real question:
  - **Coach's debrief** — a specific, data-grounded summary (no generic filler).
  - **Overview** — distance, elevation, moving vs elapsed, true race speed,
    plus hike-a-bike time/distance/climbing when detected.
  - **Time Ledger** — every minute attributed (moving / hike-a-bike / sleep / …).
  - **Pacing** — over/under-pacing and aerobic decoupling, with the *why*
    (hike-a-bike sections are excluded so they never read as a bonk).
  - **Climbs** — each climb measured by time cost, whether you faded, and the
    rideable-vs-walked split.
  - **Stops** — auto-detected and classified (low confidence → *unknown*).
  - **Performance** — power, HR, cadence, speed over the route.
- **Classifies movement into four states** — *riding*, *hike-a-bike* (pushing the
  bike, still progressing on foot), *stopped*, and recording gaps — the ultra
  reality generic tools miss. Hike-a-bike is detected from sustained slow forward
  progress on a steep uphill with near-zero cadence/power, and is measured
  separately everywhere.
- **Replays** the entire race on a map (**Race Replay**): watch the rider move
  along the route with the completed section highlighted, live metrics, walked
  sections drawn distinctly with a hike-a-bike badge, and stop/climb events firing
  as they happen — 1×…100×, smooth over overnight gaps.

## Race Replay engine

The replay is built on a reusable, framework-agnostic **ReplayEngine**
(`frontend/src/replay/ReplayEngine.ts`). It owns a wall-clock-driven race clock,
interpolates the rider's full state at any race time, handles stops (dwell then
skip dead time — so multi-hour sleeps never stall playback), and broadcasts
state via a tiny pub/sub API:

```
engine.subscribe(state => …)   // { timestamp, location, metrics, currentClimb,
                               //   currentStop, activity, raceTimeS, … }
engine.play / pause / restart / setSpeed / seek / seekFraction
```

The map subscribes **imperatively** (MapLibre `line-gradient` progress + a moving
marker) so the heavy view never re-renders through React; only the small HUD,
controls and event overlays re-render per frame. Anything else in Ultra
Analytics can later subscribe to the same engine.

## Phase 1 boundaries (by design)

No authentication · no cloud · no external APIs. Everything runs on your
machine. Classification is done purely from the ride's own signals (duration,
time-of-day, elevation, overnight gaps) — Roadbook/Companion verified-stop
matching will make it exact later.

## Structure

```
backend/          FastAPI analysis service
  app/parsing/    FIT / TCX / GPX → canonical Activity  (+ merge into a Race)
  app/analysis/   overview · performance · climbs · stops · ledger · pacing · summary
  app/subscription/  tiers · feature gates · redeem codes (Stripe-ready hook)
  app/models.py   canonical data model (Sample / Activity / Race)
frontend/         Vite + React report UI
```

Adding a new source (Strava, Garmin, Coros Dura) means adding one parser that
emits canonical `Activity` objects — the analysis layer never changes.

## Accounts & subscription (no payments yet)

Every logged-in account has `subscriptionTier`: `free` or `pro` (guest =
unauthenticated). The backend user record is the source of truth; `/api/auth/me`
exposes `subscriptionTier`. Feature access goes through `can_access` /
`canAccess` — never invent Pro on the client.

| Tier | Access |
|------|--------|
| **Free** | Library, Analytics, Certificates, Ultras / multi-day, ride history |
| **Pro** | Planning, Verify, Ride mode, GPX export |

**Redeem a code** on **You** (or `POST /api/subscription/redeem` with
`{"code":"…"}`). Codes live in `backend/data/redeem_codes.json` (under
`ULTRA_DATA_DIR` in production).

**Dev / beta test codes (reusable):**
- `RYDN-PRO-BETA` → Pro
- `RYDN-FREE-TEST` → Free (QA reset)
- `RYDN-ONBOARD` → open product onboarding (no plan change)

Future Stripe (or any billing) should call
`set_subscription_tier(user_id, "pro", source="stripe")` — gating code only
reads the tier.
