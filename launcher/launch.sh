#!/usr/bin/env bash
# Desktop app launcher — delegates to ./start
exec "$(cd "$(dirname "$0")" && pwd)/launcher/start.sh" "$@"
