#!/usr/bin/env bash
# Ultra — one command to run the full local + Cloudflare Tunnel stack.
#
#   ./dev.sh
#
# Starts backend, frontend, named tunnel. Verifies DNS/HTTPS when possible.
# First run also bootstraps the tunnel (create / config / DNS) when cloudflared
# is logged in. See SETUP.md for the few dashboard clicks that cannot be scripted.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACK="$ROOT/backend"
FRONT="$ROOT/frontend"
TUNNEL_LOG="$ROOT/.tunnel.log"
PY=""

pick_python() {
  if [ -x "$BACK/.venv/bin/python" ]; then
    PY="$BACK/.venv/bin/python"
  else
    PY="$(command -v python3)"
  fi
}

fail() { echo "✖ $*" >&2; exit 1; }
ok() { echo "✓ $*"; }
info() { echo "▸ $*"; }

echo ""
echo "════════════════════════════════════════════════════════"
echo "  Ultra — ./dev.sh"
echo "════════════════════════════════════════════════════════"
echo ""

# --- central env ---
if [ ! -f "$ROOT/.env" ]; then
  if [ -f "$ROOT/.env.example" ]; then
    cp "$ROOT/.env.example" "$ROOT/.env"
    info "Created .env from .env.example — paste Google/Strava secrets into it"
  else
    fail "Missing .env and .env.example"
  fi
fi

# --- deps ---
if [ ! -d "$BACK/.venv" ]; then
  info "Creating Python venv…"
  python3 -m venv "$BACK/.venv"
fi
pick_python
info "Installing backend deps…"
"$PY" -m pip install --quiet --upgrade pip
"$PY" -m pip install --quiet -r "$BACK/requirements.txt"
pick_python

if [ ! -d "$FRONT/node_modules" ]; then
  info "Installing frontend deps…"
  (cd "$FRONT" && npm install --silent)
fi

# Sync derived URLs into backend/.env + frontend/.env.local
info "Syncing URLs from .env…"
"$PY" "$ROOT/scripts/urls.py" sync >/dev/null

# shellcheck disable=SC1091
set -a
source "$ROOT/.env"
set +a

PUBLIC_URL="${PUBLIC_URL:-https://rydn.bike}"
APP_URL="${APP_URL:-$PUBLIC_URL}"
PORT_FE="${PORT_FE:-5180}"
PORT_BE="${PORT_BE:-8100}"
TUNNEL_NAME="${TUNNEL_NAME:-ultra-local}"
TUNNEL_HOSTNAME="${TUNNEL_HOSTNAME:-rydn.bike}"

# Required secrets (clear fail)
missing=()
[ -n "${GOOGLE_CLIENT_ID:-}" ] || missing+=("GOOGLE_CLIENT_ID")
[ -n "${GOOGLE_CLIENT_SECRET:-}" ] || missing+=("GOOGLE_CLIENT_SECRET")
[ -n "${STRAVA_CLIENT_ID:-}" ] || missing+=("STRAVA_CLIENT_ID")
[ -n "${STRAVA_CLIENT_SECRET:-}" ] || missing+=("STRAVA_CLIENT_SECRET")
if [ "${#missing[@]}" -gt 0 ]; then
  echo ""
  echo "✖ Missing secrets in ultra-analytics/.env:"
  for m in "${missing[@]}"; do echo "    - $m"; done
  echo ""
  echo "  Paste them once, save, re-run ./dev.sh"
  echo "  (OAuth redirect hosts are already derived from PUBLIC_URL — do not hardcode.)"
  echo ""
  # Still allow boot without secrets? User asked to verify required env — fail.
  exit 1
fi
ok "Environment secrets present"

# --- tunnel bootstrap (create/config/dns when possible) ---
info "Ensuring Cloudflare Tunnel…"
if ! "$PY" "$ROOT/scripts/ensure_tunnel.py"; then
  fail "Tunnel bootstrap failed — fix the MANUAL STEP above, then re-run ./dev.sh"
fi

# --- free ports ---
for port in "$PORT_BE" "$PORT_FE"; do
  pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    info "Freeing port ${port}…"
    # shellcheck disable=SC2086
    kill $pids 2>/dev/null || true
    sleep 0.3
  fi
done
pkill -f "cloudflared tunnel run ${TUNNEL_NAME}" 2>/dev/null || true
pkill -f "cloudflared tunnel --url" 2>/dev/null || true

CLOUDFLARED="$(command -v cloudflared || true)"
[ -z "$CLOUDFLARED" ] && [ -x /opt/homebrew/bin/cloudflared ] && CLOUDFLARED=/opt/homebrew/bin/cloudflared
[ -n "$CLOUDFLARED" ] || fail "cloudflared missing"

# --- start backend ---
info "Starting backend :${PORT_BE}"
(
  cd "$BACK"
  set -a
  # shellcheck disable=SC1091
  [ -f .env ] && source .env
  # Prefer central env
  [ -f "$ROOT/.env" ] && source "$ROOT/.env"
  set +a
  exec ./.venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port "$PORT_BE" --reload --reload-include ".env"
) &
BACK_PID=$!

