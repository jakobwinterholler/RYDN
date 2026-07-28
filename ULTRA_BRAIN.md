# Ultra — Product Brain

> **Living document. Single source of truth.** Supersedes the three‑product split in
> `PROJECT_BRAIN.md` (Roadbook + Companion) and `ULTRA_ANALYTICS_BRAIN.md`
> (Analytics). Those remain as history. From here on there is **one app**.

**Status:** Product vision / architecture. Written to be true in five years and
buildable next week.

**Last crystallised (July 2026):** Ultra is an **experience platform**. Completed
Ultras are the trophy cabinet; every finished Ultra improves planning for the next.

---

## 0. The one sentence

> **Ultra builds my experience over years of ultra racing — every finished Ultra
> makes the next plan smarter.**

The workflow is a closed loop:

```
Import GPX
    → Generate execution plans (Aggressive / Balanced / Comfort)
    → Verify execution (booked · confirmed · open · backup)
    → Ride
    → Review
    → Save as Completed Ultra
    → Learn from experience
    → Use that experience for the next Ultra
```

Ultra does **not** just store rides. It accumulates **experience**.

---

## 1. What Ultra is

Ultra is one application (desktop + mobile) for ultra cyclists and serious
endurance riders. It has two primary product surfaces:

| Surface | Job |
|---|---|
| **Planning** | Turn a GPX into verified execution strategies, informed by past Ultras |
| **Completed** | A trophy cabinet of finished Ultras — grouped events, not a Strava dump |

Training rides still matter (curves, fitness, Review), but they are **not** the
hero object. The hero object is an **Ultra**.

### 1.1 The Ultra (canonical object)

An **Ultra** is a named event or expedition — not a single Strava activity.

Examples:

- The Capitals 2026
- NorthCape 2027
- Trans Pyrenees
- Silk Road Mountain Race
- Tuscany Trail 2027

An Ultra **contains** one or more source activities:

- one Strava activity, **or**
- multiple Strava activities (Day 1 / Day 2 / Day 3 …), **or**
- uploaded FIT / TCX / GPX files, **or**
- any mix of the above

```
Ultra: The Capitals 2026
├── Day 1  (Strava activity)
├── Day 2  (Strava activity)
└── Day 3  (Strava activity)
        ↓ merged track + one Review + one trophy card
```

Strava activities are **ingredients**. The Ultra is the **dish**.

### 1.2 Lifecycle of an Ultra

```
Draft → Planning → Ready → In Progress → Completed → Reviewed
```

- Early states live under **Planning**.
- Late states live under **Completed** (the trophy cabinet).
- After Review, the Ultra becomes **experience** usable for the next Plan.

---

## 2. Principles (the constitution)

1. **Experience compounds.** Every Completed Ultra should make the next Plan better.
2. **Ultras, not activity dumps.** Completed is a collection of events people want to
   screenshot — never a raw Strava list as the primary UI.
3. **Humans create Ultras.** Import lands in Library only. Software may suggest related
   days; it never auto-creates an Ultra. Software suggests; humans decide.
4. **Ultras stay editable.** An Ultra is a folder the rider owns — rename, re-date,
   add/remove/reorder days anytime. Never locked after creation.
5. **Infer first.** Countries, date range, and day order come from ride data when
   possible. Riders only enter what software cannot know (name, result). Override always.
6. **Suggestions, then verification.** Plans propose; the rider verifies. No silent
   commitments.
7. **One question per page.** If a page answers two, split or delete.
8. **Invent metrics, not charts.** Charts only exist to draw a metric that answers a
   question.
9. **Explore, don't read a report.** Review is visual exploration; AI is optional and
   last.
10. **Honesty over coverage.** Thin data → say so. Never fabricate insight.
11. **The rider decides; the app thinks.** Surface the decision; never hide the route
   or silently change the plan.
12. **Calm under fatigue.** Ride phase: big targets, few words, offline.
13. **Accuracy over flashy peaks.** (e.g. speed curves start at 5s; GPS spikes
    clamped.)

The breath test: **can a rider explain Ultra as "I plan with my past Ultras, I ride,
I review, I save the Ultra, I get better"?**

---

## 3. Navigation & information architecture

Two primary sections. Everything else nests under them.

### Planning

- Upcoming Ultras / drafts
- Planned routes (imported GPX)
- Strategy plans (Aggressive / Balanced / Comfort)
- Route verification
- Resupply planning
- Sleep planning
- Checklists & notes

### Completed

- Completed Ultras (trophy cabinet)
- Review / analytics / metrics / comparisons / insights
- (Secondary) training rides and ungrouped activities — available, not the hero

