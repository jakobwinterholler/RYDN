#!/usr/bin/env bash
# Local founder dashboard — never bind to a public interface.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FOUNDER_DIR="$(cd "$(dirname "$0")" && pwd)"

if [[ -z "${ULTRA_DATA_DIR:-}" ]]; then
  if [[ -d "$FOUNDER_DIR/data" ]]; then
    export ULTRA_DATA_DIR="$FOUNDER_DIR/data"
  else
    echo "Set ULTRA_DATA_DIR to a local copy of the Railway /data volume."
    echo "Example:"
    echo "  export ULTRA_DATA_DIR=~/rydn-data-snapshot"
    echo "  export STRIPE_SECRET_KEY=sk_live_…   # optional, for revenue"
    echo "  $0"
    echo
    echo "Or put a snapshot at: $FOUNDER_DIR/data"
    exit 1
  fi
fi

export ULTRA_DATA_DIR="$(cd "$ULTRA_DATA_DIR" && pwd)"
export FOUNDER_PORT="${FOUNDER_PORT:-8787}"

# Prefer backend venv if present
if [[ -x "$ROOT/backend/.venv/bin/python" ]]; then
  PY="$ROOT/backend/.venv/bin/python"
elif command -v python3 >/dev/null 2>&1; then
  PY="python3"
else
  echo "python3 not found"
  exit 1
fi

cd "$ROOT"
exec "$PY" -m founder.server
