#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

"${SCRIPT_DIR}/stop.sh"
sleep 1
OPEN_BROWSER="${OPEN_BROWSER:-1}" exec "${SCRIPT_DIR}/start.sh"
