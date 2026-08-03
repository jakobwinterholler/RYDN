#!/usr/bin/env bash
# Alias — same as ./dev.sh
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/dev.sh" "$@"
