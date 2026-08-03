#!/usr/bin/env bash

set -euo pipefail

export PATH="/usr/local/bin:/opt/homebrew/bin:${PATH}"

if [[ -n "${ULTRA_ROADBOOK_ROOT:-}" ]]; then
  PROJECT_ROOT="$(cd "${ULTRA_ROADBOOK_ROOT}" && pwd)"
else
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
fi

RUN_DIR="${PROJECT_ROOT}/.run"
BACKEND_PID_FILE="${RUN_DIR}/backend.pid"
FRONTEND_PID_FILE="${RUN_DIR}/frontend.pid"
COMPANION_PID_FILE="${RUN_DIR}/companion.pid"
WATCHER_PID_FILE="${RUN_DIR}/watcher.pid"
BACKEND_LOG="${RUN_DIR}/backend.log"
FRONTEND_LOG="${RUN_DIR}/frontend.log"
COMPANION_LOG="${RUN_DIR}/companion.log"
WATCHER_LOG="${RUN_DIR}/watcher.log"

APP_URL="http://127.0.0.1:5173"
COMPANION_URL="http://127.0.0.1:5175"
BACKEND_URL="http://127.0.0.1:8000/api/health"
BACKEND_PORT=8000
FRONTEND_PORT=5173
COMPANION_PORT=5175

mkdir -p "${RUN_DIR}"

log() {
  printf '%s\n' "$*"
}

log_ok() {
  printf '✓ %s\n' "$*"
}

log_warn() {
  printf '⚠ %s\n' "$*"
}

log_fail() {
  printf '✗ %s\n' "$*"
}

log_step() {
  printf '  %s\n' "$*"
}

is_pid_running() {
  local pid="$1"
  [[ -n "${pid}" ]] && kill -0 "${pid}" 2>/dev/null
}

port_pids() {
  local port="$1"
  lsof -tiTCP:"${port}" -sTCP:LISTEN 2>/dev/null || true
}

is_port_listening() {
  local port="$1"
  [[ -n "$(port_pids "${port}")" ]]
}

http_ok() {
  curl -sf "$1" >/dev/null 2>&1
}

is_backend_ready() {
  http_ok "${BACKEND_URL}"
}

is_frontend_ready() {
  http_ok "${APP_URL}"
}

is_companion_ready() {
  http_ok "${COMPANION_URL}"
}

wait_for_url() {
  local url="$1"
  local label="$2"
  local attempts="${3:-60}"
  local index=0
  while (( index < attempts )); do
    if http_ok "${url}"; then
      return 0
    fi
    sleep 0.5
    index=$((index + 1))
  done
  log_fail "${label} did not become ready in time"
  return 1
}

wait_for_backend() {
  wait_for_url "${BACKEND_URL}" "Backend"
}

wait_for_frontend() {
  wait_for_url "${APP_URL}" "Desktop"
}

wait_for_companion() {
  wait_for_url "${COMPANION_URL}" "Companion"
}

find_python() {
  if command -v python3 >/dev/null 2>&1; then
    command -v python3
    return 0
  fi
  return 1
}

find_npm() {
  if command -v npm >/dev/null 2>&1; then
    command -v npm
    return 0
  fi

  if [[ -d "${HOME}/.nvm/versions/node" ]]; then
    local latest
    latest="$(ls "${HOME}/.nvm/versions/node" 2>/dev/null | tail -1)"
    if [[ -n "${latest}" && -x "${HOME}/.nvm/versions/node/${latest}/bin/npm" ]]; then
      echo "${HOME}/.nvm/versions/node/${latest}/bin/npm"
      return 0
    fi
  fi

  return 1
}

ensure_node_dependencies() {
  local npm_bin="$1"
  local dir="$2"
  local label="$3"
  if [[ ! -d "${dir}/node_modules" ]]; then
    log_step "Installing ${label} dependencies..."
    (cd "${dir}" && "${npm_bin}" install)
  fi
}

read_env_var() {
  local key="$1"
  local file="$2"
  [[ -f "${file}" ]] || return 1
  grep -E "^${key}=" "${file}" 2>/dev/null | tail -1 | cut -d= -f2- | sed 's/^["'\'' ]//; s/["'\'' ]$//' || true
}

is_placeholder_env() {
  local value="${1:-}"
  [[ -z "${value}" ]] && return 0
  [[ "${value}" == *"your-"* ]] && return 0
  [[ "${value}" == *"example.com"* ]] && return 0
  return 1
}

open_browser_url() {
  local url="$1"
  if [[ "$(uname -s)" != "Darwin" ]]; then
    command -v xdg-open >/dev/null 2>&1 && xdg-open "${url}" >/dev/null 2>&1 && return 0
    return 0
  fi
  if [[ -d "/Applications/Google Chrome.app" ]]; then
    open -na "Google Chrome" --args "${url}" >/dev/null 2>&1 || open "${url}"
  else
    open "${url}"
  fi
}

print_ready_banner() {
  log ""
  log "✓ Ready"
  log ""
  log "Desktop:"
  log "${APP_URL}"
  log ""
  log "Companion:"
  log "${COMPANION_URL}"
  log ""
  log "Logs: ${RUN_DIR}/"
  log "Stop: ./stop"
}

kill_pid_file() {
  local pid_file="$1"
  local label="$2"

  [[ -f "${pid_file}" ]] || return 0

  local pid
  pid="$(cat "${pid_file}")"
  if is_pid_running "${pid}"; then
    log_step "Stopping ${label} (pid ${pid})..."
    kill "${pid}" 2>/dev/null || true
    local attempts=20
    local index=0
    while is_pid_running "${pid}" && (( index < attempts )); do
      sleep 0.25
      index=$((index + 1))
    done
    if is_pid_running "${pid}"; then
      kill -9 "${pid}" 2>/dev/null || true
    fi
  fi
  rm -f "${pid_file}"
}

