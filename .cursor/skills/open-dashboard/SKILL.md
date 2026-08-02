---
name: open-dashboard
description: >-
  Open the local RYDN founder dashboard (users, usage, payments, plan status).
  Use when the user says open-dashboard, open dashboard, founder dashboard,
  or asks to view founder metrics / ops stats locally.
---

# Open RYDN founder dashboard

Local-only ops UI. Never deploy it. Never expose on `0.0.0.0`.

## Do this

1. From the monorepo, run the one-shot script (syncs Railway `/data`, loads `ULTRA_SECRET` + Stripe key, starts server, opens browser):

```bash
cd /Users/jakobwinterholler/Desktop/UltraRoadbookGenerator/ultra-analytics
./founder/open-dashboard.sh
```

2. Request `all` permissions (Railway SSH + volume sync + localhost server). Approve Smart Mode if prompted — the script needs Railway secrets to decrypt users and show revenue.
3. When ready, tell the user the URL: `http://127.0.0.1:8787/`
4. Smoke-check with counts only (no emails/secrets):

```bash
curl -fsS http://127.0.0.1:8787/api/snapshot | python3 -c 'import json,sys; s=json.load(sys.stdin); print(s["summary"]["users"], s["summary"]["tierMix"], s.get("stripe",{}).get("revenue",{}).get("totalPaidCents"))'
```

## Flags

- `--no-sync` — reuse existing `ultra-analytics/founder/data` snapshot
- `--no-open` — start server but don’t open the browser
- `--port 8787` — override port

## Prerequisites (one-time)

- Railway CLI linked to the RYDN project (already true in this repo)
- SSH key at `~/.ssh/railway_rydn_ed25519` registered via `railway ssh keys add -k ~/.ssh/railway_rydn_ed25519.pub`
- Backend venv with deps (`ultra-analytics/backend/.venv`) preferred
- Optional: `export RAILWAY_TOKEN=…` (Railway Account → Tokens) for automatic hosting expenses in P&L
- Optional: set Google Maps monthly € in `founder/data/usage/recurring_costs.json`

## Do not

- Commit `founder/data/` or `.run/`
- Paste Stripe keys or user PII into chat
- Add founder routes to the production app
