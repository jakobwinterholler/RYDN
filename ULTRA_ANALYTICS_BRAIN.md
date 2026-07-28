# Ultra Analytics

> **⚠️ Superseded (July 2026).** The three‑product ecosystem in this document has
> been replaced by **one app with three phases (Plan · Ride · Review · Repeat)**.
> See **`ULTRA_BRAIN.md`** for the current product vision. This file is kept as
> history: its analysis thinking (Time Ledger, plan‑vs‑actual, stop/climb/hike
> analysis, honesty over coverage) lives on inside the **Review** phase. What's
> dropped: the standalone‑product framing, Replay, and the "AI coach / rider model /
> prediction" pillars.

> **Living document (historical).** The architectural brain for **Ultra Analytics**,
> formerly the third product in the Ultra ecosystem. Sibling docs: `PROJECT_BRAIN.md`
> (Ultra Roadbook + Ultra Companion), `ULTRA_BRAIN.md` (current unified vision).

**Status:** Architecture / pre-code. No implementation yet by explicit instruction.

**Ecosystem position:**

```
🗺  Ultra Roadbook    →  PLAN   the route (where to stop, which climbs, unsupported gaps)
🚴  Ultra Companion   →  RIDE   the plan (execute + record the race, offline, verified)
🧠  Ultra Analytics   →  LEARN  from every ride (why it went that way, what to change)
```

**Ecosystem tagline (proposed refinement):** the current Roadbook tagline is
"Analyze. Plan. Ride." Now that Analytics exists as its own pillar, the honest loop
is **Plan → Ride → Learn → Plan** — a *closed loop*, not a line. Ultra Analytics is
the arc that turns a one-way pipeline into a flywheel.

---

## 0. The thesis (read this first)

Every existing platform analyzes a **workout**. Ultra Analytics analyzes a
**decision-making performance under fatigue**.

An ultra is not won by watts. It is won by *choices made tired*: when to stop, how
long, how hard to climb at hour 30, whether to sleep, what to eat, when to push and
when to conserve. Power meters measure the body. Nobody measures the **decisions** —
because nobody else has the **plan** the rider was executing against.

**We do.** Ultra Roadbook produced the plan. Ultra Companion recorded the execution
*with the plan attached*. That means Ultra Analytics starts every analysis already
knowing the intended stops, the expected gaps, the target pacing, and what the rider
actually did instead. **Plan-vs-actual is our unfair advantage and no competitor can
copy it**, because they never had the plan.

From that we build the crown jewel: a **Rider Model** — a personal, evolving,
portable model of *this specific ultra cyclist* — that flows back into Roadbook
(smarter plans) and Companion (smarter live guidance). The three apps stop being
three apps and become **one operating system for the ultra cyclist**, with a single
identity, a single truth about the rider, and a single learning loop.

If we only ever ship "another dashboard of graphs," we have failed.

---

## 1. Product philosophy

Deliberately inherited from and consistent with `PROJECT_BRAIN.md`, adapted for
analysis:

1. **The software thinks; the rider decides.** Just as Roadbook *suggests* stops
   and the rider *verifies* them, Analytics *proposes insights* and the rider
   *confirms, corrects, or dismisses* them. Every confirmation trains the Rider
   Model. This is the same verification-first DNA — applied to insight instead of
   POIs. (See §11 "human-in-the-loop learning".)

2. **Answer questions, don't display metrics.** The home screen is not a wall of
   charts. It leads with sentences: *"You lost 41 minutes to resupply, 12 of them
   at one stop that gave you almost nothing."* Charts are the *evidence* behind an
   answer, reachable on demand — never the headline.

3. **Time is the currency, not power.** In an ultra, the scoreboard is elapsed
   time. Our foundational analytic is a **Time Ledger** (§ novel ideas): every
   minute of the event accounted for and attributed. Watts, HR, and TSS are inputs
   to that story, not the story.

4. **Plan is ground truth.** Wherever a ride links to a Roadbook plan, the plan is
   the baseline. "Deviation from plan" and "cost of deviation" are first-class.

