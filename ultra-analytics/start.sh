#!/usr/bin/env bash
# Deprecated alias — use ./dev.sh
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/dev.sh" "$@"
