#!/usr/bin/env bash
# Legacy entry point — use ./start instead.
exec "$(cd "$(dirname "$0")" && pwd)/start" "$@"