5. **Fatigue is the subject, not noise.** Every model must be *time-aware*: hour-2
   you and hour-30 you are different athletes. Fresh CP is almost irrelevant.

6. **Learn from every ride, not just races.** A Tuesday endurance ride refines the
   durability curve and fueling model even with no plan attached. The model
   improves continuously and quietly.

7. **The rider owns their model and their data.** The Rider Model is exportable,
   inspectable, and versioned. No black box the rider can't interrogate. Trust —
   the ecosystem's core value — requires it.

8. **Confidence is always visible.** Like stop confidence in Roadbook, every insight
   and every model parameter carries a confidence level (data volume + recency +
   sensor quality). We never state a shaky inference as fact.

9. **Calm, premium, honest.** Same visual restraint as the rest of the ecosystem. No
   dopamine loops, kudos, streaks, or vanity leaderboards. This is a coach, not a
   casino.

10. **Specialist beats generalist.** We will be *narrow and deep* on ultra-distance
    self-supported cycling. We will refuse features that dilute that focus even when
    they'd grow a broader market.

11. **No comparison to strangers.** The benchmark is *your past self under similar
    conditions* (your ghost), never a global segment leaderboard.

12. **The loop is the product.** Any feature that doesn't eventually feed the Rider
    Model or improve a future Plan/Ride is suspect.

---

## 2. User journey

### 2.1 First-time (onboarding the model)
```
Sign in (same account as Roadbook/Companion)
    ↓
Connect a data source (device API or upload FIT/GPX history)
    ↓
Backfill: import last N months of rides
    ↓
Rider Model v0 is bootstrapped (durability curve, zones, fuel/sleep priors)
    ↓
First insight card: "Here's what your history already tells us — confirm or correct."
```
The rider *confirms* a few key facts (typical stop length, how they fuel, how they
sleep on multi-days). Each confirmation raises model confidence immediately, so the
product feels smart on day one.

### 2.2 After a normal training ride
```
Ride auto-imports (device push / Companion / upload)
    ↓
Auto-analysis (durability, fueling estimate, decoupling, terrain-adjusted effort)
    ↓
1–3 insight cards ("Your durability at 4h improved 3% vs last month")
    ↓
Rider Model nudged; no plan comparison (no plan attached)
```

### 2.3 After an ultra (the marquee experience)
```
Companion finishes the race → hands off the Race Log (GPS + plan + verifications + events)
    ↓
Analytics reconstructs the event timeline
    ↓
TIME LEDGER: where every minute went (moving / climbing / stopped / sleeping / lost)
    ↓
PLAN vs ACTUAL: stops taken/skipped/added, gaps survived, pacing adherence
    ↓
KEY MOMENTS: the fade, the costliest climb, the unnecessary stop, the near-bonk
    ↓
DECISION REPLAY + counterfactuals ("skip Stop 7 → save 22 min, risk 40 km dry")
    ↓
COACH DEBRIEF: 3 things that went right, 3 to change, 1 training focus
    ↓
Rider Model version bump → feeds your NEXT Roadbook plan
```

### 2.4 Preparing for the next ultra (closing the loop)
```
Point Analytics at a target event's Roadbook plan (a route Bundle)
    ↓
Analytics scores the route's demands vs YOUR Rider Model
    ↓
Gap analysis ("this route has 3 climbs longer than anything your durability supports")
    ↓
Training focus + a Roadbook plan pre-tuned to your real speed/fuel/sleep numbers
    ↓
Companion executes with live guidance derived from the same model
```

---

## 3. Main screens

Web-first (analysis is data-dense; desktop is the natural home, mirroring Roadbook).
A lightweight mobile view comes later for post-ride debrief.