FRONT_PID=""
TUNNEL_PID=""
cleanup() {
  echo ""
  info "Shutting down…"
  [ -n "${TUNNEL_PID:-}" ] && kill "$TUNNEL_PID" 2>/dev/null || true
  [ -n "${FRONT_PID:-}" ] && kill "$FRONT_PID" 2>/dev/null || true
  kill "$BACK_PID" 2>/dev/null || true
  pkill -f "cloudflared tunnel run ${TUNNEL_NAME}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo -n "▸ Waiting for backend"
for i in $(seq 1 60); do
  if curl -sf "http://127.0.0.1:${PORT_BE}/api/health" >/dev/null 2>&1; then
    echo " — ready"
    break
  fi
  echo -n "."
  sleep 0.2
  if [ "$i" = 60 ]; then echo " FAILED"; fail "Backend did not start"; fi
done
ok "Backend reachable"

# --- frontend ---
info "Starting frontend :${PORT_FE}"
(
  cd "$FRONT"
  exec npx vite --host 0.0.0.0 --port "$PORT_FE"
) &
FRONT_PID=$!

echo -n "▸ Waiting for frontend"
for i in $(seq 1 60); do
  if curl -sf "http://127.0.0.1:${PORT_FE}/" >/dev/null 2>&1; then
    echo " — ready"
    break
  fi
  echo -n "."
  sleep 0.2
  if [ "$i" = 60 ]; then echo " FAILED"; fail "Frontend did not start"; fi
done
ok "Frontend reachable"

# --- tunnel ---
info "Starting tunnel '${TUNNEL_NAME}'…"
: > "$TUNNEL_LOG"
"$CLOUDFLARED" tunnel --config "${HOME}/.cloudflared/config.yml" run "$TUNNEL_NAME" \
  >"$TUNNEL_LOG" 2>&1 &
TUNNEL_PID=$!

echo -n "▸ Waiting for tunnel connection"
for i in $(seq 1 50); do
  if grep -Eqi "Registered tunnel connection|Registered.*connection|connIndex=" "$TUNNEL_LOG" 2>/dev/null; then
    echo " — ready"
    break
  fi
  if ! kill -0 "$TUNNEL_PID" 2>/dev/null; then
    echo " FAILED"
    tail -40 "$TUNNEL_LOG" || true
    fail "Tunnel process exited — see .tunnel.log"
  fi
  echo -n "."
  sleep 0.4
  if [ "$i" = 50 ]; then
    echo " (timeout — continuing; check logs)"
  fi
done

# Re-sync (hot reload) so APP_URL is authoritative
"$PY" "$ROOT/scripts/urls.py" sync >/dev/null
sleep 0.3

# --- verify DNS + HTTPS ---
info "Verifying DNS ${TUNNEL_HOSTNAME}…"
if python3 -c "import socket; socket.getaddrinfo('${TUNNEL_HOSTNAME}', 443)" 2>/dev/null; then
  ok "DNS resolves"
else
  echo "✖ DNS does not resolve for ${TUNNEL_HOSTNAME}"
  echo "  Fix: Cloudflare site Active + tunnel route dns (SETUP.md)"
fi

info "Verifying HTTPS ${APP_URL}…"
HTTPS_OK=0
for i in $(seq 1 20); do
  if curl -sfI --max-time 5 "${APP_URL}" >/dev/null 2>&1; then
    HTTPS_OK=1
    break
  fi
  sleep 1
done
if [ "$HTTPS_OK" = 1 ]; then
  ok "HTTPS works"
else
  echo "✖ HTTPS not responding yet at ${APP_URL}"
  echo "  Check: SSL/TLS mode Full · tunnel connected · DNS proxied"
  echo "  Log:   tail -50 ${TUNNEL_LOG}"
fi

info "Verifying public API…"
if curl -sf --max-time 5 "${APP_URL}/api/health" >/dev/null 2>&1; then
  ok "Public API reachable"
else
  echo "✖ ${APP_URL}/api/health failed (tunnel or Vite proxy)"
fi

HOST_ONLY="$(python3 -c "from urllib.parse import urlparse; print(urlparse('${APP_URL}').hostname or '')")"

echo ""
echo "────────────────────────────────────────────────────────"
echo "  Local:     http://localhost:${PORT_FE}"
echo "  Public:    ${APP_URL}"
echo "  API:       ${APP_URL}/api/health"
echo ""
echo "  Google JS origin:     ${APP_URL}"
echo "  Google redirect URI:  ${APP_URL}/api/auth/google/callback"
echo "  Strava callback host: ${HOST_ONLY}"
echo ""
echo "  Doctor:    ./doctor.sh"
echo "  Stop:      Ctrl+C"
echo "────────────────────────────────────────────────────────"
echo ""

if command -v open >/dev/null 2>&1; then
  open "${APP_URL}"
fi

wait "$FRONT_PID"
