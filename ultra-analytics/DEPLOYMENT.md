# RYDN — Railway deployment (zero-config repo)

Connect this GitHub repo → Deploy. No Root Directory. No start command edits.

| Piece | Location |
|---|---|
| Dockerfile | repo root `Dockerfile` (builds `ultra-analytics`) |
| railway.toml | repo root |
| App code | `ultra-analytics/` |
| Local dev | `cd ultra-analytics && ./dev.sh` |

---

## What you still do manually

1. Create a Railway project and connect this GitHub repo.
2. Add environment secrets (see below).
3. Attach a volume at `/data`.
4. Add custom domains `rydn.bike` and optionally `api.rydn.bike`.
5. Update DNS as Railway shows.
6. Register production OAuth redirect URIs in Google + Strava consoles (one-time).

Everything else is already automated: Docker build, SPA + API same process, `PORT`,
health checks, CORS for rydn.bike / api.rydn.bike, production logging, Secure cookies,
proxy headers, startup validation.

---

## Railway variables (paste)

```env
ULTRA_SECRET=<long-random-string>
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_MAPS_API_KEY=...   # server-side only (Metadata + GET /api/maps/js-config)
# GCP: enable Maps JavaScript API + Street View Metadata API; HTTP referrer restrict for rydn.bike
STRAVA_CLIENT_ID=...
STRAVA_CLIENT_SECRET=...

PUBLIC_URL=https://rydn.bike
APP_URL=https://rydn.bike
API_URL=https://rydn.bike
```

Generate secret:

```bash
python3 -c "import secrets; print(secrets.token_urlsafe(48))"
```

`ULTRA_ENV`, `ULTRA_DATA_DIR=/data`, and `PORT` are set by the image / Railway.

Optional split-API (same service, second hostname):

```env
API_URL=https://api.rydn.bike
GOOGLE_REDIRECT_URI=https://api.rydn.bike/api/auth/google/callback
STRAVA_REDIRECT_URI=https://api.rydn.bike/api/providers/strava/callback
```

Cookie domain / SameSite=None are auto-derived when `APP_URL` and `API_URL` hosts differ.

Full reference: `ultra-analytics/.env.example`.

---

## Domains

| Host | Points at |
|---|---|
| `https://rydn.bike` | Railway service (SPA + `/api`) |
| `https://api.rydn.bike` | Same service (optional CNAME) |

Railway provisions HTTPS certificates after DNS verifies.

---

## OAuth consoles (one-time)

| Provider | Value |
|---|---|
| Google JS origin | `https://rydn.bike` |
| Google redirect | `https://rydn.bike/api/auth/google/callback` |
| Strava callback domain | `rydn.bike` |

---

## Volume

Mount a Railway volume at **`/data`**. Without it the app starts with a warning and
data is wiped on every redeploy.

---

## Auto deploys

Every push to the connected branch (use `main`) rebuilds and deploys. Health check: `GET /health`.

---

## Local verify (optional)

```bash
chmod +x ultra-analytics/scripts/railway_selftest.sh
./ultra-analytics/scripts/railway_selftest.sh
```

Checks: Docker build, container boot, `/health`, SPA, missing-`ULTRA_SECRET` fail-fast.

---

## Local development (unchanged)

```bash
cd ultra-analytics
./dev.sh
```