```
HOME
├── Planning     ← next Ultra
└── Completed    ← trophy cabinet of past Ultras
```

Open an Ultra → land in the phase that matters now:

```
   ⟨  PLAN  |  RIDE  |  REVIEW  ⟩
```

---

## 4. Completed Ultras — the trophy cabinet

Completed is a **collection**, not a feed.

Each Ultra has a **card people want to screenshot and share**.

```
┌─────────────────────────────────────┐
│  🏔  THE CAPITALS              2026 │
│                                     │
│  800 km · 14,000 m · 55h 12m        │
│  14th Overall                       │
│  ★★★★☆                              │
│                         COMPLETED   │
└─────────────────────────────────────┘
```

### Card metadata (optional, progressive)

| Field | Notes |
|---|---|
| Name | Event / expedition title |
| Year | Edition |
| Cover | Custom image or generated atmosphere |
| Event logo | If available |
| Country / flag | Region signal |
| Distance | Sum of contained activities |
| Elevation | Sum |
| Elapsed time | Event clock |
| Finish place | e.g. 14th Overall |
| Finish percentile | When field size known |
| Personal rating | 1–5 stars |
| Completed badge | Always for finished Ultras |

Visual bar: premium, calm, scrapbook / cabinet — not a dashboard of list rows.

### Grouping workflow

1. Import / sync activities (Strava or files).
2. **Create Ultra** / **Add to Ultra** — attach Day 1…n.
3. Ultra aggregates distance, elevation, time, Review.
4. Rider adds place, rating, cover, year.
5. Card lands in the cabinet forever.

---

## 5. PLAN — experience-based execution planning

### 5.1 Import GPX → multiple strategies

After importing a route, Ultra generates **several execution plans**, not one:

| Strategy | Intent |
|---|---|
| **Aggressive** | Longer days, less sleep, earlier finish |
| **Balanced** | Default sustainable race |
| **Comfort** | Shorter days, more sleep, lower risk |

Each plan is a **suggestion set**, not a fixed decision. It includes:

- Daily ride distances
- Estimated arrival times
- Suggested sleep locations
- Hotels near the route (**flag 24h reception** when known)
- Supermarkets
- Water opportunities
- Resupply timing
- Unsupported sections
- Suggested bivy alternatives
- Estimated finish time

### 5.2 "Use previous experience"

When planning a new Ultra, the rider can choose:

> **Base this plan on: The Capitals 2026**

Ultra then applies learned preferences / capacities from that Completed Ultra
(and later, aggregates across many):

- Daily riding capacity
- Preferred sleep duration
- Preferred stop frequency
- Preferred ride start time
- Preferred nutrition timing
- Preferred average / moving speed
- Preferred climbing pace
- Night riding behaviour
- Performance after 20+ hours
- Stop efficiency / resupply patterns (from Review)

This is **experience replay into planning** — concrete, inspectable defaults — not
an opaque "AI coach."

### 5.3 Verification workflow

Planning becomes **verify each suggestion**:

| Check | Example |
|---|---|
| ✓ Hotel booked | Sleep stop committed |
| ✓ Supermarket confirmed | Resupply exists |
| ✓ Water available | Source trusted |
| ✓ Opens before arrival | Hours vs ETA |
| ✓ Reception confirmed | 24h / late check-in |
| ✓ Backup option available | Bivy / alt hotel |

Readiness is the verification state of the chosen strategy — e.g.

> *"Almost ready. One 92 km gap has no verified water."*

Export remains: waypoints on the **original, unmodified** GPX.

---

## 6. RIDE — "What do I need right now?"

One screen. Minimal, fast, offline‑first. Built for hour 30.

```
THE CAPITALS               km 412 / 823
────────────────────────────────────────
NEXT RESUPPLY    ▼  Gas station · 18 km
NEXT SLEEP       ▼  Hotel · 64 km · verified
UNSUPPORTED GAP  ▼  next: 64 km after km 470
────────────────────────────────────────
[ Map ] [ Street View ] [ Search ] [ Verify ]
```

Records execution against the verified Plan so Review can do plan‑vs‑actual.

---

## 7. REVIEW — "What actually happened?"

Review explores the **Ultra** (merged days), not each Strava activity in isolation.

Hierarchy on every page:

```
1. Metrics → 2. Graphs → 3. Curves → 4. Small insights → 5. Optional AI
```

### Training-quality curves (every Ultra / ride)

Power duration, NP, best average speed (**min 5s**, GPS spikes clamped; moving +
elapsed), elevation gain, HR, cadence, temperature, fatigue, power fade, HR drift,
time in zones.

