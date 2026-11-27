#!/usr/bin/env bash
# Test the exact production image with disposable data and an internal network.
set -euo pipefail
DELIVERY_IMAGE=${1:?image id is required}
DELIVERY_SHA=${2:?full source SHA is required}
[[ "$DELIVERY_IMAGE" =~ ^sha256:[a-f0-9]{64}$ ]]
[[ "$DELIVERY_SHA" =~ ^[a-f0-9]{40}$ ]]
[[ $(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$DELIVERY_IMAGE") == "$DELIVERY_SHA" ]]

DELIVERY_FIXTURE="delivery-image-$$-$RANDOM"
DELIVERY_NETWORK=""
DELIVERY_DB=""
DELIVERY_APP=""
DELIVERY_UPLOADS=""
cleanup() {
  [[ -z "$DELIVERY_APP" ]] || docker rm -f "$DELIVERY_APP" >/dev/null 2>&1 || true
  [[ -z "$DELIVERY_DB" ]] || docker rm -f "$DELIVERY_DB" >/dev/null 2>&1 || true
  [[ -z "$DELIVERY_UPLOADS" ]] || docker volume rm "$DELIVERY_UPLOADS" >/dev/null 2>&1 || true
  [[ -z "$DELIVERY_NETWORK" ]] || docker network rm "$DELIVERY_NETWORK" >/dev/null 2>&1 || true
}
trap cleanup EXIT
docker pull postgres:16-alpine >/dev/null
DELIVERY_NETWORK=$(docker network create --internal "$DELIVERY_FIXTURE")
DELIVERY_UPLOADS=$(docker volume create "$DELIVERY_FIXTURE-uploads")
DELIVERY_DB=$(docker run -d --network "$DELIVERY_NETWORK" --network-alias db \
  -e POSTGRES_USER=vibeon -e POSTGRES_PASSWORD=synthetic-only -e POSTGRES_DB=vibeon \
  --tmpfs /var/lib/postgresql/data:rw postgres:16-alpine)
for attempt in {1..30}; do
  docker exec "$DELIVERY_DB" pg_isready -h 127.0.0.1 -U vibeon >/dev/null 2>&1 && break
  [[ "$attempt" -lt 30 ]] || { echo 'Isolated test database did not start.' >&2; exit 1; }
  sleep 1
done
DELIVERY_APP=$(docker run -d --network "$DELIVERY_NETWORK" -p 127.0.0.1::3000 \
  --mount "type=volume,source=$DELIVERY_UPLOADS,target=/app/uploads" \
  -e DATABASE_URL=postgresql://vibeon:synthetic-only@db:5432/vibeon \
  -e AUTH_SECRET=isolated-delivery-test-with-no-real-accounts \
  -e APP_URL=http://localhost:3000 -e "APP_VERSION=$DELIVERY_SHA" \
  -e AI_PROVIDER=mock -e TELEGRAM_MOCK=1 "$DELIVERY_IMAGE")
DELIVERY_PORT=$(docker port "$DELIVERY_APP" 3000/tcp)
[[ "$DELIVERY_PORT" =~ ^127\.0\.0\.1:[0-9]+$ ]]
for attempt in {1..60}; do
  if curl -fsS --max-time 2 "http://$DELIVERY_PORT/api/health" > /dev/null 2>&1; then break; fi
  [[ "$attempt" -lt 60 ]] || { echo 'Isolated candidate image did not become healthy.' >&2; exit 1; }
  sleep 2
done
python3 - "$DELIVERY_PORT" "$DELIVERY_SHA" <<'PY'
import json, sys, urllib.request
base, expected = "http://" + sys.argv[1], sys.argv[2]
with urllib.request.urlopen(base + "/api/health", timeout=10) as response:
    health = json.load(response)
assert health.get("ok") is True and health.get("version") == expected, "wrong healthy image"
with urllib.request.urlopen(base + "/api/version", timeout=10) as response:
    assert json.load(response).get("v") == expected, "wrong browser build stamp"
PY
for route in / /teacher /student /ui; do
  curl -fsS --max-time 10 -o /dev/null "http://$DELIVERY_PORT$route"
done
printf 'Verified isolated image %s for source %s\n' "$DELIVERY_IMAGE" "$DELIVERY_SHA"
