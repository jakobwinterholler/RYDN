#!/usr/bin/env bash
# One-shot: sync Railway /data → local snapshot, start founder UI, open browser.
# Usage: ./founder/open-dashboard.sh [--no-sync] [--no-open] [--port 8787]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FOUNDER_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$ROOT/.." && pwd)"
DATA_DIR="${ULTRA_DATA_DIR:-$FOUNDER_DIR/data}"
PORT="${FOUNDER_PORT:-8787}"
SSH_KEY="${RAILWAY_SSH_KEY:-$HOME/.ssh/railway_rydn_ed25519}"
DO_SYNC=1
DO_OPEN=1

while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-sync) DO_SYNC=0 ;;
    --no-open) DO_OPEN=0 ;;
    --port)
      shift
      PORT="${1:?--port needs a value}"
      ;;
    --port=*) PORT="${1#--port=}" ;;
    *) printf 'Unknown arg: %s\n' "$1" >&2; exit 2 ;;
  esac
  shift
done

log() { printf '› %s\n' "$*"; }
die() { printf '✗ %s\n' "$*" >&2; exit 1; }

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Missing command: $1"
}

need_cmd railway
need_cmd curl
need_cmd tar
need_cmd rsync

pick_python() {
  if [[ -x "$ROOT/backend/.venv/bin/python" ]]; then
    echo "$ROOT/backend/.venv/bin/python"
  else
    echo "python3"
  fi
}

ensure_ssh() {
  if [[ ! -f "$SSH_KEY" ]]; then
    die "SSH key not found at $SSH_KEY.
Create and register once:
  ssh-keygen -t ed25519 -f $SSH_KEY -N ''
  railway ssh keys add -k ${SSH_KEY}.pub -n rydn-founder-mac"
  fi
  if ! railway ssh keys list 2>/dev/null | grep -q "rydn-founder\|$(basename "$SSH_KEY")\|SHA256"; then
    log "Registering SSH key with Railway…"
    railway ssh keys add -k "${SSH_KEY}.pub" -n "rydn-founder-$(hostname -s)" >/dev/null || true
  fi
}

sync_volume() {
  ensure_ssh
  mkdir -p "$DATA_DIR"
  local tmp
  tmp="$(mktemp -d "${TMPDIR:-/tmp}/rydn-sync.XXXXXX")"
  cleanup() { rm -rf "$tmp"; }
  trap cleanup EXIT

  log "Syncing Railway /data → $DATA_DIR …"
  (
    cd "$REPO_ROOT"
    railway ssh -i "$SSH_KEY" -- tar -C /data -czf - \
      --exclude=lost+found --exclude=cache .
  ) >"$tmp/snapshot.tgz"

  mkdir -p "$tmp/data"
  tar -xzf "$tmp/snapshot.tgz" -C "$tmp/data"
  [[ -d "$tmp/data/users" ]] || die "Tar extract missing users/ — check railway ssh"

  rsync -a --delete \
    --exclude 'lost+found' \
    --exclude 'cache' \
    "$tmp/data/" "$DATA_DIR/"

  # Railway volume size snapshot for the dashboard (not in /data itself).
  mkdir -p "$DATA_DIR/usage"
  (
    cd "$REPO_ROOT"
    railway volume list --json 2>/dev/null || true
  ) | "$PY" -c '
import json, sys, time
raw = sys.stdin.read().strip()
meta = {"capturedAt": time.time()}
try:
    data = json.loads(raw) if raw else {}
    vols = data.get("volumes") or []
    if vols:
        v = vols[0]
        meta.update({
            "id": v.get("id"),
            "name": v.get("name"),
            "mountPath": v.get("mountPath"),
            "currentSizeMB": v.get("currentSizeMB"),
            "sizeMB": v.get("sizeMB"),
            "status": v.get("status"),
        })
except Exception:
    pass
print(json.dumps(meta, indent=2))
' >"$DATA_DIR/usage/railway_meta.json" || true

  trap - EXIT
  cleanup
  [[ -d "$DATA_DIR/users" ]] || die "Sync finished but $DATA_DIR/users missing"
  log "Snapshot ready ($(du -sh "$DATA_DIR" | awk '{print $1}'))"
}

