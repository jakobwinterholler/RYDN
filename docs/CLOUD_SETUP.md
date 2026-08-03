# Cloud sync setup (Phase 1)

## 1. Supabase project

1. Create a project at [supabase.com](https://supabase.com)
2. Apply the migration (creates `profiles`, `races`, RLS, storage bucket):

```bash
pip install psycopg2-binary python-dotenv
# Supabase Dashboard → Project Settings → Database → database password
export SUPABASE_DB_PASSWORD='your-database-password'
python scripts/apply_supabase_migration.py
```

Or paste the SQL from `supabase/migrations/001_phase1.sql` into the Supabase SQL editor.

3. Copy from **Project Settings → API**:
   - Project URL → `SUPABASE_URL` / `VITE_SUPABASE_URL`
   - **anon** or **publishable** key → `SUPABASE_ANON_KEY` / `VITE_SUPABASE_ANON_KEY`
   - service_role key → `SUPABASE_SERVICE_ROLE_KEY` (backend only)
   - JWT secret → `SUPABASE_JWT_SECRET` (backend only)

> **Note:** Supabase’s Next.js guide uses `NEXT_PUBLIC_*` and `@supabase/ssr`. This project uses **Vite** (`VITE_*` env vars) and **`@supabase/supabase-js`** in `shared/auth/` — do not add Next.js middleware or `@supabase/ssr` unless you migrate to Next.js.

## 2. Google OAuth

1. [Google Cloud Console](https://console.cloud.google.com/) → OAuth client (Web)
2. Authorized redirect URIs:
   - `https://<project-ref>.supabase.co/auth/v1/callback`
3. Supabase → Authentication → Providers → Google → paste client ID + secret
4. Supabase → Authentication → URL Configuration:
   - **Site URL:** your primary dev origin, e.g. `http://127.0.0.1:5173` (not the production Companion URL)
   - **Redirect URLs** (add every origin + `/auth/callback`):
     - `http://127.0.0.1:5173/auth/callback`
     - `http://localhost:5173/auth/callback`
     - `http://127.0.0.1:5175/auth/callback`
     - `http://localhost:5175/auth/callback`
     - `https://companion-road-book.vercel.app/auth/callback`
     - `https://companion-flax.vercel.app/auth/callback` (if using this alias)

   Each app sends `redirectTo = window.location.origin + '/auth/callback'` dynamically.
   If the redirect URL is missing from this list, Supabase falls back to **Site URL** —
   which is why Desktop sign-in was incorrectly returning to production Companion.

## 3. Local environment

```bash
cp .env.example .env
# fill in Supabase values

cp .env.example frontend/.env.local
cp .env.example companion/.env.local
# same VITE_* values in both
```

Backend loads `.env` from repo root when starting uvicorn.

## 4. Run locally

```bash
pip install -r requirements.txt
cd frontend && npm install
cd companion && npm install
cd shared && npm install

./run_dev.sh                 # desktop → http://127.0.0.1:5173
cd companion && npm run dev  # companion → http://127.0.0.1:5175
```

## 5. iPhone / production Companion

The Companion reads **directly from Supabase** (race list + bundle download) by default. **Mobile GPX import** uses `POST /api/sync/import-gpx` on the analysis server. See [MOBILE_GPX_IMPORT.md](./MOBILE_GPX_IMPORT.md).

Set these Vercel environment variables for the `companion` project:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_API_BASE_URL` — optional; production uses same-origin `/api/*` rewrites in `companion/vercel.json` when unset

### 5.1 Deploy the API (mobile import)

The Companion PWA is static on Vercel; **GPX import requires a running FastAPI server**.

**Option A — Render (recommended)**

1. Push this repo to GitHub (include `render.yaml` on the branch Render tracks, usually `main`).
2. [Render Dashboard](https://dashboard.render.com) → **New** → **Blueprint** → connect the repo (`render.yaml` is included).
3. Set env vars: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`.
4. After deploy, verify: `curl https://ultra-roadbook-api.onrender.com/api/health` → `{"status":"ok",...}`
5. Redeploy Companion if you changed `companion/vercel.json` (`vercel --prod --yes` from repo root). No `VITE_API_BASE_URL` needed when the rewrite target matches your Render URL.

Or run `./scripts/verify_production_api.sh` to check API + print next steps.

**Option B — Local + tunnel (quick phone test)**

```bash
./run_dev.sh
# In another terminal, expose :8000 (e.g. ngrok http 8000)
# Set companion/.env.local: VITE_API_BASE_URL=https://<tunnel-url>
cd companion && npm run dev -- --host
# Open http://<your-lan-ip>:5175 on iPhone (same Wi‑Fi)
```

## 6. End-to-end workflow

1. **Desktop:** Sign in (Settings → Account) → import GPX → analyze → verify stops
2. Races sync automatically to Supabase in the background
3. **Companion (iPhone):** Sign in with the same Google account → race list appears
4. Tap a race → downloads for offline → open without internet

## 7. Verify sync

After signing in on desktop and analyzing a race:

```bash
# From Supabase dashboard → Table Editor → races
# Row should exist with has_bundle = true

# Or via API (optional):
curl -H "Authorization: Bearer <jwt>" http://127.0.0.1:8000/api/sync/races
```