### Ultra-specific set

Time Ledger · Stops · Sleep · Hike‑a‑bike · Resupply efficiency · Unsupported
sections · Fueling · Weather/heat · Decision analysis — always threaded by
**plan‑vs‑actual** when a Plan exists.

### Signature metrics (invent these)

Stop Efficiency · Resupply Cost · Decision Cost · Hike‑a‑bike Efficiency ·
Moving vs Elapsed Speed gap · Fatigue Curve · Climbing Efficiency · Unsupported
Section Performance · Sleep Efficiency · Recovery After Sleep · Power Recovery
After Stops.

Review is **not** an AI report, **not** a chart dump, **not** Replay.

When Review is done, the Ultra is saved into the **Completed** cabinet and its
experience profile becomes available for the next Plan.

---

## 8. EXPERIENCE — the compound interest layer

"Repeat" is not a black-box rider model. It is **structured experience** extracted
from Completed Ultras and applied when the rider picks **"Use previous experience."**

```
Completed Ultra
    → Experience profile (speeds, sleep, stops, night, 20h+ fade, …)
    → Next Plan strategies (Aggressive / Balanced / Comfort)
    → Verified execution
    → New Completed Ultra
```

Year one: pick one past Ultra as the base.  
Later: blend several Ultras / seasons — still as plain, inspectable preferences,
never an opaque score.

---

## 9. What we deliberately will not build

- Treating Strava's activity list as the product
- Three separate apps
- Replay as a pillar
- AI as the primary experience
- Opaque "predictions / rider model" without inspectable experience
- Social feed / kudos
- Multi-sport

---

## 10. Integrations

- **Strava** — primary activity source (ingredients for Ultras).
- **FIT / TCX / GPX upload** — secondary / multi-day merge / non-Strava devices.
- **GPX route import** — planning entry point.
- **Export** — verified stops as waypoints on the unmodified track.
- **Weather** — forecast for Plan; historical for Review.
- No Garmin Connect / COROS / Wahoo account logins — files only.

---

## 11. Five-year roadmap (deeper, not wider)

**Year 1 — Ultras + trustworthy Review + plan loop skeleton.**
- Ultra entity (group activities) + Completed trophy cabinet.
- Review curves + ultra set v1.
- Plan: GPX import, three strategies stub, verification checklist, "use experience"
  picker (manual defaults from one Ultra).

**Year 2 — Beautiful cabinet + real experience defaults.**
- Covers, places, ratings, logos; experience profile auto-filled from Review.
- Hotels / 24h reception / water / supermarket enrichment on strategies.

**Year 3 — Deep ultra metrics + tighter verification.**
- Sleep, recovery, fueling, heat; verification tied to ETA vs opening hours.

**Year 4 — Decision cost + multi-Ultra experience blend.**

**Year 5 — The experience platform for ultra cycling** — years of cabinet + plans
that clearly get smarter, still explainable in one breath.

---

## 12. Positioning

- **Strava:** activities and social. We turn activities into **Completed Ultras** and
  **experience**.
- **Komoot:** routing. We turn a route into **verified execution strategies**.
- **intervals.icu / TrainingPeaks:** training physiology. We match curve quality and
  add ultra execution + experience compounding.
- **Nobody else** owns: Plan with my past Ultras → Verify → Ride → Review → Cabinet →
  next Ultra.

---

## 13. Build state (v0.3 direction — July 2026)

**Shipping now / next:** Review quality, auth, Strava sync, Home split
Planning | Completed, Ultra entity + trophy-cabinet UI for Completed Ultras,
lifecycle statuses, trustworthy speed curves.

**Design-only / stubbed:** Multi-strategy plan generation, hotel POI enrichment,
experience profile extraction, full verification workflow, Ride phase.

**Code home:** `ultra-analytics/` (accounts, Strava, Review). Desktop Roadbook /
Companion remain the historical Plan + Ride implementations until folded in.

**Data direction:**

```
User
├── ultras[]          ← hero objects (events)
│   ├── meta (name, year, place, rating, cover, …)
│   ├── status (lifecycle)
│   ├── activityIds[] (Strava / uploads)
│   ├── plan? / strategies?
│   └── experience?   ← extracted after Review
└── activities[]      ← raw ingredients (Strava stubs + analysed files)
```

---

## History of this document

- **v0.1** — One app, Plan · Ride · Review · Repeat; Review-first build.
- **v0.2** — Planning | Completed nav; ride lifecycle; speed-curve honesty.
- **v0.3** — Experience platform: Completed Ultras as trophy cabinet; multi-activity
  Ultra object; experience-based multi-strategy planning + verification loop.