| Screen | The one question it answers |
|--------|------------------------------|
| **Home / Latest** | "What just happened and what do I do about it?" — the debrief of the most recent ride, leading with sentences, not charts. |
| **Ride Analysis** | "What happened in *this* ride?" — Time Ledger, plan-vs-actual, key moments, streams-on-demand. The heart of the product. |
| **Time Ledger** (a mode of Ride Analysis) | "Where did every minute go?" — the P&L of the event. |
| **Rider Model** | "Who am I as an ultra athlete, and how am I changing?" — durability curve, fueling/sleep signatures, climbing profile, heat/night penalties, trend over time, confidence per dimension. |
| **Coach** | "What should I do next?" — conversational, grounded in *your* data + model. Debriefs, training focus, race prep, ad-hoc Q&A. |
| **Prepare / Next Race** | "Am I ready for *that* route?" — target-route demands vs model, gap analysis, training plan, hand-off to Roadbook. |
| **Library** | "Show me my rides / races over time." — filterable list; races badged and linked to their Roadbook plan. |
| **Compare / Ghost** | "How does this compare to my past self on similar terrain/conditions?" — never strangers. |
| **Trends** | "How am I trending over weeks/months?" — durability, fueling adherence, sleep, load. |
| **Connections** | "Where does my data come from?" — device/wearable/weather integrations, backfill, privacy & export. |

Design guardrail (from the ecosystem): **every screen answers one question.** If a
widget doesn't help the rider leave with that answer, it moves or is cut.

---

## 4. Navigation

```
┌───────────────────────────────────────────────────────────────┐
│  Ultra Analytics                         [rider ▾]  [Coach 🧠]  │
├───────────────────────────────────────────────────────────────┤
│  Home   Rides   Rider Model   Prepare   Trends   Connections   │
└───────────────────────────────────────────────────────────────┘
```

- **Coach is omnipresent** (a persistent side/slide-over), because the coaching
  answer is the product, not a buried tab. Any chart can be "asked about" — select a
  moment on the Time Ledger → "ask Coach about this."
- **Rides → Ride Analysis** is the deep surface; everything else summarizes or
  redirects into it.
- **Cross-product jumps are one click:** a race in the Library deep-links to its
  Roadbook plan and its Companion race log; "Prepare" hands off to Roadbook.
- Mobile (later): a stripped debrief + Coach chat only. No heavy analysis on phone.

---

## 5. Data model

Conceptual (no code). Same principles as Roadbook's Bundle: a **canonical schema is
the contract** between ingestion, analysis, the Rider Model, and the AI layer.

### Core entities
```
rider (1) ──< activity (n)
activity (1) ──< stream_set (1)          # time-series channels
activity (1) ──< detected_event (n)      # stop, sleep, bonk, off-route, mechanical
activity (0..1) ── plan_link (0..1) ──> roadbook_bundle   # the plan being executed
activity (1) ──< insight (n)             # generated, each with confidence + status
rider (1) ──< rider_model_version (n)    # versioned, append-only
rider (1) ──< connection (n)             # device/wearable/weather sources
target_event (0..n) ──> roadbook_bundle  # a future race being prepared for
```

### `activity` (canonical, source-agnostic)
- **Identity:** id, riderId, source (companion | coros | garmin | wahoo | upload),
  sourceId, importedAt, schemaVersion
- **Classification:** type (`training` | `ultra` | `race` | `commute`),
  isMultiDay, startAt, endAt, timezone
- **Summary:** distanceKm, elapsedS, movingS, elevationGainM, avgPower, NP, HRavg,
  kJ, TSS-equivalent (ultra-adjusted)
- **Context:** startLocation, weatherProfile (temp/wind/precip over time), surface
  mix, dayNightSplit
- **Links:** planLinkId, deviceIds

### `stream_set` (the raw truth, decimated + full)
Channels aligned on a common time base: `time, lat, lon, ele, distance, speed,
power, hr, cadence, temperature, gradeFromRoute`. Stored both full-resolution
(cold) and decimated (hot, for fast rendering) — mirrors Companion's elevation
decimation approach.

### `detected_event` (the ultra-specific layer — this is where we win)
- type: `stop` | `sleep` | `bonk/fade` | `off_route` | `mechanical_suspected` |
  `night` | `heat_stress` | `dehydration_suspected`
