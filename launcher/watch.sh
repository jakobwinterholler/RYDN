#!/usr/bin/env bash
# Background supervisor — restarts managed dev processes if they exit unexpectedly.

WATCH_INTERVAL_SEC="${WATCH_INTERVAL_SEC:-5}"

dev_watch_loop() {
  while true; do
    sleep "${WATCH_INTERVAL_SEC}"

    if [[ -f "${BACKEND_PID_FILE}" ]]; then
      local pid
      pid="$(cat "${BACKEND_PID_FILE}")"
      if ! is_pid_running "${pid}" && ! is_backend_ready; then
        log_warn "Backend exited unexpectedly — restarting..."
        rm -f "${BACKEND_PID_FILE}"
        start_backend_if_needed || log_fail "Backend restart failed"
      fi
    fi

    if [[ -f "${FRONTEND_PID_FILE}" ]]; then
      local pid
      pid="$(cat "${FRONTEND_PID_FILE}")"
      if ! is_pid_running "${pid}" && ! is_frontend_ready; then
        log_warn "Desktop (Vite) exited unexpectedly — restarting..."
        rm -f "${FRONTEND_PID_FILE}"
        start_frontend_if_needed || log_fail "Desktop restart failed"
      fi
    fi

    if [[ -f "${COMPANION_PID_FILE}" ]]; then
      local pid
      pid="$(cat "${COMPANION_PID_FILE}")"
      if ! is_pid_running "${pid}" && ! is_companion_ready; then
        log_warn "Companion (Vite) exited unexpectedly — restarting..."
        rm -f "${COMPANION_PID_FILE}"
        start_companion_if_needed || log_fail "Companion restart failed"
      fi
    fi
  done
}
