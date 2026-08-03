# Release Checklist — Ultra Roadbook

Manual verification before race day. Check each box on the **actual iPhone you will
race with**, on the **network conditions you will race in** (including none).

> Goal: trust the app for an 800 km ultra, and hand it to another rider without
> having to explain anything.

Legend: **[BLOCKER]** must pass before relying on the app · **[IMPORTANT]** fix if
it fails · **[NICE]** polish.

---

## 0. Pre-flight — deploy gates (do these first)

- [ ] **[BLOCKER]** Analysis API is live: `curl https://ultra-roadbook-api.onrender.com/api/health` returns `{"status":"ok"}`
      *(As of the last check this returned 404 — the Render service must be deployed. Companion GPX import will fail until this passes. See `scripts/verify_production_api.sh`.)*
- [ ] **[BLOCKER]** Companion PWA deployed and reachable: https://companion-flax.vercel.app
- [ ] **[BLOCKER]** Companion `vercel.json` `/api/*` rewrite points at the live API
- [ ] **[BLOCKER]** Supabase env vars set on the API host (SUPABASE_URL, ANON_KEY, SERVICE_ROLE_KEY, JWT_SECRET)
- [ ] **[IMPORTANT]** App version shown in Companion → Account matches the build you deployed
- [ ] **[IMPORTANT]** Installed as a PWA to the Home Screen (not just Safari tab)

---

## 1. Desktop — full workflow (plan the race)

- [ ] **[BLOCKER]** Import GPX → analysis completes without error
- [ ] **[BLOCKER]** Large race (~800 km) imports and analyzes without freezing
- [ ] **[IMPORTANT]** Small race (< 50 km) imports and analyzes correctly
- [ ] **[IMPORTANT]** Suggested Stops appear and are sensible (near route, plausible services)
- [ ] **[IMPORTANT]** Find Stops (discovery) returns candidates in map bounds
- [ ] **[IMPORTANT]** Verify a stop → status persists after reload
- [ ] **[IMPORTANT]** Skip a stop → status persists after reload
- [ ] **[IMPORTANT]** Undo last decision restores previous state
- [ ] **[BLOCKER]** Export → GPS GPX downloads; route matches the original track
- [ ] **[BLOCKER]** Coros export opens/loads on the Coros device, waypoints present
- [ ] **[IMPORTANT]** Signed-in race syncs to cloud (appears in Companion after refresh)
- [ ] **[NICE]** Planning tab answers "where should I stop?" — no climb-detail takeover

---

## 2. Companion — full workflow (ride the race)

- [ ] **[BLOCKER]** Login with Google succeeds
- [ ] **[BLOCKER]** Session restores after closing/reopening the app (no re-login every time)
- [ ] **[BLOCKER]** Download race bundle succeeds (progress completes, race opens)
- [ ] **[BLOCKER]** Open race → Map renders route, stops, climbs, unsupported sections
- [ ] **[BLOCKER]** Map tab: GPS status badge shows (Acquiring → Active) with signal
- [ ] **[BLOCKER]** Resupply: next verified stop is immediately understandable
- [ ] **[IMPORTANT]** Verify a stop in Companion → syncs to desktop/cloud
- [ ] **[IMPORTANT]** Search new stops (Find Stops) works and can promote/verify
- [ ] **[IMPORTANT]** Google Maps link opens the correct location
- [ ] **[IMPORTANT]** Street View link opens (or falls back to Maps cleanly when unavailable)
- [ ] **[BLOCKER]** Export / send route to device from Companion works

---

## 3. Reliability — the trust-critical cases

- [ ] **[BLOCKER]** **Offline:** enable Airplane Mode, force-quit, reopen → race still opens, map + stops still work
- [ ] **[BLOCKER]** **Restart mid-ride:** force-quit during a ride → reopen → continues at correct position, verifications intact
- [ ] **[BLOCKER]** **Active bundle protection:** while a race is open, a newer cloud revision does NOT wipe/swap it silently (update banner only)
- [ ] **[IMPORTANT]** **Low signal:** with weak GPS, position degrades gracefully (Degraded/Lost badge, dead-reckoning) — no wild jumps
- [ ] **[IMPORTANT]** **Loop / out-and-back route:** GPS does not snap backward across overlapping segments
- [ ] **[IMPORTANT]** **Sync after reconnect:** verify offline, come back online → pending verifications sync
- [ ] **[IMPORTANT]** **Delete race:** delete works, does not delete the wrong race, and offline copy is removed
- [ ] **[IMPORTANT]** **Wake lock:** screen stays awake while a race is open (does not sleep mid-glance)
- [ ] **[NICE]** Battery: rough check that an hour of Map + GPS does not drain abnormally fast

---

## 4. Device & UI review (as if submitting to TestFlight)

- [ ] **[BLOCKER]** **Dynamic Island / notch safe area:** no content hidden under the island or home indicator (headers, bottom nav, sheets)
- [ ] **[IMPORTANT]** **Rotation:** rotate the phone on the Map tab → map resizes correctly, no white frame or clipped UI
- [ ] **[IMPORTANT]** **Persistent map:** switch Map ↔ Resupply ↔ Verify repeatedly → map keeps zoom/position/tiles, returns instantly, no flash (KI-08)
- [ ] **[IMPORTANT]** **Touch targets:** all primary actions are ≥ 44px and easy to hit with gloves/sweat
- [ ] **[IMPORTANT]** **Sheets:** every bottom sheet drags to dismiss and animates consistently (Stop, Climb, Unsupported, Stop detail)
- [ ] **[IMPORTANT]** **Bright sunlight:** legible outdoors at full brightness
- [ ] **[NICE]** No developer/debug UI visible (Account → Developer hidden until 7× version tap)
- [ ] **[NICE]** No raw error codes / technical messages surface to the rider
- [ ] **[NICE]** First-run: a new rider understands the Race Library → open → Map/Resupply/Verify flow without help

---

## 5. Known limitations to be aware of (not blockers, but know them)

- [ ] Haptics are silent on iPhone (Web Vibration API unsupported on iOS) — KI-07
- [ ] With GPS **denied/unavailable**, position stays at km 0 and "next stop" assumes the start — grant location before the start, or treat next-stop as unknown (KI-03/04)
- [ ] Bundle checksum self-heals on mismatch (accepts recomputed) — after downloading a race, sanity-check that distance/climbs match desktop (KI-02)
- [ ] Desktop planning API is single-user / not multi-tenant — keep it local, do not expose publicly (KI-01)

---

## 6. Final go / no-go

- [ ] All **[BLOCKER]** items pass on the race-day phone
- [ ] A second rider can open the app and complete Login → Open race → Map → Resupply unaided
- [ ] You would trust this for 800 km

_Last updated: v0.7 Release Candidate._