- startAt, endAt, km, lat/lon, durationS
- **stop-specific:** matchedPlanStopId (from the Bundle!), category, wasPlanned
  (bool), wasVerifiedInCompanion (bool), estimatedCaloriesAcquired,
  estimatedLitersAcquired, efficiencyScore
- confidence, evidence (why we think this happened)

> **Stop classification is behaviour-first, location-last.** A stop's category is
> earned from what the rider *did* — hours stationary, whether the device stopped
> recording, time of day — never from what happened to be nearby. A hotel/sleep
> requires a strong behavioural signature (≈3 h+ stationary, no data recorded,
> overnight); a nearby hotel can only *raise confidence*, never create the label,
> and a 10-minute stop is never a hotel. The classifier is an **additive evidence
> model** (`analysis/stop_classifier.py`): each signal contributes weighted
> evidence with a human reason, external signals (POIs, accommodation) are
> deliberately too weak to classify alone, and authoritative signals (a Roadbook/
> Companion **verified** stop, a **rider correction**) short-circuit to near-
> certainty. Every stop carries a **confidence** and its reasons; when the best
> guess can't clear the threshold we return **unknown** on purpose. *Accuracy
> beats coverage — never confidently give the wrong answer.* New signals plug in
> without touching the rest of the pipeline.

