# RYDN — Design Constitution

> **Living document.** Brand · Product · System · Roadmap.  
> Written as if the product has **no interface yet**. Current UI is irrelevant.  
> Domain: [https://rydn.bike](https://rydn.bike)

**Role of this file:** The design source of truth. Implementation follows it outward — tokens → components → screens — never the reverse.

**Status:** Constitution frozen. Execution mode — P0 in progress (Design System + App Shell).

---

# 0. First principles (read this before everything)

## 0.1 Primacy of clarity

**The highest priority of RYDN is not beauty. It is clarity.**

When values conflict, resolve them in this order — every time:

| Conflict | Winner |
|---|---|
| Beautiful vs **easy to understand** | Easy to understand |
| Minimal vs **easy to use** | Easy to use |
| Clever vs **obvious** | Obvious |

Beauty, minimalism, and craft remain mandatory — but they serve clarity. They never outrank it.

RYDN should feel **almost impossible to misuse**.

Every screen must answer immediately:

1. **Where am I?**
2. **What am I looking at?**
3. **What can I do next?**
4. **What is the primary action?**

No user should have to think about the interface. The interface should disappear.

Someone who has never used RYDN should understand the product in **less than one minute**.

- Every click should **reduce uncertainty**.
- Every page should have **one purpose**.
- Every button should have **one obvious meaning**.
- If a feature requires an explanation → **simplify it**.
- If a workflow needs a tutorial → **redesign it**.

### The five-second / thirty-second / one-hand tests

Before any screen ships, ask:

1. Can someone understand this in **five seconds**?
2. Can they complete the main task in **under thirty seconds**?
3. Can **one hand** use it on an iPhone after **twelve hours on the bike**?

If any answer is no → redesign. Do not ship and “add a tooltip later.”

### The design benchmark (not other designers)

Do not design to impress designers.

Design for:

> **A tired ultra cyclist in a hotel at midnight** — dirty kit on the chair, one phone charge left, brain half-offline, needing to know what is verified for tomorrow and what is still open.

That person is the acceptance test for every screen, every label, every tap target, every metric order.

If it only works for a rested product manager on a 27″ monitor, it is not RYDN.

### Consistency is clarity over time

Clarity is not only first paint — it is muscle memory.

- Buttons always behave the same.
- Cards always use the same hierarchy (year → name → score line → secondary).
- Metrics always appear in the same order: **distance → elevation → elapsed**.
- Navigation never surprises.
- Primary action is always visually primary — one per view.

After a few sessions, the rider should not look for controls. Their thumb should already know.

---

## 0.2 What RYDN is (product)

RYDN is not a fitness tracker with better fonts.

It is the **operating system for ultra racing experience** — plan the next expedition with the wisdom of every one you finished.

Analogies that matter (and why):

| Reference | Steal this | Leave this |
|---|---|---|
| **Apple** | Restraint, materials, hierarchy, silence | Consumer gadget gloss |
| **Linear** | Speed of comprehension, keyboard-grade density without clutter | Issue-tracker metaphors |
| **Notion** | Calm canvas, typography as structure | Infinite nested databases |
| **Arc** | Opinionated chrome, spaces with purpose | Browser chrome gimmicks |
| **Flighty** | One domain, obsessive craft, glanceable truth | Aviation kitsch |
| **Superhuman** | Rituals, muscle memory, “this was made for people who care” | Email anxiety |

**The 30-second test:** A rider opens RYDN after a 20-hour stage. Within 30 seconds they know: *where they are in the loop, what matters next, and that the product respects their fatigue.*

**The anti-test:** If a screen could live inside Strava, Garmin Connect, or TrainingPeaks without anyone noticing — delete it.

---

# 1. Brand Identity

## What is RYDN?

**RYDN** (pronounced *ridden*) is the experience platform for ultra cyclists.

Not a log of rides. A growing record of **what you have ridden — and what that taught you**.

The product name is RYDN.  
The hero object inside the product is an **Ultra**.  
The domain is **rydn.bike**.

> Ultra is what you do.  
> RYDN is where it lives.

## Mission

Help ultra cyclists turn every finished race into clearer judgment for the next one — with calm software that never gets in the way of the ride.

## Vision

In five years, serious ultra cyclists plan expeditions in RYDN the way pilots brief flights in Flighty: with history, precision, and trust — and they would never go back to spreadsheets, Komoot dumps, and Strava folders.

## Core values

1. **Clarity above all.** Easy to understand beats beautiful; easy to use beats minimal; obvious beats clever.
2. **Experience compounds.** Finished Ultras make future plans smarter. If a feature doesn’t feed that loop, it is secondary.
3. **Honesty over spectacle.** Prefer a quieter, truer number to a louder, inflated one.
4. **One purpose per screen.** If a page answers two questions, it becomes two pages — or one dies.
5. **The rider decides.** Software suggests. Humans verify. Never silent commitment.
6. **Calm under fatigue.** Design for the midnight hotel — hour 30’s aftermath — not for a rested product manager.
7. **Craft is respect.** Spacing, type, and motion are how we show we take the sport seriously — always subordinate to clarity.
8. **Consistency builds trust.** Same behaviors, same hierarchy, same metric order — muscle memory in a few sessions.

## Brand personality

| Is | Is not |
|---|---|
| Quietly confident | Loud / hype |
| Precise | Pedantic |
| Warm-serious | Bro-sports |
| Editorial | Dashboard-y |
| Enduring | Trendy |
| Sparse | Empty |

Think: a well-printed race bible, not a neon cycling computer.

## Tone of voice

- Short sentences.
- Concrete nouns: distance, sleep, water, finish.
- No coach-speak (“crush your goals”), no AI fluff (“insights personalized for you”).
- Prefer *you* and *your Ultra* over *users* and *activities*.
- When uncertain: say so. “Not enough data” is brand-aligned.

## Writing style

- **Titles:** sentence case, no trailing ornament. `The Capitals 2026` not `THE CAPITALS 🔥`
- **Metrics:** number + unit, never both spelled and abbreviated. `823 km`
- **Time:** `55h 12m` for elapsed race time; avoid raw seconds in UI.
- **Empty states:** one sentence of truth + one action. No illustrations of smiling cyclists.
- **Errors:** name the fix. “Strava disconnected — reconnect to sync.”

## Tagline

**Primary:** `Ride. Remember. Ride better.`

**Alternates (hold):**
- `Your Ultras, compounding.`
- `Experience, made useful.`
- `Plan with what you’ve ridden.`

## Landing page headline

**RYDN**  
**The experience platform for ultra racing.**

Supporting line:  
Every finished Ultra makes the next plan smarter.

CTA: `Open RYDN` / `Continue with Google`

Hero: one Completed Ultra card on a quiet field — not a montage of sweaty riders.

## Elevator pitch

> RYDN is where ultra cyclists plan the next race using everything they learned from the last ones. You group days into Ultras, review what actually happened, and carry that experience into verified execution plans — Aggressive, Balanced, or Comfort. Strava stores activities. RYDN builds experience.

## Design philosophy

0. **Clarity first.** Beauty serves understanding. Minimalism serves use. Cleverness is deleted when it costs obviousness. (See §0.1.)
1. **Typography first.** If hierarchy fails without color, the layout is wrong.
2. **Whitespace is structure**, not waste — but never at the cost of finding the next action.
3. **Accent is scarce.** Color means something or it isn’t there.
4. **Data earns its ink.** Charts exist to answer a question, never to fill space.
5. **Light by default.** Daylight product. Dark mode is a later, deliberate chapter — not a skin.
6. **Materials over effects.** Borders and paper-like surfaces beat glow, glass, and gradients.
7. **Recognition over decoration.** A RYDN screen should be identifiable with the logo removed.
8. **The midnight rider is the critic.** If they can misuse it, we failed.

## Emotions users should feel

| Moment | Feeling |
|---|---|
| Opening the app | Settled, oriented |
| Looking at Completed Ultras | Pride without vanity |
| Planning | Competent, prepared |
| Verifying stops | Careful, in control |
| Reviewing | Clear-eyed, curious |
| After a long day | Relieved the UI is gentle |

Never: overwhelmed, judged, gamed, or sold to.

---

# 2. Product Philosophy

## Challenge: what should RYDN feel like?

### Not Strava
Strava is a **social activity feed**. Identity = kudos, segments, weekly volume.  
RYDN identity = **Ultras completed and lessons carried forward**.  
Deliberately no feed, no kudos, no leaderboard chrome.

### Not Garmin / Wahoo / COROS apps
Those are **device companions** — sync, firmware, workout push.  
RYDN never owns the hardware loop. Import in; plan and understand out.

### Not TrainingPeaks / intervals.icu alone
Those are **physiology workbenches** — excellent curves, weak ultra narrative.  
RYDN keeps curve quality but centers **execution + experience**, not FTP theater.

### Closer to Flighty × Notion × Linear
- **Flighty:** one obsessive domain, glanceable objects, trust.
- **Notion:** calm documents / canvases for planning verification.
- **Linear:** ruthless information hierarchy, fast cognition.

### The honest answer

RYDN should feel like **a private atelier for ultra racing** — part logbook, part planning desk, part archive.

Not a gym. Not a social network. Not a cockpit full of gauges.

## How RYDN differentiates

| Others | RYDN |
|---|---|
| Activity list | **Ultra** as the unit of meaning |
| Replay the ride | **Understand** the ride |
| One static plan | **Strategies** + verification |
| Generic athlete profile | **Experience** drawn from finished Ultras |
| More charts | **Fewer, sharper metrics** |
| Dark neon sports UI | **Light, typographic, calm** |

## What RYDN must deliberately NOT become

- A Strava replacement (recording + social)
- A route builder / navigator (Komoot’s job)
- An AI coach that lectures
- A gamified badge factory
- A multi-sport blob (running, swimming, gym)
- A “content” product (stories, reels, clubs)
- A dark-mode cyber dashboard with glowing charts

**Scope mantra:** *Cycling. Ultra. Experience. Loop.*

---

# 3. Information Architecture

## Challenge the proposed nav

> Home · Planning · Completed Ultras · Activities · Review · Settings  

**Verdict: too many primary destinations. Reject.**

Problems:
- Home vs Completed vs Activities = three overlapping lists.
- Review is not a top-level place — it is a **phase inside an Ultra**.
- “Activities” trains people to think in Strava units — the opposite of the brand.

## Recommended primary structure

**Two spaces. One object. Contextual phases.**

```
RYDN
├── Ultras          ← the library (default)
│     ├── Upcoming / In plan
│     └── Completed
├── Desk            ← active work surface (optional; can merge into Ultras)
└── You             ← account, connections, preferences
```

### Simpler (preferred for v1)

**Primary chrome: only two destinations**

| Tab | Purpose |
|---|---|
| **Ultras** | Everything that is or will be an Ultra — upcoming + completed cabinet |
| **Library** | Raw source days not yet attached (Strava / uploads) — *ingredients* |

Plus: avatar → **You** (settings, Strava, Google).

No “Home”. The Ultras space *is* home.  
No top-level “Review”. Open an Ultra → land in the right phase.

### Inside an Ultra (phase switcher)

```
⟨  Plan  ·  Ride  ·  Review  ⟩
```

Auto-land:
- Future / drafting → **Plan**
- Event window / in progress → **Ride**
- Finished → **Review**
- After review saved → Completed cabinet entry

### Mental model (30 seconds)

1. **Ultras** = my expeditions.  
2. Open one = work on it (plan / ride / review).  
3. **Library** = days waiting to become part of an Ultra.  
4. Experience flows from Completed → next Plan.

### What we remove from IA

- Generic “Home dashboard” with widgets  
- Top-level “Activities” as equal to Ultras  
- Top-level “Review”  
- Separate “Analytics” product area  
- Settings buried behind five menus — **You** is one calm page

---

# 4. Visual Language

## System name

**RYDN System** — light, typographic, paper-adjacent.

## Typography

**UI / body:** `Geist` (or `Inter` only if Geist unavailable — prefer Geist / IBM Plex Sans)  
**Display / Ultra titles:** `Geist` tightly tracked, or `Newsreader` / `Source Serif 4` **only** for Ultra proper names on cards — never for UI chrome.

Rules:
- Body 15–16px / 1.5  
- Secondary 13–14px / 1.45  
- Ultra card title 28–40px display  
- Tabular figures for all metrics  
- No all-caps except micro-labels (≤11px, +0.06em)

## Spacing

Base unit: **4px**.  
Common rhythm: 8 · 12 · 16 · 24 · 32 · 48 · 64.

Page padding: 24 desktop / 16 mobile.  
Section gaps: 48 desktop / 32 mobile.  
Prefer more space over more lines.

## Grid

- Content max width: **1080px** for libraries; **720px** for focused Plan/Review reading.  
- Ultra cabinet: auto-fill `minmax(280px, 1fr)`.  
- Never 12-column dashboard soup.

## Corner radius

| Token | Value | Use |
|---|---|---|
| `radius-sm` | 6px | Inputs, chips |
| `radius-md` | 10px | Buttons, menus |
| `radius-lg` | 16px | Cards, dialogs |
| `radius-xl` | 22px | Ultra cards only |

## Shadows

Almost none.  
One soft elevation for floating menus/dialogs: `0 12px 40px rgba(20,20,18,0.08)`.  
Cards: **border, not shadow**.

## Borders

`1px solid` hairline. Color: `ink/8` on paper.  
Selected: `ink/24`.  
Never 2px neon outlines.

## Cards

Allowed when the card **is the object** (Ultra card) or **hosts an action**.  
Forbidden as generic section wrappers. If removing the card chrome doesn’t hurt understanding — remove it.

## Icons

Line icons, 1.5px stroke, optical size 16/20.  
No filled duotone sports icons.  
Prefer typography + layout over icon rows.

## Charts

- Light grid, almost invisible  
- One series color by default; second series only when comparison is the point  
- No gradients under area fills (4–8% opacity flat fill max)  
- Axes: small, ink/40  
- Mobile: docked readout, not hover tooltip  

## Tables

Rare. Prefer definition lists and metric stacks.  
If table: generous row height (44px), no zebra, hairline separators only.

## Buttons

| Kind | Look |
|---|---|
| Primary | Solid ink, white label |
| Secondary | Hairline border, ink label |
| Ghost | No border, ink/60 |
| Destructive | Quiet red text, not big red slab |

Height 40px desktop / 44px mobile. Radius `md`. No pill soup.

## Inputs

Hairline field, 44px tall, radius `sm`.  
Focus: ink ring 1px, no glow.  
Labels above, 13px ink/60.

## Dialogs

Centered, max 480px, paper surface, one primary action.  
No modal stacks.

## Badges

Micro, 11px, radius `sm`, low-saturation fills.  
`Completed` · `Verified` · `Draft` — never fireworks.

## Maps

Muted basemap (desaturated). Route in ink. Stops as quiet dots.  
Map is evidence, not the hero — except in Ride phase.

## Design tokens (conceptual)

```
paper          #F7F6F3
paper-elevated #FFFFFF
ink            #1A1A18
ink-secondary  #5C5C56
ink-tertiary   #8A8A82
line           rgba(26,26,24,0.08)
line-strong    rgba(26,26,24,0.16)
accent         #2F5D50   /* deep pine — rare */
accent-soft    rgba(47,93,80,0.10)
success        #3F6F5A
warning        #9A7B2F
danger         #8F3D3D
```

Accent used for: primary CTA, current phase, verified check.  
Not for decorative underlines.

---

# 5. Color System

## Default: light

Warm off-white paper (`#F7F6F3`), not pure `#FFF` full-bleed (eyes soften; cards can be white).

## Restraint rules

1. **≥90% of pixels** are paper / white / ink text.  
2. Accent appears **≤3 times** per viewport.  
3. No purple systems. No neon lime. No cyber dark.  
4. Gradients: **default ban**. Allowed only for photographic Ultra covers fading into paper — never UI chrome.  
5. Success / warning / danger: muted, never candy.

## Semantic use

| Meaning | Color |
|---|---|
| Moving / verified / go | pine accent |
| Caution / needs verify | muted gold |
| Error / disconnect | muted brick |
| Completed badge | pine soft fill |

---

# 6. Product Vocabulary

| Use | Avoid |
|---|---|
| **Ultra** | Event, race blob, “big activity” |
| **Day** / **Source day** | Activity (in primary UI) |
| **Library** | Activities feed |
| **Plan** | Roadbook (external legacy ok in docs) |
| **Strategy** (Aggressive / Balanced / Comfort) | Mode, preset |
| **Verify** / **Verified** | Confirm™️, checkbox theater |
| **Review** | Analytics, debrief report |
| **Experience** | Rider model, AI profile |
| **Completed Ultra** | Past race, history item |
| **Cabinet** | History, archive list |
| **Desk** (if used) | Dashboard |
| **You** | Account settings dump |
| **Connect Strava** | Import provider jargon |

**Activity** may appear only in Library helper copy (“Source days from Strava”) — never as a primary nav label.

### Phrase bank

- “Group into an Ultra”  
- “Base this plan on experience from…”  
- “Verify before you ride”  
- “Saved to your cabinet”  
- “Not enough data”  

---

# 7. Interaction Design

## Motion principles

- Duration: 120–200ms UI; 240–320ms large layout.  
- Easing: standard ease-out. No bounce. No springy toys.  
- Motion explains **spatial relationship** (panel enter, phase crossfade) — never celebrates.

## Transitions

- Ultra open: shared-element feel (card → header), or simple fade+slide 16px.  
- Phase switch Plan/Ride/Review: crossfade, retain Ultra identity in chrome.  
- Dialogs: fade + 4px rise.

## Loading

- Prefer **skeletons that match final typography layout**, not spinners.  
- Global spinner only for auth handoff.  
- Sync: quiet inline “Syncing…” in You / Library — never full-screen blocking.

## Empty states

Structure:  
**Title (what’s missing)**  
**One sentence why it matters**  
**One primary action**

Example (Cabinet empty):  
**No Completed Ultras yet**  
Finish a race, group the days, and it lives here forever.  
`Group from Library`

## Hover / focus

- Desktop: 4% ink wash on rows; hairline strengthens on cards.  
- Focus visible always (keyboard).  
- No scale-on-hover for cards (cheap). 1px translate Y max if any.

## Selection

- Multi-select in Library: checkbox + pine soft fill.  
- Bulk bar: single sticky action `Create Ultra`.

## Context menus

- Sparse. Right-click / long-press: Open · Rename · Move days · Remove from Ultra.  
- No nested menus.

## Animations we refuse

Parallax heroes, confetti, streak flames, animated gradient borders, Lottie mascots.

---

# 8. Mobile Experience

## Premise

Many sessions happen in trains, hotels, and start lines — one hand, bright sun, tired brain.

## Rules

- Primary tabs: **two** (Ultras · Library), thumb-reachable.  
- Min touch 44×44.  
- Ultra cards: full width, generous type, stats in one row.  
- Charts: full bleed width; readout **docked below** (already directionally correct).  
- Plan verification: one stop per screen scroll section — not a dense table.  
- Ride phase (future): largest type in the product; one “next” truth.  
- No hover-dependent actions.  
- Safe areas respected; no chrome under home indicator.

## Mobile information density

Less than desktop — hide secondary metrics behind progressive disclosure.  
First paint: name, year, distance, time, place. Rating and elevation can wait one tap.

---

# 9. Signature Features

What should be unmistakably RYDN:

### 1. The Cabinet
Completed Ultras as a **collection of quiet trophies** — screenshot-worthy cards, not a table of races. White space between objects. Year as editorial mark.

### 2. Ultra Card
The atomic brand object: name · year · distance · elevation · elapsed · place · rating · completed mark. Cover optional; typography mandatory.

### 3. Experience
Not a spider chart. A short, inspectable sheet:  
*Daily distance I sustain · Sleep I take · How I stop · Night behavior · After 20h…*  
Picked into planning as **“Use experience from The Capitals 2026”**.

### 4. Strategies
Three plans on one route — Aggressive / Balanced / Comfort — presented as **comparable briefs**, not settings.

### 5. Verification ledger
A checklist that feels like a launch brief: Hotel booked · Water confirmed · Opens before ETA · Backup. Readiness sentence at top.

### 6. Review as exploration
Metrics → shapes → curves → one-line truths. AI last and optional. Moving vs Elapsed as signature chart (honest, not flashy).

### Stronger signature ideas (propose)

| Idea | Why it’s RYDN |
|---|---|
| **Ultra Spine** | A vertical timeline of the event: days, sleeps, crises, finishes — the story backbone |
| **Carry Forward** | After Review, 1–3 lessons pinned; they appear automatically on the next Plan |
| **Readiness strip** | One calm sentence: “Almost ready — 1 water gap unverified” |
| **Source ribbon** | On an Ultra, a quiet strip of Day 1…n with merge state — ingredients visible |
| **Quiet PR** | Personal records only inside Review, never as home fireworks |
| **Experience delta** | “vs Capitals 2026: you slept 40m less per night” — plain language |

**Ultra DNA** as a name: powerful but sci-fi. Prefer **Experience** in UI; DNA can be internal metaphor.

---

# 10. Critique of the current application

*Honest. Current UI is treated as a prototype to retire, not polish.*

## What feels amateur

- **Dark cyber theme** — default startup sports/AI look. Opposite of trust and calm.
- **Orange accent + glow dots** — generic “energy” coding, not brand.
- **Instrument Serif on dark cards** — costume drama; trophy idea is right, material is wrong.
- **Emoji / glyph type markers** (∞ ▲ ⛺) — toyish.
- **Planning tab as roadmap wishlist** — reads as vaporware, not product.
- **“Group into Ultra” buried in account menu** — core verb hidden.
- **Completed vs Activities** still trains Strava thinking.
- **Setup / OAuth debugging chrome** leaking into product surfaces.
- **Dense dark charts** with low-contrast axes — hard on mobile, “dashboard”.

## What feels inconsistent

- Product name tension: Ultra vs RYDN vs Ultra Analytics docs.  
- Hero object unclear on first paint.  
- Mix of system UI, custom dark panels, and Strava buttons.  
- Review quality (thinking) ahead of shell quality (feeling).

## What should be removed

- Dark theme as default  
- Neon/glow accents  
- Top-level “Home” marketing copy blocks  
- Empty Planning feature laundry lists as primary UI  
- Card-on-card sectioning everywhere  
- Any remaining trycloudflare / tunnel instructional UI in the main app (keep in SETUP.md / doctor only)

## What should be redesigned from scratch

1. **App shell** (nav, light paper system)  
2. **Ultras space** (cabinet + upcoming)  
3. **Ultra Card**  
4. **Ultra detail chrome** (Plan / Ride / Review switcher)  
5. **Library** (source days)  
6. **You** (connections)  
7. **Review surfaces** restyled to light system (keep metric logic)  
8. Marketing/landing later — product first

**Do not “improve” the current dark UI.** Replace the surface. Keep the brain (analysis, lifecycle, grouping, tunnel).

---

# Roadmap (impact-ranked)

Work **from the design system outward**. One section at a time. Ship visible quality each step.

## P0 — Foundation (everything else depends on this)

| # | Work | Impact | Why first |
|---|---|---|---|
| 0.0 | **Clarity gate** on every screen (5s / 30s / one-hand tests; primary action obvious) | Critical | Constitution §0.1 — non-negotiable acceptance criteria |
| 0.1 | **Design tokens + light theme** in CSS (paper, ink, radius, type) | Critical | Stops all future screens from inheriting dark debt |
| 0.2 | **Typography load + base type scale** | Critical | Hierarchy is the product |
| 0.3 | **Vocabulary pass** in copy (Ultra, Library, Experience…) | High | Brand in language before pixels settle |
| 0.4 | **App shell v1**: Ultras · Library · You | Critical | IA is the product |
| 0.5 | **Score-line + card hierarchy locked** (distance → elevation → elapsed) | Critical | Consistency = clarity over time |

## P1 — Signature objects

| # | Work | Impact |
|---|---|---|
| 1.1 | **Ultra Card** (light, typographic, screenshot-grade) | Critical |
| 1.2 | **Cabinet layout** (Completed) + Upcoming list | Critical |
| 1.3 | **Library** for ungrouped source days + **Create Ultra** as primary action | High |
| 1.4 | **Ultra open chrome** with Plan · Ride · Review | High |

## P2 — Restyle existing brain

| # | Work | Impact |
|---|---|---|
| 2.1 | Restyle **Review** (Overview / Curves / Analysis) onto light system | High |
| 2.2 | Mobile chart patterns standardized | High |
| 2.3 | Empty states + loading skeletons | Medium |
| 2.4 | Motion tokens (phase crossfade, dialog) | Medium |

## P3 — Experience loop surfaces

| # | Work | Impact |
|---|---|---|
| 3.1 | Ultra metadata edit (place, rating, year, cover) | High |
| 3.2 | **Experience** sheet (manual → later auto) | High |
| 3.3 | Carry Forward lessons → Plan | High |
| 3.4 | Strategies + Verification ledger (Plan phase) | Critical for mission — after shell is trustworthy |

## P4 — Polish & recognition

| # | Work | Impact |
|---|---|---|
| 4.1 | Ultra Spine timeline | Medium-High |
| 4.2 | Readiness strip | Medium |
| 4.3 | Marketing landing on rydn.bike (when product shell is proud) | Medium |
| 4.4 | Dark mode (optional, last) | Low now |

---

## Proposed implementation order (next conversations)

1. **Approve this constitution** (challenge / amend).  
2. **P0.1–P0.4** — tokens + shell + vocabulary (no new features).  
3. **P1.1–P1.3** — Cabinet + Card + Library (the “oh — this is RYDN” moment).  
4. Only then restyle Review and build Plan surfaces.

---

## 11.0 Constraint

Recognizability never outranks §0.1.  
If a “signature” layout fails the five-second test or hides the primary action from the midnight rider, it is redesigned — even if it photographs well.

Imagine Reddit, 2032. A screenshot. No wordmark. Thousands of comments: *That’s RYDN.*

Here is exactly why — and what we must start building **now** so that identity is inevitable, not decorated on later.

---

## 11.1 The thumbnail test

At 200×200px, or a phone screenshot half-covered by a thumb, people still know.

They are not reading “RYDN.” They are recognizing a **grammar**:

1. Warm paper field (not pure app-white, not dark OLED sports).
2. One large proper name set like a title page — not a list row.
3. A sparse metric line under it: distance · elevation · elapsed — always that order, always tabular.
4. Enormous leftover whitespace — the screenshot looks “unfinished” to people who use Strava; to RYDN users it looks correct.
5. Almost no chrome. No tab bar fireworks. No neon. No chart junk in the first glance.

If the thumbnail fails, the product is not iconic yet — only pretty.

---

## 11.2 Visual elements that become unmistakable

### A. The Ultra as a title page, not a row

Every Completed Ultra reads like a **colophon**:

```
2026
The Capitals
823 km    14,000 m    55h 12m
14th Overall
```

- Year sits above the name like an edition mark — small, tracked, quiet.
- Name is oversized, calm, never all-caps shout.
- Metrics are a single horizontal **score line** with hairline gaps or mid-dots — never a 2×2 metric tile grid (that is every sports app).
- Place / rating appear as secondary, never competing with the name.

**Iconic decision:** We refuse the “activity card with map thumbnail + avatar + kudos.” Forever.

### B. Paper, not glass

Surfaces look like **printed matter under daylight**:
- Warm off-white field
- White elevated sheets with hairline borders
- No frosted glass, no bloom, no gradient mesh

In a world of dark OLED fitness apps, RYDN screenshots look like they were taken in a library.

### C. The Cabinet rhythm

Completed Ultras are spaced like objects in a gallery — generous gaps, aligned top edges, equal optical weight. Not a dense feed. Not a table.

A feed screenshot = Strava.  
A dashboard screenshot = Garmin.  
A **gallery of title pages** = RYDN.

### D. The score line (canonical metric grammar)

Whenever three numbers appear together in RYDN, they obey:

**distance → elevation → elapsed**

Always. Same order. Same typography. Same units style (`823 km`, `14,000 m`, `55h 12m`).

After five years this order becomes muscle memory — like Flighty’s time blocks or Linear’s issue IDs. Crop the logo; keep the score line; people still know.

### E. Charts that look like instruments, not marketing

- Axes whisper (ink/40)
- One primary series; second series only for a named comparison (Moving vs Elapsed)
- No gradient fills, no glow lines, no “AI insight” callout bubbles on the plot
- On mobile: a **docked readout slab** under the chart — not a floating tooltip

The Moving/Elapsed pair with a visible gap becomes a RYDN fingerprint the way heart-rate zones became “Garmin green/yellow/red” — except ours stays typographic and calm.

### F. The readiness sentence

One full-width line, sentence case, no badge pile:

> Almost ready — one water gap unverified.

Not a score ring. Not a traffic-light dashboard. A **sentence**. Screenshots of Plan will be recognized by that strip alone.

### G. Verification as a ledger, not a kanban

Verified stops look like a preflight list:

```
✓  Hotel · León · booked
✓  Supermarket · opens before ETA
○  Water · unconfirmed
```

Quiet checks. Monospace-adjacent alignment of statuses. No colorful boards.

### H. Phase switcher as a typeset rule

```
Plan     Ride     Review
  ———
```

Underline or weight shift only — never pill tabs with fills. The Ultra name stays above, stable, while the phase changes underneath. Screenshots always show **object identity > mode identity**.

---

## 11.3 Interaction patterns that feel unique

### 1. Object-first, not feed-first
You never “scroll the day.” You open an Ultra. Everything else is subordinate. That single navigation habit is the biggest recognizer.

### 2. Group before glorify
The sacred gesture: select Day 1–3 → **Create Ultra**. RYDN users talk about “grouping the race” the way others say “uploading the activity.” The product taught a verb.

### 3. Experience as a choice, not a score
Planning starts with:

> Base this plan on: **The Capitals 2026**

A picker of finished Ultras — not a 0–100 “fitness readiness” ring. Iconic because it treats history as a tool.

### 4. Three strategies, one route
Aggressive / Balanced / Comfort shown as **three brief columns** with the same score-line grammar. Comparable like wine labels, not like settings toggles.

### 5. Verify is the climax of Plan
The emotional peak of planning is not generating the plan — it is **checking the last open circle**. That ritual is RYDN’s Superhuman “Cmd+K moment,” but quieter.

### 6. Review as quiet exploration
No autoplay map replay. No AI essay above the fold. Numbers first; optional explain last. People will mock AI-report apps by pasting a RYDN Overview and saying “this is how it’s done.”

### 7. Carry Forward
After Review, 1–3 lessons pin themselves onto the next Plan. The interaction is almost invisible — a small strip: *From Capitals 2026 — sleep earlier.* That continuity is how the product *feels* intelligent without performing intelligence.

### 8. Absence as craft
No kudos animation. No streak flame. No weekly challenge banner. The missing patterns are themselves recognizable — like noticing a room has no TV.

---

## 11.4 Product decisions that became iconic (2032 lore)

These are not features. They are **doctrines** that, kept for years, create the silhouette:

| Doctrine | Why it became iconic |
|---|---|
| **The Ultra is the atom** | Screenshots always show expeditions, never orphaned days |
| **Light by default forever** | In a dark-app industry, RYDN is the daylight one |
| **Honesty over peak porn** | Speed curves from 5s; no fake 1s hero numbers — trust became aesthetic |
| **Suggestions → verification** | “RYDN doesn’t decide for you” entered race culture |
| **Experience compounds** | Planning from a past Ultra is the demo everyone shows friends |
| **No social layer** | Absence of feed made screenshots feel private and serious |
| **Cabinet > history** | People say “it’s in my cabinet,” not “it’s in my activities” |
| **Sentence readiness** | One line beats a dashboard — endlessly screenshotted |

---

## 11.5 What to build **today** so identity emerges by 2032

Do not invent a mascot. Do not over-illustrate. **Encode the grammar early and never violate it.**

### Start now (P0–P1) — non-negotiable seeds

1. **Score-line component** — distance · elevation · elapsed — used everywhere identically.  
2. **Ultra title-page layout** — year / name / score line / secondary — the only way an Ultra may appear as a card.  
3. **Cabinet spacing rules** — gallery gaps locked in tokens; no denser “compact mode” for Completed.  
4. **Paper token set** — warm field + hairline sheets; ban dark default.  
5. **Phase typeset switcher** — Plan · Ride · Review under a stable Ultra title.  
6. **Library vs Ultras split** — teach the verb *group* from week one.  
7. **Empty Cabinet copy** — train the word *cabinet* immediately.

### Protect next (P2–P3) — deepen the silhouette

8. **Readiness sentence** component (Plan).  
9. **Verification ledger** row pattern (check · place · status).  
10. **Moving vs Elapsed** as the default signature chart treatment.  
11. **Experience picker** (“Base plan on…”) even if Experience values are manual at first.  
12. **Carry Forward strip** after Review — even with hand-authored lessons.

### Never ship (identity killers)

- Activity feed as home  
- Map-thumbnail cards as the default Ultra representation  
- Metric tile grids (2×2 / 3×3) as the primary summary language  
- Colored pill tab bars  
- Gradient chart fills / glow  
- Gamification chrome  
- AI paragraph above the fold in Review  

Violating these once teaches the market the wrong silhouette. Recognizability is path-dependent.

---

## 11.6 The one-sentence recognizability brief

> RYDN screenshots look like **title pages of races on warm paper**, with a **canonical three-metric score line**, **gallery spacing**, **sentence-level status**, and **almost no sports-app chrome** — so even cropped, people know what they’re looking at.

---

## Decision log (continued)

| Date | Decision |
|---|---|
| 2026-07 | **Clarity outranks beauty, minimalism, and cleverness**; midnight hotel rider is the design benchmark; 5s / 30s / one-hand tests are ship gates |
| 2026-07 | Recognizability > branding decoration; thumbnail test is mandatory |
| 2026-07 | Canonical score line: distance → elevation → elapsed (forever) |
| 2026-07 | Ultra = title page; Cabinet = gallery; never feed/map-thumb cards |
| 2026-07 | Identity seeds ship in P0–P1; do not defer “feel” to a later brand pass |
| 2026-07 | **Ultras are never auto-created.** Import → Library only. Software may suggest related days; humans create the Ultra. Core principle. |
| 2026-07 | Completed Ultra card: small country-flag row + quiet ✓-in-circle; no “Completed” text, no large map |
| 2026-07 | Ultra is an editable collection forever — never locked after create. Add/remove returns rides to Library. |
| 2026-07 | Ultra overview: editorial SVG route (paper + thin ink line), Day rows, Edit + Add rides sheets; SF-style icons |
| 2026-07 | Infer what software can know (countries from GPS, date range, day order); manual override always available |
| 2026-07 | One name field only (no Event name). Result/placing is first-class Ultra metadata |
| 2026-07 | Cabinet = recognition shelf (compact collectibles); Ultra page = exploration. Editorial atlas route plates. |
| 2026-07 | Ultra overview = “What was this expedition?”; Analytics page = “How did I ride it?” — keep separate. |
| 2026-07 | Library button hierarchy: Sync Strava = primary (Strava orange); Group into Ultra = secondary; Upload GPX = tertiary. Equal 44px heights. |
| 2026-07 | RYDN mark = continuous route line → minimal finish flag; monochrome; readable at 16×16; no gradients/shadows. |

---

*End of workshop document. Next: your challenges to this constitution, then P0 implementation.*
