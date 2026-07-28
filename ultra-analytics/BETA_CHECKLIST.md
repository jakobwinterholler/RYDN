# RYDN — Public Beta Checklist

Status as of 2026-07-28. Goal: a first public beta users can trust — not feature expansion.

## Release candidate gates

| Gate | Status | Notes |
|------|--------|--------|
| No critical bugs known in core journeys | ⚠️ Manual QA required | Automated coverage expanded; full device matrix pending |
| Navigation / deep links survive refresh | ✅ | `/`, `/ultras/:id`, `/ultras/:id/analytics`, `/rides/:id?from=&ultra=`, `/?space=` |
| Browser back / iOS swipe-back | ✅ | `history.pushState` + `popstate` |
| Session survives refresh & restart | ✅ | Signed HttpOnly cookie (60d); `Secure` when HTTPS |
| Stable imports (FIT/TCX/GPX) | ✅ | User-facing corrupt-file copy; size cap 80 MB |
| Stable Strava sync | ✅ | Retry vs continue-without-sync; sanitized 502 |
| Stable Ultra create / edit / membership | ✅ | Exclusive membership 409; remove confirms |
| Stable Insights / Ultra analytics | ✅ | Cached stitch; sanitized failures |
| Professional polish | ✅ Wave 2 + release hardening | |
| Accessible enough for beta | ✅ Core dialogs | Focus trap + Esc + restore; charts still pointer-first |
| Installable PWA shell | ✅ | PNG icons all sizes + maskable + SW |
| Tokens encrypted at rest | ✅ | Fernet `enc:v1:` — see RELEASE_AUDIT |
| Playwright critical journeys | ✅ | `npm run test:e2e` — 4 passed |

**Verdict:** Soft production / public beta is ready after the day-of checklist. See [`RELEASE_AUDIT.md`](./RELEASE_AUDIT.md) for the final hardening pass (encryption, focus traps, PWA PNGs, Playwright, CSP).

---

## Known limitations

1. **Ultra GET can still heal/backfill** — occasional latency; not a pure read.
2. **Charts are pointer-first** — limited keyboard exploration of curve points.
3. **Service worker caches shell only** — API always network; offline Review of uncached days is unavailable by design.
4. **File-store RMW** — no cross-process locks; avoid parallel writers on one account.
5. **Dead `ComparePage`** still in repo — not linked in UI.
6. **Cross-browser matrix** below is incomplete until signed off manually.
7. **Client telemetry** logs message/url/stack only — no emails, no ride contents.
8. **VoiceOver / TalkBack** full pass and live Lighthouse scores — record in RELEASE_AUDIT after deploy.

---

## Tested browsers / devices

Mark when verified on a real device or BrowserStack.

| Environment | Status | Tester / date |
|-------------|--------|----------------|
| iPhone Safari (latest) | ☐ | |
| iPhone Chrome | ☐ | |
| iPad Safari | ☐ | |
| Android Chrome | ☐ | |
| macOS Safari | ☐ | |
| macOS Chrome | ☐ | |
| Arc | ☐ | |
| Firefox | ☐ | |
| Edge | ☐ | |
| Windows Chrome | ☐ | |
| Wide desktop (≥1440) | ☐ | |
| Narrow phone (≤390) | ☐ | |
| Landscape phone | ☐ | |

---

## Critical journeys (must pass before announce)

- [ ] Google sign-in → lands in Cabinet
- [ ] Dev login (if Google off) → Cabinet
- [ ] Strava connect → sync success → Library populated
- [ ] Strava sync failure → Retry works; Continue without sync does not leave user stuck
- [ ] Import GPX/FIT/TCX → appears in Library
- [ ] Corrupt / wrong file → calm error, no stack trace
- [ ] Create Ultra from Library → opens Ultra overview
- [ ] Add / remove day (confirm) → totals update
- [ ] Conflict: ride already in another Ultra → clear 409 message
- [ ] Delete Library day (confirm) → gone; Ultra membership cleaned
- [ ] Open Day Review from Ultra → Back returns to Ultra (also after refresh)
- [ ] Open Analytics → Overview / Pacing / Elevation / Performance
- [ ] Browser Back through Cabinet → Ultra → Analytics → Day
- [ ] Hard refresh on each deep link while signed in
- [ ] Sign out → Welcome; cookie cleared
- [ ] Airplane mode action → “offline” style message
- [ ] Install PWA (Chrome/Android or desktop) → standalone window

---

## Automated tests

```bash
# Backend
cd ultra-analytics/backend && python -m pytest tests/ -q

# Frontend unit
cd ultra-analytics/frontend && npm test
```

Covered today:

- Ultra consistency / exclusive membership / OAuth cookie contract
- Ultra aggregation
- Speed curves, stop classifier, Strava adapter
- User-facing error message helpers (BE + FE)

Still missing for later:

- Playwright E2E for the journeys above
- OAuth CSRF rejection integration test against live router
- Visual / a11y CI (axe)

---

## Remaining bugs / polish

| ID | Item | Severity |
|----|------|----------|
| B1 | Sheet focus trap + restore focus | Medium |
| B2 | Encrypt provider tokens at rest | High (pre-scale) |
| B3 | Read-only Ultra GET (move heal off request path) | Medium |
| B4 | PNG maskable icons 192/512 | Low (PWA store) |
| B5 | Ride deep-link without `?from=` still backs to Library | Low (by design) |
| B6 | Full WCAG AA contrast audit of Review pills/charts | Medium |
| B7 | Wire Sentry (or equivalent) to replace stdout JSON logs in prod | Medium |

---

## Monitoring (beta)

| Signal | Where |
|--------|--------|
| Server exceptions | stderr JSON via `rydn` logger (`log_event` / `log_exception`) |
| Client crashes | `POST /api/telemetry/client-error` (sanitized) |
| Liveness | `GET /api/health` → `{ status, product, env, secureCookies }` |

Do **not** log emails, tokens, or full activity payloads.

---

## Future roadmap (post-beta — do not block launch)

- Deeper Insights topics already marked “coming soon”
- Compare / multi-Ultra
- Token encryption & multi-region storage
- Native share sheets / widgets
- Full offline last-opened Ultra

---

## Release checklist (day-of)

1. [ ] `ULTRA_SECRET` set (or `backend/data/.secret` present) on host
2. [ ] `PUBLIC_URL` / `APP_URL` HTTPS; cookies `Secure`
3. [ ] `CORS_ORIGINS` includes only real app origins (no `*`)
4. [ ] `ULTRA_OAUTH_DEBUG=0` (or unset in production)
5. [ ] Google + Strava redirect URIs match production host
6. [ ] `pytest` + `npm test` + `npm run build` green
7. [ ] Smoke the critical journeys on one phone + one desktop browser
8. [ ] Confirm `/api/health` and client-error telemetry visible in logs
9. [ ] Announce with known limitations link (this file)

---

## Confidence statement

RYDN is **feature-complete enough** for a careful public beta: accounts, Strava, import, Ultras, Review, Analytics, history, and calm errors are in place.

Blockers for a *confident wide* launch: complete the device matrix above, close B2 (token encryption) before any multi-tenant scale-up, and run one full critical-journey pass on production URLs.
