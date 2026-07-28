#!/usr/bin/env bash
# Local verification that the Railway Docker image boots correctly.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker not found — falling back to local production self-test"
  exec "$(dirname "$0")/railway_selftest_local.sh"
fi

IMAGE="rydn-railway-selftest:local"
NAME="rydn-selftest-$$"
SECRET="$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"
PORT=18765

cleanup() {
  docker rm -f "$NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "==> docker build"
docker build -t "$IMAGE" -f Dockerfile .

echo "==> docker run (PORT=$PORT)"
docker run -d --name "$NAME" \
  -p "${PORT}:8000" \
  -e PORT=8000 \
  -e ULTRA_ENV=production \
  -e ULTRA_SECRET="$SECRET" \
  -e PUBLIC_URL=https://rydn.bike \
  -e APP_URL=https://rydn.bike \
  -e API_URL=https://rydn.bike \
  -e ULTRA_DATA_DIR=/data \
  -e RAILWAY_ENVIRONMENT=production \
  "$IMAGE"

echo "==> wait for /health"
ok=0
for i in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:${PORT}/health" >/tmp/rydn-health.json 2>/dev/null; then
    ok=1
    break
  fi
  sleep 1
done
if [[ "$ok" != "1" ]]; then
  echo "FAIL: health never became ready"
  docker logs "$NAME" | tail -80
  exit 1
fi

echo "==> health body"
cat /tmp/rydn-health.json
echo
python3 - <<'PY'
import json
h=json.load(open("/tmp/rydn-health.json"))
assert h.get("status")=="ok", h
assert h.get("env")=="production", h
assert h.get("secureCookies") is True, h
print("health assertions OK")
PY

echo "==> SPA index"
code=$(curl -s -o /tmp/rydn-index.html -w "%{http_code}" "http://127.0.0.1:${PORT}/")
test "$code" = "200"
grep -qi '<div id="root"' /tmp/rydn-index.html || grep -qi 'id="root"' /tmp/rydn-index.html
echo "SPA OK ($code)"

echo "==> /api/health"
curl -fsS "http://127.0.0.1:${PORT}/api/health" >/dev/null

echo "==> missing ULTRA_SECRET should fail"
docker rm -f "${NAME}-nosecret" >/dev/null 2>&1 || true
if docker run --rm --name "${NAME}-nosecret" \
  -e PORT=8000 \
  -e ULTRA_ENV=production \
  -e RAILWAY_ENVIRONMENT=production \
  -e PUBLIC_URL=https://rydn.bike \
  "$IMAGE" >/tmp/rydn-nosecret.log 2>&1; then
  echo "FAIL: container started without ULTRA_SECRET"
  cat /tmp/rydn-nosecret.log | tail -40
  exit 1
fi
grep -qi "ULTRA_SECRET" /tmp/rydn-nosecret.log
echo "secret validation OK"

echo
echo "ALL RAILWAY SELF-TESTS PASSED"