kill_port() {
  local port="$1"
  local label="$2"
  local pids
  pids="$(port_pids "${port}")"
  [[ -n "${pids}" ]] || return 0
  log_step "Stopping ${label} on port ${port}..."
  # shellcheck disable=SC2068
  kill ${pids} 2>/dev/null || true
}

start_backend_if_needed() {
  if is_backend_ready; then
    return 0
  fi

  if [[ -f "${BACKEND_PID_FILE}" ]]; then
    local existing_pid
    existing_pid="$(cat "${BACKEND_PID_FILE}")"
    if is_pid_running "${existing_pid}"; then
      wait_for_backend
      return 0
    fi
    rm -f "${BACKEND_PID_FILE}"
  fi

  if is_port_listening "${BACKEND_PORT}"; then
    log_warn "Port ${BACKEND_PORT} is in use by another process — using existing listener"
    wait_for_backend || return 1
    return 0
  fi

  local python_bin
  python_bin="$(find_python)" || {
    log_fail "python3 not found"
    return 1
  }

  (
    cd "${PROJECT_ROOT}"
    nohup env PYTHONPATH=src "${python_bin}" -m uvicorn server:app --reload --host 127.0.0.1 --port "${BACKEND_PORT}" \
      >>"${BACKEND_LOG}" 2>&1 &
    echo $! >"${BACKEND_PID_FILE}"
    disown -h "$!" 2>/dev/null || true
  )

  wait_for_backend || {
    log_fail "Backend failed to start — see ${BACKEND_LOG}"
    return 1
  }
}

start_frontend_if_needed() {
  if is_frontend_ready; then
    return 0
  fi

  if [[ -f "${FRONTEND_PID_FILE}" ]]; then
    local existing_pid
    existing_pid="$(cat "${FRONTEND_PID_FILE}")"
    if is_pid_running "${existing_pid}"; then
      wait_for_frontend
      return 0
    fi
    rm -f "${FRONTEND_PID_FILE}"
  fi

  if is_port_listening "${FRONTEND_PORT}"; then
    log_warn "Port ${FRONTEND_PORT} is in use by another process — using existing listener"
    wait_for_frontend || return 1
    return 0
  fi

  local npm_bin
  npm_bin="$(find_npm)" || {
    log_fail "npm not found"
    return 1
  }

  ensure_node_dependencies "${npm_bin}" "${PROJECT_ROOT}/frontend" "Desktop"

  (
    cd "${PROJECT_ROOT}/frontend"
    nohup "${npm_bin}" run dev -- --host 127.0.0.1 --port "${FRONTEND_PORT}" >>"${FRONTEND_LOG}" 2>&1 &
    echo $! >"${FRONTEND_PID_FILE}"
    disown -h "$!" 2>/dev/null || true
  )

  wait_for_frontend || {
    log_fail "Desktop failed to start — see ${FRONTEND_LOG}"
    return 1
  }
}

start_companion_if_needed() {
  if is_companion_ready; then
    return 0
  fi

  if [[ -f "${COMPANION_PID_FILE}" ]]; then
    local existing_pid
    existing_pid="$(cat "${COMPANION_PID_FILE}")"
    if is_pid_running "${existing_pid}"; then
      wait_for_companion
      return 0
    fi
    rm -f "${COMPANION_PID_FILE}"
  fi

  if is_port_listening "${COMPANION_PORT}"; then
    log_warn "Port ${COMPANION_PORT} is in use by another process — using existing listener"
    wait_for_companion || return 1
    return 0
  fi

  local npm_bin
  npm_bin="$(find_npm)" || {
    log_fail "npm not found"
    return 1
  }

  ensure_node_dependencies "${npm_bin}" "${PROJECT_ROOT}/companion" "Companion"

  (
    cd "${PROJECT_ROOT}/companion"
    nohup "${npm_bin}" run dev -- --host 127.0.0.1 --port "${COMPANION_PORT}" >>"${COMPANION_LOG}" 2>&1 &
    echo $! >"${COMPANION_PID_FILE}"
    disown -h "$!" 2>/dev/null || true
  )

  wait_for_companion || {
    log_fail "Companion failed to start — see ${COMPANION_LOG}"
    return 1
  }
}

start_watcher_if_needed() {
  if [[ -f "${WATCHER_PID_FILE}" ]]; then
    local watcher_pid
    watcher_pid="$(cat "${WATCHER_PID_FILE}")"
    if is_pid_running "${watcher_pid}"; then
      return 0
    fi
    rm -f "${WATCHER_PID_FILE}"
  fi

  nohup bash -c "
    source '${SCRIPT_DIR}/common.sh'
    source '${SCRIPT_DIR}/watch.sh'
    dev_watch_loop
  " >>"${WATCHER_LOG}" 2>&1 &
  echo $! >"${WATCHER_PID_FILE}"
  disown -h "$!" 2>/dev/null || true
}

stop_all_services() {
  kill_pid_file "${WATCHER_PID_FILE}" "watcher"
  kill_pid_file "${COMPANION_PID_FILE}" "companion"
  kill_pid_file "${FRONTEND_PID_FILE}" "desktop"
  kill_pid_file "${BACKEND_PID_FILE}" "backend"
  kill_port "${COMPANION_PORT}" "companion"
  kill_port "${FRONTEND_PORT}" "desktop"
  kill_port "${BACKEND_PORT}" "backend"
}

# Backwards compatibility for launcher/launch.sh
open_application() {
  open_browser_url "${APP_URL}"
}
