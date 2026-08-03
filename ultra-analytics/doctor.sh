#!/usr/bin/env bash
# Ultra doctor — validate env, tunnel, DNS, HTTPS, local servers, OAuth values.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -x "$ROOT/backend/.venv/bin/python" ]; then
  PY="$ROOT/backend/.venv/bin/python"
else
  PY="$(command -v python3)"
fi
exec "$PY" "$ROOT/scripts/doctor.py" "$@"
