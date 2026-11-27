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
  local result=$?
  if [[ "$result" -ne 0 ]]; then
    # These containers contain only disposable fixture data and credentials.
    # Keep diagnostics bounded while preserving the original failure status.
    if [[ -n "$DELIVERY_APP" ]]; then
      echo 'Isolated candidate startup status and recent logs:' >&2
      docker inspect --format '{{.State.Status}} (exit code {{.State.ExitCode}})' "$DELIVERY_APP" >&2 2>/dev/null || true
      docker logs --tail 60 "$DELIVERY_APP" >&2 2>&1 || true
    fi
    if [[ -n "$DELIVERY_DB" ]]; then
      echo 'Isolated database recent logs:' >&2
      docker logs --tail 30 "$DELIVERY_DB" >&2 2>&1 || true
    fi
  fi
  [[ -z "$DELIVERY_APP" ]] || docker rm -f "$DELIVERY_APP" >/dev/null 2>&1 || true
  [[ -z "$DELIVERY_DB" ]] || docker rm -f "$DELIVERY_DB" >/dev/null 2>&1 || true
  [[ -z "$DELIVERY_UPLOADS" ]] || docker volume rm "$DELIVERY_UPLOADS" >/dev/null 2>&1 || true
  [[ -z "$DELIVERY_NETWORK" ]] || docker network rm "$DELIVERY_NETWORK" >/dev/null 2>&1 || true
  return "$result"
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
DELIVERY_APP=$(docker run -d --network "$DELIVERY_NETWORK" \
  --mount "type=volume,source=$DELIVERY_UPLOADS,target=/app/uploads" \
  -e DATABASE_URL=postgresql://vibeon:synthetic-only@db:5432/vibeon \
  -e AUTH_SECRET=isolated-delivery-test-with-no-real-accounts \
  -e APP_URL=http://localhost:3000 -e "APP_VERSION=$DELIVERY_SHA" \
  -e AI_PROVIDER=mock -e TELEGRAM_MOCK=1 "$DELIVERY_IMAGE")
# The candidate stays on its internal network. Probe its own loopback without
# depending on the runner's Docker port-publication implementation.
DELIVERY_READY_BY=$((SECONDS + 120))
DELIVERY_HEALTHY=0
while [[ "$SECONDS" -lt "$DELIVERY_READY_BY" ]]; do
  if docker exec "$DELIVERY_APP" node -e \
    "fetch('http://127.0.0.1:3000/api/health', {signal: AbortSignal.timeout(2000)}).then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))" \
    >/dev/null 2>&1; then DELIVERY_HEALTHY=1; break; fi
  [[ "$SECONDS" -lt "$DELIVERY_READY_BY" ]] || break
  sleep 2
done
[[ "$DELIVERY_HEALTHY" -eq 1 ]] || { echo 'Isolated candidate image did not become healthy.' >&2; exit 1; }
docker exec -i "$DELIVERY_APP" node - "$DELIVERY_SHA" <<'JS'
const assert = require('node:assert/strict');
const expected = process.argv[2];
async function request(route) {
  return fetch('http://127.0.0.1:3000' + route, {
    signal: AbortSignal.timeout(10000),
    redirect: 'manual',
  });
}
(async () => {
  const healthResponse = await request('/api/health');
  assert(healthResponse.ok, 'health request failed');
  const health = await healthResponse.json();
  assert(health.ok === true && health.version === expected, 'wrong healthy image');
  const versionResponse = await request('/api/version');
  assert(versionResponse.ok, 'version request failed');
  assert((await versionResponse.json()).v === expected, 'wrong browser build stamp');
  for (const route of ['/', '/teacher', '/student', '/ui']) {
    const response = await request(route);
    assert(response.status >= 200 && response.status < 400, 'route request failed: ' + route);
    await response.arrayBuffer();
  }
})().then(() => process.exit(0)).catch(error => {
  console.error('Isolated image check failed: ' + error.message);
  process.exit(1);
});
JS
printf 'Verified isolated image %s for source %s\n' "$DELIVERY_IMAGE" "$DELIVERY_SHA"