### `plan_link` (the moat)
- bundleId, bundleRevision, bundleChecksum (reuse Roadbook's identity fields)
- adherenceScore, plannedStops[], takenPlannedStops[], skippedPlannedStops[],
  unplannedStops[], gapOutcomes[] (survived / refuel-early / ran-dry)

### `insight`
- id, activityId (or riderId for cross-ride), category, headlineSentence,
  evidenceRefs (chart/segment pointers), magnitude (e.g. minutesLost),
  confidence, status (`proposed` | `confirmed` | `corrected` | `dismissed`),
  riderFeedback → **feeds Rider Model** (see §11).

### `rider_model_version`
See §11. Append-only, versioned, diff-able, exportable.

### Storage & privacy
- **Reuse the ecosystem Supabase** (single account, Postgres + RLS + Storage) so
  identity and ownership are shared with Roadbook/Companion. Analytics adds its own
  tables/bucket; RLS keeps every row rider-owned.
- Big cold streams in object storage (FIT/Parquet); hot summaries + events + model
  in Postgres for query speed.
- Full rider export ("download everything") and model portability are first-class.

---

## 6. AI architecture

Three layers, from deterministic to generative. **The LLM never invents numbers** —
it narrates a deterministic analysis and is grounded by retrieval.

```
┌──────────────────────────────────────────────────────────────┐
│ LAYER 1 — DETERMINISTIC ANALYSIS (Python, no LLM)            │
│  Signal cleaning · stop/sleep/fade detection · Time Ledger   │
│  durability curve fit · fueling balance · plan-vs-actual     │
│  terrain/weather normalization · counterfactual simulation   │
│  → emits structured facts + confidences (never prose)        │
└───────────────────────────┬──────────────────────────────────┘
                            │ structured facts
┌───────────────────────────▼──────────────────────────────────┐
│ LAYER 2 — INSIGHT ENGINE (rules + small models)              │
│  Turns facts into ranked, deduped INSIGHT objects            │
│  Thresholds, personal baselines (from Rider Model), novelty  │
│  → the "answers" (headline sentences + evidence + magnitude) │
└───────────────────────────┬──────────────────────────────────┘
                            │ insights + retrieval context
┌───────────────────────────▼──────────────────────────────────┐
│ LAYER 3 — COACH (LLM, retrieval-grounded)                    │
│  RAG over: this rider's activities, events, insights, model  │
│  + ultra domain knowledge base (curated, not the open web)   │
│  Debriefs, training focus, race prep, conversational Q&A     │
│  Tool-use: query the rider's own data; run counterfactuals   │
└──────────────────────────────────────────────────────────────┘
```

Principles:
- **Grounding over generation.** Layer 3 cites Layer 1/2 facts; if a number isn't in
  the structured facts, the coach doesn't state it.
- **The Rider Model is the retrieval anchor** — the coach reasons about *this* rider,
  not a generic athlete.
- **Tool-use, not hallucination.** The coach can *call* the counterfactual simulator
  and data queries rather than guessing.
- **Confidence propagates** end-to-end into what the coach says ("tentatively…",
  "with high confidence…").
- **Model-agnostic + swappable.** Treat the LLM as a replaceable component behind an
  interface; own the prompts, retrieval, and evaluation set. Domain knowledge base is
  curated ultra-cycling content (fueling science, heat, sleep, pacing), versioned.
- **Offline/cost fallback:** Layers 1–2 fully work without the LLM; the product is
  useful even if Layer 3 is unavailable.

---

## 7. Import architecture

Canonicalization is everything: many messy sources → one `activity` schema (the
same discipline as Roadbook's Bundle).

```
SOURCES                         INGEST                    NORMALIZE            ENRICH
─────────────────────────────   ───────────────────────   ─────────────────    ─────────────
Companion Race Log (best) ───┐
Coros / Garmin / Wahoo API ──┤
FIT / TCX / GPX upload ──────┼─▶ parse + validate ──▶ canonical activity ──▶ weather (time+loc)
Wearables (sleep/HRV) ───────┤   dedupe (fingerprint)     + stream_set          surface (from route)
Manual (notes, fuel log) ────┘   time-align channels      + detected_events     elevation correction
                                                                                 device-quality flags
```

- **Companion Race Log is the premium source** — it uniquely carries the *plan*, the
  *verifications*, GPS, wake/sleep and rider-marked events. Ultra imports should
  prefer it. (See §10.)
- **Device APIs (OAuth) + file upload** cover training rides and non-Companion races.
  FIT is the priority format (power/HR/temperature richness).
- **Deduplication by fingerprint** (start time + distance + geometry hash), reusing
  the ecosystem's checksum instinct, so the same ride from two sources merges rather
  than doubles.
- **Backfill on connect** — pull history to bootstrap the Rider Model immediately.
- **Enrichment is automatic**: historical weather at ride time/place, surface from
  the matched route, barometric elevation correction, sensor-quality tagging.
- **Idempotent + resumable** imports; large multi-day FITs stream-parsed (learn from
  the 800 km GPX lessons in Roadbook: size caps, chunking, no full in-memory loads).

---

## 8. Future integrations

| Category | Examples | Why |
|----------|----------|-----|
| **Head units** | Coros, Garmin, Wahoo (API + FIT) | Primary ride data. Coros first (ecosystem already exports to it). |
| **Wearables / recovery** | Whoop, Oura, Garmin sleep, Apple Health, HRV apps | Sleep & recovery are decisive in multi-day ultras. |
| **Environment** | Historical + forecast weather, heat index, air quality, sun/moon (night detection) | Condition-adjusted performance & night penalties. |
| **Physiology (later)** | CGM (glucose), core temp, power-based fatigue sensors | Direct fueling & heat truth instead of estimates. |
| **Nutrition** | Fuel logging, product databases | Close the carbs-in vs carbs-out loop. |
| **Race data** | Event GPX/route libraries, checkpoint/CP times, brevet/ACP results | Turn official event data into plan + benchmark context. |
| **Ecosystem (core)** | **Ultra Roadbook** (plans in), **Ultra Companion** (race logs in, guidance out) | The flywheel. |
| **Outbound** | Export insights/model; optional read-only share of a debrief | Rider owns and can share their data. |

Explicit stance: **no generic social network, no global segment leaderboards, no
kudos economy.** Sharing, if ever, is deliberate and private (share *a debrief*, not
a feed).

---

## 9. Connection with Ultra Roadbook

This is half the flywheel. It is **bidirectional**.

**Analytics reads from Roadbook:**
- The plan **Bundle** (schema v5+) is imported as `plan_link` ground truth: planned
  stops, unsupported gaps, climbs, `riderAssumptions`.
- A target route's Bundle powers **Prepare** (route demands vs Rider Model).

**Analytics writes back to Roadbook** (the part nobody else can do):
- The **Rider Model** replaces Roadbook's *static* `riderAssumptions` (speed, water,
  carbs, max gap — reserved fields already exist in the Bundle) with **learned,
  personal, condition-aware** values. Suddenly Roadbook plans in *your* numbers:
  your real climbing speed, your true max unsupported range at hour 30, your fueling
  rate, your night slowdown.
- **Durability-aware stop placement:** Roadbook can space resupply using your fade
  curve, not a flat assumption — stops cluster where the model predicts you'll be
  hurting.
- **Confidence hand-off:** Roadbook can show "planned using your Rider Model v7
  (high confidence)" vs "generic defaults (no data yet)."

Contract: reuse the Bundle's identity fields (`schemaVersion`, `revision`,
`bundleChecksum`) so plan-vs-actual links are exact and versioned. Rider Model is
published to a shared, versioned location both apps read.

