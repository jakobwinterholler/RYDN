#!/usr/bin/env bash
# One-time: deploy ultra-roadbook-api on Render from repo render.yaml.
# Requires RENDER_API_KEY from https://dashboard.render.com/u/settings#api-keys
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -z "${RENDER_API_KEY:-}" ]]; then
  echo "Set RENDER_API_KEY, then re-run this script."
  echo "Or use the dashboard: New → Blueprint → jakobwinterholler/UltraRoadbookGenerator"
  exit 1
fi

if [[ ! -f .env ]]; then
  echo "Missing .env with SUPABASE_* values for the API service."
  exit 1
fi

set -a
# shellcheck disable=SC1091
source .env
set +a

for key in SUPABASE_URL SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY SUPABASE_JWT_SECRET; do
  if [[ -z "${!key:-}" ]]; then
    echo "Missing ${key} in .env"
    exit 1
  fi
done

echo "Creating Render Blueprint deploy from render.yaml…"
curl -fsS -X POST "https://api.render.com/v1/blueprint-instances" \
  -H "Authorization: Bearer ${RENDER_API_KEY}" \
  -H "Content-Type: application/json" \
  -d "$(jq -n \
    --arg repo "https://github.com/jakobwinterholler/UltraRoadbookGenerator" \
    --arg branch "${RENDER_DEPLOY_BRANCH:-main}" \
    '{repo:"'"$repo"'",branch:"'"$branch"'"}')" \
  | tee /tmp/render-blueprint.json

echo ""
echo "After deploy completes, verify:"
echo "  curl https://ultra-roadbook-api.onrender.com/api/health"
echo "Then redeploy Companion if needed:"
echo "  vercel --prod --yes"
