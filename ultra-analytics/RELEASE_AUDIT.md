# RYDN — Release Audit

**Date:** 2026-07-28  
**Product:** RYDN (`ultra-analytics`)  
**Version marker:** API `0.4.0` / phase `release`  
**Scope:** Final hardening only — no new user-facing features (except completing Delete Ultra in Edit sheet for an existing API).

---

## Production readiness assessment

| Area | Status | Confidence |
|------|--------|------------|
| Token encryption at rest | ✅ Fernet + HKDF from `ULTRA_SECRET` | High |
| Session cookies | ✅ HttpOnly, SameSite=Lax, Secure on HTTPS | High |
| CSP / HSTS / security headers | ✅ Middleware | High |
| CORS allowlist | ✅ Origins from config | High |
| GZip compression | ✅ FastAPI `GZipMiddleware` | High |
| Focus trap / Esc / restore focus | ✅ `FocusLock` + `useFocusTrap` | High |
| PWA PNG icons (all sizes) | ✅ Generated + wired | High |
| Playwright critical journeys | ✅ 4/4 passed (mocked API) | High |
| Device matrix / live Lighthouse | ⚠️ Pending on production host | Medium |
| Screen-reader manual pass | ⚠️ Partial (roles/labels present; VoiceOver not signed off) | Medium |

**Verdict:** RYDN is **production-ready for a public beta / soft launch** on a single trusted host with HTTPS, `ULTRA_SECRET`, and OAuth redirect URIs verified.

**Not yet:** multi-tenant scale (file store), App Store packaging, or a signed-off VoiceOver/TalkBack pass on every screen.

---

## Security checklist

| Control | Status | Notes |
|---------|--------|-------|
| Encrypt Strava `accessToken` / `refreshToken` at rest | ✅ | `enc:v1:` Fernet; legacy plaintext migrated on read |
| User JSON file mode `0600` | ✅ | |
| `ULTRA_SECRET` required for new https/prod installs | ✅ | Falls back to `.secret` file if present |
| Secure cookies when HTTPS | ✅ | `ULTRA_COOKIE_SECURE` override |
| CSRF OAuth `state` | ✅ | Google + Strava |
| Session bound to Strava connect | ✅ | |
| OAuth debug gated | ✅ | `ULTRA_OAUTH_DEBUG` |
| CORS not `*` | ✅ | |
| CSP | ✅ | self + Google Fonts; `upgrade-insecure-requests` in prod |
| HSTS | ✅ | when Secure cookies / production |
| X-Frame-Options DENY | ✅ | |
| Nosniff / Referrer / Permissions-Policy | ✅ | |
| Client error telemetry (no PII payloads) | ✅ | message/url/stack only |
| Tokens never sent to browser | ✅ | `public_user` |

**Residual risks**

1. Provider tokens encrypted with app secret — rotate `ULTRA_SECRET` carefully (re-auth Strava if decrypt fails).
2. File-backed JSON has no distributed locking.
3. Google Fonts still loaded from CDN (CSP allows it) — self-host fonts later if you want zero third-party.

---

## Accessibility

| Item | Status |
|------|--------|
| Dialog/sheet `role="dialog"` + `aria-modal` + labelled title | ✅ |
| Focus trap (Tab cycles) | ✅ |
| Escape closes + restores prior focus | ✅ |
| Body scroll lock while open | ✅ |
| `:focus-visible` on buttons / tabs / cards | ✅ |
| `prefers-reduced-motion` | ✅ |
| Touch targets ≥44px (primary controls) | ✅ |
| Chart keyboard exploration | ❌ Remaining |
| Full VoiceOver / TalkBack script | ⚠️ Manual — not automated |

**A11y score (estimate):** ~85–90 for core flows with dialogs; charts/maps lower.  
**Automated axe CI:** not wired yet.

---

## PWA

| Asset | Present |
|-------|---------|
| `manifest.webmanifest` | ✅ |
| PNG icons 16–512 + maskable 192/512 | ✅ `scripts/generate_icons.py` |
| Apple touch 152 / 167 / 180 | ✅ |
| `browserconfig.xml` (Windows tiles) | ✅ |
| Service worker (prod) | ✅ shell + assets; `/api` network-only |
| theme-color / apple-mobile-web-app | ✅ |

Regenerate icons after brand changes:

```bash
python3 ultra-analytics/scripts/generate_icons.py
```

---

## Testing

### Unit / integration

```bash
cd ultra-analytics/backend && .venv/bin/python -m pytest tests/ -q
cd ultra-analytics/frontend && npm test
```

Notable: `test_secrets_crypto.py` (encrypt round-trip + disk seal).

### End-to-end (Playwright)