---

## 10. Connection with Ultra Companion

Companion is both the **best recorder** and, eventually, a **live consumer** of the
model.

**Companion → Analytics (recording):**
- Companion already holds the live bundle, GPS (with map-matched `currentKm`), wake
  lock, verification events, and offline IndexedDB storage. It emits a **Race Log**:
  GPS/streams + the exact plan + verifications + rider-marked events (stop start/end,
  "sleeping now", mechanical, off-route).
- This log is the richest possible ultra dataset because *the plan is attached* and
  stops are *already labeled* (verified vs skipped). No inference needed for the
  hardest-to-detect events.
- Handoff is cloud-native (same Supabase account); offline logs upload when signal
  returns — reusing Companion's existing offline-first sync discipline.

**Analytics → Companion (live guidance — later phases):**
- The Rider Model powers **live, durability-aware pacing**: "you're riding hour-2
  watts at hour-28 — ease up or you'll fade before the 60 km gap."
- **Smart stop nudges:** "your model says you refuel too long here; 8 min is enough."
- **Sleep timing:** "based on your sleep signature, a 90-min sleep now beats pushing
  to CP4."
- This turns the proposed **Active Race mode** (see `PROJECT_BRAIN.md` long-term
  vision) from a static plan display into a *living co-pilot* — the model whispering
  the right decision at the right km.

Design symmetry: Companion stays **pure execution** (no heavy analysis on the bike);
Analytics does the thinking off-bike and ships *small, decisive hints* to Companion.

---

## 11. Rider Model

The **crown jewel**. A personal, evolving, versioned, portable model of one ultra
cyclist. It is what makes the ecosystem an *operating system* rather than three
tools.

### What it captures (dimensions)
| Dimension | Example parameters |
|-----------|--------------------|
| **Durability curve** | Power/pace sustainable as a function of *accumulated fatigue and elapsed time* — "the fade." Not fresh CP. |
| **Climbing signature** | Sustainable VAM by climb length & gradient, fresh vs deep-fatigue. |
| **Fueling model** | Sustainable carbs/hour, gut tolerance, bonk threshold, recovery-per-stop. |
| **Hydration model** | Sweat/fluid needs vs temperature; dehydration risk curve. |
| **Sleep signature** | Performance decay vs hours awake; recovery per sleep block; optimal sleep timing/duration. |
| **Thermal profile** | Performance penalty in heat/cold; acclimatization state. |
| **Diurnal profile** | Night slowdown, circadian low points. |
| **Stop behavior** | Typical/optimal stop cadence & duration; efficiency. |
| **Terrain profile** | Surface-adjusted speed (tarmac vs gravel). |
| **Hike-a-bike profile** | Where the rider dismounts (grade/surface thresholds), walking pace with the bike, % of climbing typically done on foot, walked VAM vs ridden VAM. Ultra-specific — competitors treat this as slow riding or a stop, corrupting both pacing and durability. |
| **Pacing discipline** | Tendency to start too hard; adherence to plan. |

