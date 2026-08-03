#!/usr/bin/env bash
# Production self-test without Docker (when Docker Desktop is unavailable).
# Exercises the same runtime path the container CMD uses.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
UA="$ROOT/ultra-analytics"
cd "$UA"

SECRET="$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"
PORT=18766
DIST="$UA/frontend/dist"
LOG="/tmp/rydn-uvicorn-selftest.log"
PID=""
PY="$UA/backend/.venv/bin/python"

cleanup() {
  if [[ -n "${PID}" ]] && kill -0 "$PID" 2>/dev/null; then
    kill "$PID" 2>/dev/null || true
    wait "$PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

echo "==> python venv + deps"
if [[ ! -x "$PY" ]]; then
  python3 -m venv "$UA/backend/.venv"
  PY="$UA/backend/.venv/bin/python"
fi
"$PY" -m pip install --quiet -r "$UA/backend/requirements.txt"

echo "==> frontend production build"
(
  cd frontend
  npm ci --silent
  VITE_API_BASE= VITE_PUBLIC_URL=https://rydn.bike npm run build
)
test -f "$DIST/index.html"

echo "==> uvicorn production start (PORT=$PORT)"
(
  cd backend
  export ULTRA_ENV=production
  export ULTRA_SECRET="$SECRET"
  export PUBLIC_URL=https://rydn.bike
  export APP_URL=https://rydn.bike
  export API_URL=https://rydn.bike
  export ULTRA_DATA_DIR="/tmp/rydn-selftest-data-$$"
  export FRONTEND_DIST="$DIST"
  export PORT="$PORT"
  export RAILWAY_ENVIRONMENT=production
  mkdir -p "$ULTRA_DATA_DIR"
  "$PY" -m uvicorn app.main:app --host 127.0.0.1 --port "$PORT" --proxy-headers --forwarded-allow-ips='*' \
    >"$LOG" 2>&1 &
  echo $! > /tmp/rydn-uvicorn.pid
)
PID="$(cat /tmp/rydn-uvicorn.pid)"

echo "==> wait for /health"
ok=0
for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:${PORT}/health" >/tmp/rydn-health.json 2>/dev/null; then
    ok=1
    break
  fi
  if ! kill -0 "$PID" 2>/dev/null; then
    echo "FAIL: uvicorn exited early"
    cat "$LOG" | tail -80
    exit 1
  fi
  sleep 0.5
done
if [[ "$ok" != "1" ]]; then
  echo "FAIL: health never ready"
  cat "$LOG" | tail -80
  exit 1
fi

python3 - <<'PY'
import json
h=json.load(open("/tmp/rydn-health.json"))
assert h.get("status")=="ok", h
assert h.get("env")=="production", h
assert h.get("secureCookies") is True, h
print("health assertions OK", h)
PY

echo "==> SPA + assets"
code=$(curl -s -o /tmp/rydn-index.html -w "%{http_code}" "http://127.0.0.1:${PORT}/")
test "$code" = "200"
grep -q 'id="root"' /tmp/rydn-index.html
asset=$(python3 -c "import re; h=open('/tmp/rydn-index.html').read(); m=re.search(r'/assets/[A-Za-z0-9._/-]+', h); print(m.group(0) if m else '')")
if [[ -n "$asset" ]]; then
  acode=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:${PORT}${asset}")
  test "$acode" = "200"
  echo "asset OK $asset"
fi

curl -fsS "http://127.0.0.1:${PORT}/api/health" >/dev/null
echo "api health OK"

echo "==> missing ULTRA_SECRET fails"
(
  cd backend
  export ULTRA_DATA_DIR="/tmp/rydn-nosecret-$$"
  export FRONTEND_DIST="$DIST"
  "$PY" -c "
import os
os.environ['ULTRA_ENV'] = 'production'
os.environ['RAILWAY_ENVIRONMENT'] = 'production'
os.environ['PUBLIC_URL'] = 'https://rydn.bike'
os.environ.pop('ULTRA_SECRET', None)
import app.config as cfg
cfg._CENTRAL_ENV = '/tmp/rydn-no-env-central'
cfg._BACKEND_ENV = '/tmp/rydn-no-env-backend'
cfg._env_mtime = None
cfg._config = None
cfg._secret = None
try:
    cfg.get_secret()
except RuntimeError as e:
    assert 'ULTRA_SECRET' in str(e)
    print('secret validation OK:', e)
else:
    raise SystemExit('expected RuntimeError for missing ULTRA_SECRET')
"
)

echo "==> Dockerfile / railway.toml present"
test -f "$ROOT/Dockerfile"
test -f "$ROOT/railway.toml"
grep -q 'healthcheckPath = "/health"' "$ROOT/railway.toml"
grep -q 'ULTRA_DATA_DIR=/data' "$ROOT/Dockerfile"

echo
echo "ALL LOCAL PRODUCTION SELF-TESTS PASSED"