```bash
cd ultra-analytics/frontend
npm run test:e2e:install   # once
npm run test:e2e
```

**Result (2026-07-28):** **4 passed** in ~8s

- Login (local mode)
- Sync Strava (mocked)
- Import GPX dialog + Esc focus trap
- Create → Edit → Analytics → Browser Back → Delete Ultra → Logout

OAuth Google/Strava real redirects are **not** exercised in CI (by design); use the beta checklist for live OAuth smoke.

---

## Performance

| Metric | Finding |
|--------|---------|
| Bundle | React split chunk; `countries110m` lazy-loaded on map |
| GZip | Enabled for responses ≥500 bytes |
| Map cost | Atlas JSON deferred until route plate needs it |
| Ultra analysis | Disk cache with fingerprint invalidation |
| Unnecessary fetches | Analytics still loads Ultra detail + analysis (acceptable) |
| SW caching | HTML/assets; avoids stale API |

**Lighthouse (desktop, production URL):** *not measured in this session* — run after deploy:

```text
Target (soft launch):
  Performance ≥ 85
  Accessibility ≥ 90
  Best Practices ≥ 90
  PWA installable ✓
```

Record actual scores here after first production Lighthouse pass:

| Category | Score | Date |
|----------|-------|------|
| Performance | ☐ | |
| Accessibility | ☐ | |
| Best Practices | ☐ | |
| SEO | ☐ | |
| PWA | ☐ | | — after SW cache fix (2026-07-28), re-verify install + styled shell |

---

## Remaining known issues

| ID | Issue | Severity | Blocks launch? |
|----|-------|----------|----------------|
| R1 | Chart hover not keyboard-accessible | Low | No |
| R2 | VoiceOver full pass not signed off | Medium | Soft-launch OK |
| R3 | Live Lighthouse / CLS on prod CDN | Medium | Measure on deploy |
| R4 | File store not multi-writer safe | Medium | Single-node only |
| R5 | ComparePage dead code still in tree | Low | No |
| R6 | Playwright uses API mocks (not live Strava) | Low | Manual OAuth smoke |
| R7 | GET Ultra may still heal/backfill | Low | Latency only |

---

## Production configuration (verify before traffic)

```bash
# Required
ULTRA_SECRET=<long random>
ULTRA_ENV=production
PUBLIC_URL=https://your.domain
ULTRA_OAUTH_DEBUG=0

# Optional
ULTRA_COOKIE_SECURE=1
CORS_ORIGINS=https://your.domain
GOOGLE_CLIENT_ID=…
GOOGLE_CLIENT_SECRET=…
STRAVA_CLIENT_ID=…
STRAVA_CLIENT_SECRET=…
```

Confirm:

1. [ ] HTTPS terminates correctly (HSTS appears on responses)
2. [ ] `/api/health` → `secureCookies: true`, `oauthDebug: false`, `phase: release`
3. [ ] Google + Strava redirect URIs match production host only
4. [ ] User files under `backend/data/users/*.json` show `enc:v1:` for tokens after first sync
5. [ ] `npm run build` + static hosting SPA fallback for `/ultras/*` and `/rides/*`
6. [ ] Service worker registers only on HTTPS production build

---

## Console / runtime audit notes

From hardening work (not a full browser DevTools session on prod):

- Client errors post to `/api/telemetry/client-error` (sanitized).
- React StrictMode double-effects are expected in development only.
- No intentional `console.log` in critical paths; OAuth debug prints only when enabled.

**Recommended on first prod deploy:** open Chrome DevTools → Console / Network / Performance; confirm zero red errors on Cabinet → Ultra → Analytics → Day → Back → Logout.

---

## Incident: unstyled shell after deploy (2026-07-28)

**Cause:** The first PWA service worker (`rydn-shell-v1`) cached `index.html` and `/assets/*` under a fixed cache name. After a new Vite build (new hashed CSS/JS filenames), clients could keep serving old HTML (or poisoned asset entries), so `/assets/index-OLDHASH.css` 404’d → unstyled page. Same SW could also linger on the Cloudflare tunnel origin and intercept Vite `/src/*` during local `./dev.sh`.

**Fix:** Versioned SW (`rydn-<buildhash>`), network-only for HTML, content-type checks before caching assets, purge SW in DEV, stylesheet-load recovery + one reload on `controllerchange`. See `frontend/public/sw.js` + `frontend/src/swClient.ts`.

| Role | Name | Date | Result |
|------|------|------|--------|
| Engineering | | | ☐ Ready / ☐ Hold |
| Product | | | ☐ Ready / ☐ Hold |

**Engineering recommendation:** Ready for **public beta / soft production** after the production configuration checklist above and one live OAuth+sync smoke on the real domain.
