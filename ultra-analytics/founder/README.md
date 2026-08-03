# RYDN founder dashboard (local only)

Private ops view of users, usage, plan status, and Stripe revenue. **Not deployed** to rydn.bike. Binds to `127.0.0.1` only.

## One-shot (recommended)

```bash
cd ultra-analytics
./founder/open-dashboard.sh
# syncs Railway /data → founder/data, loads Stripe key, opens http://127.0.0.1:8787/
```

In Cursor, say **open-dashboard** — the agent runs that script.

Flags: `--no-sync` · `--no-open` · `--port 8787`

JSON API: `http://127.0.0.1:8787/api/snapshot`

Without Stripe you still get tiers, usage, Race Pass credits, redeem codes, etc.

### API & service usage

Outbound calls (Google Maps / Street View, Strava, Overpass, Open-Meteo, OpenTopoData) plus Railway volume size.

Counters live in production at `/data/usage/meter.json`. Sync pulls them. **Deploy the metering build first.**

### Profit & loss + paid stack

Catalog: [`founder/paid_stack.json`](paid_stack.json) — every service wired to RYDN (runtime or how you build it), with list prices.

| Service | Role | Typical cost | Auto? |
|---------|------|--------------|-------|
| Railway | runtime | Hobby ~$5/mo + usage | `RAILWAY_TOKEN` |
| Cloudflare | runtime | Free plan $0 | — |
| Google Maps | runtime | Usage (often $0 w/ credit) | Paste GCP invoice |
| Google OAuth | runtime | Free | — |
| Strava API | runtime | Free | — |
| Stripe | runtime | % + fixed per charge | From charges |
| Domain rydn.bike | runtime | ~€15/yr | Edit catalog |
| Open-Meteo / OpenTopo / Overpass | runtime | Free | — |
| **Cursor Pro** | build | **$20/mo** | List price in catalog |
| GitHub | build | Free | — |
| Apple Developer | future | €99/yr | Off until you enable |

Overrides: `founder/data/usage/paid_stack.json` (merge by `id`).

**Month profit** = Stripe net − paid-stack burn − manual expenses.

```bash
export RAILWAY_TOKEN=…   # Railway Account → Tokens
```


## Manual start

```bash
export ULTRA_DATA_DIR=./founder/data   # or any snapshot
export STRIPE_SECRET_KEY=sk_live_…     # optional
./founder/run.sh
```

## Sync production data

`open-dashboard.sh` pulls `/data` over `railway ssh` and loads `ULTRA_SECRET` + `STRIPE_SECRET_KEY` from Railway variables (needed to decrypt sealed user files and show revenue).

Manual copy of the Railway volume (`ULTRA_DATA_DIR=/data`) should include at least:

```
users/<uid>.json
users/<uid>/rides|routes|ultras/…
.secret                 # needed to decrypt sealed tokens in user JSON
redeem_codes.json       # optional
stripe_billing.json     # optional — improves Pro / Race Pass labeling
```

Practical options:

1. **Railway volume backup / download** from the project volume UI, then unpack locally.
2. **SSH + tar** (if your Railway plan allows shell):
   ```bash
   railway ssh -- tar -C /data -czf - . > ~/rydn-data.tgz
   mkdir -p ~/rydn-data-snapshot
   tar -xzf ~/rydn-data.tgz -C ~/rydn-data-snapshot
   export ULTRA_DATA_DIR=~/rydn-data-snapshot
   ```
3. Drop a snapshot into `ultra-analytics/founder/data/` (gitignored) and run `./founder/run.sh` with no env.

Treat the snapshot as production PII. Do not commit it.

## Security

- Listens on **127.0.0.1** only (not `0.0.0.0`)
- Not linked from the RYDN app; not in the Docker image
- Dashboard output strips access/refresh tokens
- Re-sync when you want fresher numbers — this is not live

## Port

```bash
export FOUNDER_PORT=8787
```
