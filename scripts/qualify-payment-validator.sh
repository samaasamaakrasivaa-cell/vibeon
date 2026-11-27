#!/usr/bin/env bash
set -euo pipefail
image=${1:?Supply the locally built payment-validator image}
name="sec0011-validator-qualification-$$"
cleanup() { docker rm -f -v "$name" >/dev/null 2>&1 || true; }
trap cleanup EXIT

# Use a new container with only a temporary socket mount and no credentials.
docker run -d --name "$name" --network none --read-only --tmpfs /run/payment-validator:uid=1000,gid=1000,mode=0700 \
  --memory 256m --memory-swap 256m --pids-limit 32 --cap-drop ALL --security-opt no-new-privileges \
  "$image" >/dev/null
if ! docker exec "$name" test -S /run/payment-validator/worker.sock; then
  for attempt in {1..10}; do
    sleep 1
    if docker exec "$name" test -S /run/payment-validator/worker.sock 2>/dev/null; then break; fi
  done
fi
if ! docker exec "$name" test -S /run/payment-validator/worker.sock; then
  docker logs "$name" >&2
  exit 1
fi

docker exec "$name" sh -eu -c '
  cd /sys/fs/cgroup
  cat memory.max memory.swap.max
  test "$(cat memory.max)" = 268435456
  test "$(cat memory.swap.max)" = 0
  before=$(awk "/^oom_kill /{print \$2}" memory.events)
  # Consume physical pages only inside this disposable cgroup.
  rc=0
  timeout 30 node -e "const pages=[]; for (;;) pages.push(Buffer.alloc(16*1024**2, 81))" || rc=$?
  test "$rc" = 137
  after=$(awk "/^oom_kill /{print \$2}" memory.events)
  test "$after" -gt "$before"
  cat memory.peak memory.events cpu.stat
'
docker exec "$name" test -S /run/payment-validator/worker.sock