load_railway_secrets() {
  log "Loading secrets from Railway variables…"
  local json
  json="$(cd "$REPO_ROOT" && railway variables --json 2>/dev/null || true)"
  if [[ -z "$json" ]]; then
    log "No Railway variables; decrypt/revenue may be incomplete"
    return 0
  fi
  # Production user JSON is sealed with ULTRA_SECRET — required to load all users.
  if [[ -z "${ULTRA_SECRET:-}" ]]; then
    ULTRA_SECRET="$(
      "$PY" -c 'import json,sys; d=json.load(sys.stdin); print(d.get("ULTRA_SECRET") or "")' <<<"$json"
    )"
    export ULTRA_SECRET
  fi
  if [[ -n "${ULTRA_SECRET:-}" ]]; then
    # Keep a local copy so restarts with --no-sync still decrypt.
    printf '%s' "$ULTRA_SECRET" >"$DATA_DIR/.secret"
    chmod 600 "$DATA_DIR/.secret" 2>/dev/null || true
    log "ULTRA_SECRET loaded (decrypt)"
  else
    log "ULTRA_SECRET missing — some user files may fail to decrypt"
  fi
  if [[ -z "${STRIPE_SECRET_KEY:-}" ]]; then
    STRIPE_SECRET_KEY="$(
      "$PY" -c 'import json,sys; d=json.load(sys.stdin); print(d.get("STRIPE_SECRET_KEY") or "")' <<<"$json"
    )"
    export STRIPE_SECRET_KEY
  fi
  if [[ -n "${STRIPE_SECRET_KEY:-}" ]]; then
    log "Stripe key loaded"
  else
    log "STRIPE_SECRET_KEY missing — app metrics only"
  fi
}

dashboard_up() {
  curl -fsS "http://127.0.0.1:${PORT}/api/snapshot" >/dev/null 2>&1
}

start_server() {
  export ULTRA_DATA_DIR="$DATA_DIR"
  export FOUNDER_PORT="$PORT"
  # Persist env for detached restarts / debugging (gitignored).
  mkdir -p "$FOUNDER_DIR/.run"
  umask 077
  {
    printf 'export ULTRA_DATA_DIR=%q\n' "$ULTRA_DATA_DIR"
    printf 'export FOUNDER_PORT=%q\n' "$PORT"
    [[ -n "${ULTRA_SECRET:-}" ]] && printf 'export ULTRA_SECRET=%q\n' "$ULTRA_SECRET"
    [[ -n "${STRIPE_SECRET_KEY:-}" ]] && printf 'export STRIPE_SECRET_KEY=%q\n' "$STRIPE_SECRET_KEY"
    [[ -n "${RAILWAY_TOKEN:-}" ]] && printf 'export RAILWAY_TOKEN=%q\n' "$RAILWAY_TOKEN"
    [[ -n "${RAILWAY_API_TOKEN:-}" ]] && printf 'export RAILWAY_API_TOKEN=%q\n' "$RAILWAY_API_TOKEN"
  } >"$FOUNDER_DIR/.run/env.sh"

  if dashboard_up; then
    log "Restarting server so fresh secrets/snapshot apply…"
    if [[ -f "$FOUNDER_DIR/.run/server.pid" ]]; then
      old="$(cat "$FOUNDER_DIR/.run/server.pid" 2>/dev/null || true)"
      if [[ -n "$old" ]] && kill -0 "$old" 2>/dev/null; then
        kill "$old" 2>/dev/null || true
        sleep 0.4
      fi
    fi
  fi
  log "Starting founder dashboard on http://127.0.0.1:${PORT}/ …"
  # shellcheck disable=SC1090
  source "$FOUNDER_DIR/.run/env.sh"
  export FOUNDER_PYTHON="$PY"
  # New session so Cursor/tool shell exit cannot kill the server.
  "$PY" - "$ROOT" "$FOUNDER_DIR" <<'PY'
import os, subprocess, sys
root, founder = sys.argv[1], sys.argv[2]
run = os.path.join(founder, ".run")
log_path = os.path.join(run, "server.log")
pid_path = os.path.join(run, "server.pid")
os.makedirs(run, exist_ok=True)
env = os.environ.copy()
py = env.get("FOUNDER_PYTHON") or sys.executable
with open(log_path, "ab", buffering=0) as log:
    proc = subprocess.Popen(
        [py, "-m", "founder.server"],
        cwd=root,
        env=env,
        stdout=log,
        stderr=log,
        stdin=subprocess.DEVNULL,
        start_new_session=True,
    )
with open(pid_path, "w", encoding="utf-8") as f:
    f.write(str(proc.pid))
print(proc.pid)
PY
  for _ in $(seq 1 50); do
    if dashboard_up; then
      log "Dashboard ready"
      return 0
    fi
    sleep 0.2
  done
  die "Server did not become ready. See $FOUNDER_DIR/.run/server.log"
}

open_browser() {
  local url="http://127.0.0.1:${PORT}/"
  if command -v open >/dev/null 2>&1; then
    open "$url"
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$url"
  else
    log "Open manually: $url"
  fi
  log "$url"
}

PY="$(pick_python)"
cd "$ROOT"

if [[ "$DO_SYNC" == "1" ]]; then
  sync_volume
else
  [[ -d "$DATA_DIR/users" ]] || die "No snapshot at $DATA_DIR (omit --no-sync to pull from Railway)"
  log "Using existing snapshot: $DATA_DIR"
fi

load_railway_secrets
start_server

if [[ "$DO_OPEN" == "1" ]]; then
  open_browser
else
  log "http://127.0.0.1:${PORT}/"
fi