> **Movement is four states, not two.** Analytics classifies every second as
> *riding*, *hike-a-bike*, *stopped*, or a recording gap. Hike-a-bike is neither
> riding nor a stop: it still covers route distance and elevation on foot. It is
> measured separately everywhere (Time Ledger, Overview, climbs, replay) and
> **excluded from pacing/fatigue analysis**, so a mandatory unrideable pitch is never
> misread as a bonk or bad pacing. This feeds the Rider Model's *hike-a-bike profile*
> and lets Roadbook flag likely hike-a-bike sections when planning a route.

Each parameter has a **value, uncertainty, confidence, and provenance** (which rides
informed it).

### How it learns
- Every processed activity proposes small Bayesian-style updates (recent + relevant
  rides weighted higher; multi-day ultras weighted most for the fatigue dimensions).
- **Human-in-the-loop (on brand):** insights the rider **confirms/corrects** update
  the model with high weight — the same "software suggests, rider decides" contract
  as Roadbook verification. E.g. "Was Stop 7 a real sleep or just a long break?" →
  the answer sharpens the sleep model.
- **Versioned & explainable:** `rider_model_version` is append-only; every version
  diffs against the last with a one-line reason ("durability at 20h +4% after The
  Capitals"). The rider can see *why* they're modeled this way and roll back.

### Why it's the moat
- It is built from **plan-linked, labeled ultra data** competitors never have.
- It is **cross-product**: read by Roadbook (planning) and Companion (live guidance),
  written by Analytics. The more you use any app, the better all three get.
- It is **portable and owned** by the rider (export), which builds the trust the
  ecosystem is founded on.

---

## 12. Long-term roadmap

Phased toward "the operating system for ultra cyclists." Each phase must deepen the
loop, not widen the surface.

### Phase 1 — Foundation & the marquee debrief (0→1)
- Ingestion + canonical `activity` + streams; FIT/GPX/Coros import; dedupe; weather
  enrichment.
- **Time Ledger** and **plan-vs-actual** for Companion-recorded ultras.
- Ride Analysis + Home debrief (sentences-first). Library.
- Rider Model v0 (durability + fueling + stop behavior) bootstrapped from backfill.
- *Success test:* after a real ultra, the rider says "this told me something I
  couldn't have seen anywhere else."

### Phase 2 — The loop closes
- Rider Model published back to Roadbook (`riderAssumptions` → learned values).
- **Prepare / Next Race** (route demands vs model, gap analysis).
- Coach v1 (retrieval-grounded debriefs + training focus + Q&A).
- Sleep/recovery integrations (Whoop/Oura/Garmin) → multi-day fatigue modeling.

### Phase 3 — Live intelligence
- Analytics → Companion live guidance (durability-aware pacing, stop/sleep nudges).
- Powers the **Active Race** co-pilot vision.
- Counterfactual simulator exposed to riders ("replay with one less stop").

### Phase 4 — The specialist coach
- Coach becomes a genuine periodized **training planner** for a target ultra, tuned
  to the model and the target route; adapts as new rides arrive.
- Ghost/self-benchmarking across conditions; trend intelligence.

### Phase 5 — The ecosystem OS
- The Rider Model is the shared brain of all three apps; identity, plans, execution,
  and learning are one continuous system.
- Optional integrations (CGM, core temp) push the model from *estimated* to
  *measured*. Deliberate, private sharing of debriefs.
- Ambition: the tool an ultra cyclist opens for *every* decision — before, during,
  and after every ride — and would not race without.

---

## Assumptions challenged

- **"Analytics = dashboards."** Rejected. The deliverable is *answers and a better
  next race*, not graphs. Charts are evidence, not product.
- **"Compete with Strava/TrainingPeaks/intervals.icu."** Rejected. They own broad
  training analytics; we win a niche they *structurally* can't serve, because they
  lack the plan. Narrow and deep.
- **"Power/TSS is the truth."** Rejected as the headline. In ultras, *time and
  decisions under fatigue* are the truth; classic training-load metrics are
  fatigue-blind and multi-day-blind.
- **"More data sources = better."** Only if they feed the model or a decision. We'll
  say no to integrations that don't.
- **"AI coach = a chatbot on top of graphs."** Rejected. The coach is grounded in a
  deterministic analysis layer + the Rider Model; it narrates and reasons, it does
  not invent.
- **"Build a mobile analysis app."** Deprioritized. Deep analysis is desktop-native;
  the phone is Companion's job (execution) + a light debrief later.

## Ideas you may not have considered

1. **Time Ledger (P&L for time).** Every minute of an event attributed to
   moving/climbing/stopped/sleeping/off-route/mechanical/lost. The single most
   clarifying artifact an ultra rider has ever seen — and only possible with
   plan-linked data.
2. **Decision Replay + counterfactuals.** Reconstruct the key fork points and
   simulate the roads not taken ("skip Stop 7 → −22 min, +risk of running dry").
3. **Cost-of-deviation accounting.** Quantify what each divergence from the plan
   actually cost or saved — turns "I improvised" into a number.
4. **Resupply efficiency score.** Minutes stopped per useful calorie/liter acquired;
   flags the stop that cost 12 minutes for a coffee.
5. **The "fade" as a first-class curve.** Model performance vs *hours in*, not fresh
   CP — the real ultra fitness signature.
6. **Rider Model as a portable "genome"** shared across all three apps and owned by
   the rider — the ecosystem's true moat.
7. **Human-in-the-loop insight confirmation** (verification-first, applied to
   analysis) — trust + a self-improving model in one mechanic.
8. **Prepare-for-*this*-route:** score a specific target Roadbook against the rider's
   model and surface concrete gaps, then pre-tune the plan and training.
9. **Live model → Companion guidance:** the model whispers the right decision at the
   right km, turning Active Race into a real co-pilot.
10. **Condition-normalized ghost:** compare to your past self under matched
    heat/terrain/fatigue — fair, motivating, private.
11. **Confidence-scored everything** so the product is honest on day one and grows
    more assertive as it learns.

## Non-goals (what Ultra Analytics will NOT be)

- Not a social network, feed, or kudos/leaderboard app.
- Not a generic training-load tracker for all cycling disciplines.
- Not a route planner (that's Roabook) or a bike computer (that's Companion).
- Not a black box — no unexplained scores the rider can't interrogate.
- Not a data hoarder — the rider owns and can export everything.

## Open questions / decisions to make

- **Rider Model math:** hand-tuned Bayesian updates vs learned models — start
  interpretable (trust + explainability), revisit as data grows.
- **Event auto-detection vs Companion labels:** how much to infer for non-Companion
  ultras (uploads) where stops/sleep aren't labeled.
- **LLM hosting & cost model** for Coach at scale; how much runs offline in Layers
  1–2.
- **Where the Rider Model lives** so all three apps read/write it cleanly (shared
  Supabase table + versioned document is the leading candidate).
- **Monetization** (out of scope here, but the model/loop suggests a coaching
  subscription rather than a data-dashboard fee).

## Glossary

- **Rider Model** — versioned, personal model of the athlete; the ecosystem's shared
  brain. (§11)
- **Time Ledger** — full attribution of every minute of an event. (§ ideas)
- **Plan-vs-actual / plan_link** — the ride measured against its Roadbook plan. (§5, §9)
- **Race Log** — Companion's rich, plan-attached recording of an ultra. (§10)
- **Insight** — a confidence-scored, confirmable answer (not a metric). (§1, §5)
- **The fade / durability curve** — performance as a function of accumulated fatigue
  and time. (§11)

---

## Maintenance instruction

When a significant decision or feature lands, update this document: adjust the
relevant section, add a dated note, and record challenged assumptions or rejected
ideas. Keep prose concise. Never delete historical decisions — move them to a
"rejected/superseded" note instead. This file is to Ultra Analytics what
`PROJECT_BRAIN.md` is to Roadbook + Companion.
