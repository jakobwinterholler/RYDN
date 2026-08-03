#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
source "${SCRIPT_DIR}/common.sh"

issues=0

check_ok() {
  log_ok "$1"
}

check_issue() {
  log_fail "$1"
  issues=$((issues + 1))
}

check_warn() {
  log_warn "$1"
}

log "Ultra Roadbook Doctor"
log ""

# --- Tools ---
log "Tools"
if command -v python3 >/dev/null 2>&1; then
  check_ok "python3 $(python3 --version 2>&1 | tr -d '\n')"
else
  check_issue "python3 not found"
fi

if npm_bin="$(find_npm)"; then
  npm_version="$("${npm_bin}" --version 2>&1 | head -1)"
  check_ok "npm ${npm_version}"
else
  check_issue "npm not found"
fi

if command -v curl >/dev/null 2>&1; then
  check_ok "curl available"
else
  check_issue "curl not found (required for health checks)"
fi

log ""

# --- Ports & services ---
log "Services"

check_service_row() {
  local name="$1"
  local url="$2"
  local port="$3"
  local pids
  pids="$(port_pids "${port}")"

  if http_ok "${url}"; then
    if [[ -n "${pids}" ]]; then
      check_ok "${name} — ${url} (port ${port}, pid ${pids})"
    else
      check_warn "${name} — ${url} responds but no listener on port ${port}"
    fi
    return 0
  fi

  if [[ -n "${pids}" ]]; then
    check_issue "${name} — port ${port} listening (pid ${pids}) but ${url} not healthy"
  else
    check_issue "${name} — not running (${url})"
  fi
}

check_service_row "Backend" "${BACKEND_URL}" "${BACKEND_PORT}"
check_service_row "Desktop" "${APP_URL}" "${FRONTEND_PORT}"
check_service_row "Companion" "${COMPANION_URL}" "${COMPANION_PORT}"

if [[ -f "${WATCHER_PID_FILE}" ]]; then
  watcher_pid="$(cat "${WATCHER_PID_FILE}")"
  if is_pid_running "${watcher_pid}"; then
    check_ok "Process watcher (pid ${watcher_pid})"
  else
    check_warn "Watcher pid file stale — run ./start to restart supervisor"
  fi
else
  check_warn "Process watcher not running — crashes won't auto-recover until ./start"
fi

log ""

# --- API ---
log "API"
if is_backend_ready; then
  api_body="$(curl -sf "${BACKEND_URL}" 2>/dev/null || true)"
  check_ok "GET /api/health → ${api_body:-ok}"
  if curl -sf "http://127.0.0.1:${BACKEND_PORT}/api/races" >/dev/null 2>&1; then
    check_ok "GET /api/races"
  else
    check_warn "GET /api/races failed (may require auth for some routes)"
  fi
else
  check_issue "Backend API unreachable"
fi

log ""

# --- Environment ---
log "Environment"

check_env_file() {
  local file="$1"
  local label="$2"
  if [[ -f "${file}" ]]; then
    check_ok "${label} exists (${file})"
  else
    check_warn "${label} missing — copy from .env.example (${file})"
  fi
}

check_env_file "${PROJECT_ROOT}/.env" "Root .env"
check_env_file "${PROJECT_ROOT}/frontend/.env.local" "Desktop .env.local"
check_env_file "${PROJECT_ROOT}/companion/.env.local" "Companion .env.local"

check_supabase_var() {
  local key="$1"
  local file="$2"
  local value
  value="$(read_env_var "${key}" "${file}" || true)"
  if is_placeholder_env "${value}"; then
    check_warn "${key} not configured in ${file}"
  else
    check_ok "${key} configured"
  fi
}

for file in "${PROJECT_ROOT}/.env" "${PROJECT_ROOT}/frontend/.env.local" "${PROJECT_ROOT}/companion/.env.local"; do
  [[ -f "${file}" ]] || continue
  check_supabase_var "VITE_SUPABASE_URL" "${file}"
  check_supabase_var "VITE_SUPABASE_ANON_KEY" "${file}"
done

if [[ -f "${PROJECT_ROOT}/.env" ]]; then
  check_supabase_var "SUPABASE_URL" "${PROJECT_ROOT}/.env"
  check_supabase_var "SUPABASE_ANON_KEY" "${PROJECT_ROOT}/.env"
fi

# Live Supabase ping (optional)
supabase_url="$(read_env_var "VITE_SUPABASE_URL" "${PROJECT_ROOT}/frontend/.env.local" || read_env_var "VITE_SUPABASE_URL" "${PROJECT_ROOT}/.env" || true)"
if ! is_placeholder_env "${supabase_url}"; then
  rest_url="${supabase_url%/}/rest/v1/"
  if curl -sf -o /dev/null -w "" -H "apikey: public" "${rest_url}" 2>/dev/null; then
    check_ok "Supabase REST reachable"
  elif curl -sf -o /dev/null "${supabase_url}" 2>/dev/null; then
    check_ok "Supabase project URL reachable"
  else
    check_warn "Supabase URL set but not reachable (${supabase_url})"
  fi
else
  check_warn "Supabase not configured — cloud sync disabled"
fi

log ""

# --- Dependencies ---
log "Dependencies"
[[ -d "${PROJECT_ROOT}/frontend/node_modules" ]] && check_ok "Desktop node_modules" || check_issue "Desktop node_modules missing — run ./start"
[[ -d "${PROJECT_ROOT}/companion/node_modules" ]] && check_ok "Companion node_modules" || check_issue "Companion node_modules missing — run ./start"

if python_bin="$(find_python)"; then
  if PYTHONPATH="${PROJECT_ROOT}/src" "${python_bin}" -c "from server import app" 2>/dev/null; then
    check_ok "Python backend imports"
  else
    check_issue "Python backend import failed — pip install -r requirements.txt"
  fi
fi

log ""

if (( issues == 0 )); then
  log_ok "All critical checks passed"
  exit 0
fi

log_fail "${issues} issue(s) found — run ./start or ./restart to fix services"
exit 1
