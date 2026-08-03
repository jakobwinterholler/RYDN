#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
source "${SCRIPT_DIR}/common.sh"

OPEN_BROWSER="${OPEN_BROWSER:-1}"

run_start() {
  log "🚀 Starting Ultra Roadbook..."
  log ""

  local failed=0

  if is_backend_ready; then
    log_ok "Backend (already running)"
  else
    log_step "Starting backend..."
    start_backend_if_needed && log_ok "Backend" || { log_fail "Backend"; failed=1; }
  fi

  if is_frontend_ready; then
    log_ok "Desktop (already running)"
  else
    log_step "Starting desktop..."
    start_frontend_if_needed && log_ok "Desktop" || { log_fail "Desktop"; failed=1; }
  fi

  if is_companion_ready; then
    log_ok "Companion (already running)"
  else
    log_step "Starting companion..."
    start_companion_if_needed && log_ok "Companion" || { log_fail "Companion"; failed=1; }
  fi

  if is_backend_ready; then
    log_ok "API"
  else
    log_fail "API"
    failed=1
  fi

  if (( failed > 0 )); then
    log ""
    log_fail "Some services failed to start. Run ./doctor for details."
    return 1
  fi

  start_watcher_if_needed

  if [[ "${OPEN_BROWSER}" == "1" ]]; then
    open_browser_url "${APP_URL}"
    open_browser_url "${COMPANION_URL}"
  fi

  print_ready_banner

  if [[ -n "${ULTRA_ROADBOOK_DAEMON:-}" ]]; then
    # Keep this session alive so dev servers are not reaped when start finishes.
    wait
  fi
}

# Re-exec in a new session so servers survive after this script exits.
if [[ -z "${ULTRA_ROADBOOK_DAEMON:-}" ]]; then
  export ULTRA_ROADBOOK_DAEMON=1
  mkdir -p "${RUN_DIR}"
  START_LOG="${RUN_DIR}/start.log"

  if command -v setsid >/dev/null 2>&1; then
    setsid env ULTRA_ROADBOOK_DAEMON=1 OPEN_BROWSER="${OPEN_BROWSER}" \
      bash "${SCRIPT_DIR}/start.sh" >>"${START_LOG}" 2>&1 < /dev/null &
  else
    nohup env ULTRA_ROADBOOK_DAEMON=1 OPEN_BROWSER="${OPEN_BROWSER}" \
      bash "${SCRIPT_DIR}/start.sh" >>"${START_LOG}" 2>&1 < /dev/null &
  fi
  disown -h "$!" 2>/dev/null || true

  local_attempts=90
  local_i=0
  while (( local_i < local_attempts )); do
    if is_backend_ready && is_frontend_ready && is_companion_ready; then
      break
    fi
    sleep 0.5
    local_i=$((local_i + 1))
  done

  if is_backend_ready && is_frontend_ready && is_companion_ready; then
    log "🚀 Starting Ultra Roadbook..."
    log ""
    log_ok "Backend"
    log_ok "Desktop"
    log_ok "Companion"
    log_ok "API"
    print_ready_banner
    exit 0
  fi

  log_fail "Timed out waiting for dev servers — see ${START_LOG}"
  exit 1
fi

run_start
