#!/usr/bin/env bash
# Bootstrap the FastAPI analysis server on Render (required for Companion GPX import).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

API_URL="${ULTRA_ROADBOOK_API_URL:-https://ultra-roadbook-api.onrender.com}"
HEALTH_URL="${API_URL}/api/health"

echo "==> Checking analysis API at ${HEALTH_URL}"
if curl -fsS --max-time 20 "$HEALTH_URL" >/dev/null 2>&1; then
  echo "OK: Analysis API is live."
  exit 0
fi

echo ""
echo "Analysis API is not running yet."
echo ""
echo "Deploy on Render (one-time):"
echo "  1. Open https://dashboard.render.com → New → Blueprint"
echo "  2. Connect GitHub repo jakobwinterholler/UltraRoadbookGenerator"
echo "  3. Apply render.yaml (service: ultra-roadbook-api)"
echo "  4. Set env vars from .env:"
echo "       SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_JWT_SECRET"
echo "  5. Wait for deploy, then verify:"
echo "       curl ${HEALTH_URL}"
echo ""
echo "Companion is configured to proxy /api/* to ${API_URL} via companion/vercel.json."
echo "Redeploy Companion after the API is live:"
echo "  vercel --prod --yes"
echo ""

if [[ -n "${RENDER_API_KEY:-}" ]]; then
  echo "RENDER_API_KEY is set — create/update the service via Render dashboard Blueprint sync."
else
  echo "Optional: export RENDER_API_KEY from Render account settings for CLI/API automation."
fi

exit 1
