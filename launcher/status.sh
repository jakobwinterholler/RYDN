#!/usr/bin/env bash
# Quick port check — run ./doctor for full diagnostics.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
source "${SCRIPT_DIR}/common.sh"

failed=0
for row in \
  "Backend|${BACKEND_URL}|${BACKEND_PORT}" \
  "Desktop|${APP_URL}|${FRONTEND_PORT}" \
  "Companion|${COMPANION_URL}|${COMPANION_PORT}"; do
  IFS='|' read -r name url port <<<"${row}"
  if http_ok "${url}"; then
    log_ok "${name} — ${url}"
  else
    log_fail "${name} — not running"
    failed=1
  fi
done

if (( failed > 0 )); then
  log ""
  log "Run ./start to launch everything, or ./doctor for details."
  exit 1
fi

log ""
log "All services up. Full check: ./doctor"
