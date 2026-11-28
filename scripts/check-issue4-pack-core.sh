#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
for file in .env .env.local .env.production .env.production.local; do
  [[ ! -e "$file" ]] || { echo "Use a clean checkout without $file" >&2; exit 1; }
done

endpoint=$(docker context inspect "$(docker context show)" --format '{{.Endpoints.docker.Host}}')
[[ "$endpoint" == unix://* && ${DOCKER_HOST:-$endpoint} == unix://* ]]
scratch=$(mktemp -d)
name="vibeon-issue4-${scratch##*.}"
app_pid=
cleanup() {
  if [[ -n "$app_pid" ]]; then kill "$app_pid" 2>/dev/null || true; fi
  docker rm -f -v "$name" >/dev/null 2>&1 || true
  rm -rf -- "$scratch"
}
trap cleanup EXIT

docker run --rm --detach --name "$name" --publish 127.0.0.1::5432 \
  --env POSTGRES_USER=issue4_fixture --env POSTGRES_PASSWORD=issue4_local --env POSTGRES_DB=issue4 \
  --volume /var/lib/postgresql/data postgres:16-alpine >/dev/null
for attempt in {1..30}; do
  if docker exec "$name" pg_isready -q -h 127.0.0.1 -U issue4_fixture -d issue4; then break; fi
  sleep 1
done
docker exec "$name" pg_isready -q -h 127.0.0.1 -U issue4_fixture -d issue4
db_port=$(docker port "$name" 5432/tcp)
[[ "$db_port" =~ ^127\.0\.0\.1:[0-9]+$ ]]
app_port=$(node -e 'const listener=require("node:net").createServer();listener.listen(0,"127.0.0.1",()=>{console.log(listener.address().port);listener.close()})')
app_url="http://127.0.0.1:$app_port"
test_env=(
  "PATH=$(dirname "$(command -v node)"):/usr/local/bin:/usr/bin:/bin"
  "DATABASE_URL=postgresql://issue4_fixture:issue4_local@$db_port/issue4"
  "APP_URL=$app_url" "UPLOAD_DIR=$scratch/uploads" "AI_PROVIDER=mock"
  "NEXT_TELEMETRY_DISABLED=1" "BILLING_SCHEDULER=off" "CRON_SECRET=synthetic-issue4"
)

mkdir -p "$scratch/prior/migrations"
cp prisma/schema.prisma "$scratch/prior/"
cp prisma/migrations/migration_lock.toml "$scratch/prior/migrations/"
for migration in prisma/migrations/[0-9]*; do
  if [[ ${migration##*/} < 20261215092000_pack_usage ]]; then cp -r "$migration" "$scratch/prior/migrations/"; fi
done
env -i "${test_env[@]}" ./node_modules/.bin/prisma migrate deploy --schema "$scratch/prior/schema.prisma"
docker exec -i "$name" psql -X -q -v ON_ERROR_STOP=1 -U issue4_fixture -d issue4 <<'SQL'
INSERT INTO "User" (id, email, name, role, "updatedAt")
VALUES ('teacher', 'teacher@example.invalid', 'Synthetic teacher', 'TEACHER', now()),
       ('other-teacher', 'other@example.invalid', 'Other synthetic teacher', 'TEACHER', now());
INSERT INTO "TeacherProfile" ("userId") VALUES ('teacher'), ('other-teacher');
INSERT INTO "Student" (id, "teacherId", name, status, "updatedAt")
VALUES ('history', 'teacher', 'Synthetic history', 'ACTIVE', now());
INSERT INTO "Pack" (id, "studentId", "lessonsTotal", "lessonsLeft", price)
VALUES ('history-spent', 'history', 2, 1, 500), ('history-untouched', 'history', 2, 2, 500);
INSERT INTO "Session" (id, "userId", "tokenHash", "expiresAt")
SELECT id, id, encode(sha256(convert_to('fixture-' || id, 'UTF8')), 'hex'), now() + interval '1 day'
FROM "User";
SQL
env -i "${test_env[@]}" ./node_modules/.bin/prisma migrate deploy
env -i "${test_env[@]}" ./node_modules/.bin/prisma generate
env -i "${test_env[@]}" npm run build
mkdir -p .next/standalone/content/placement
cp -a .next/static .next/standalone/.next/
cp -a public prompts .next/standalone/
cp -a content/placement/audio .next/standalone/content/placement/
env -i "${test_env[@]}" HOSTNAME=127.0.0.1 PORT="$app_port" node .next/standalone/server.js >"$scratch/app.log" 2>&1 &
app_pid=$!
for attempt in {1..45}; do
  if curl --fail --silent "$app_url/api/health" >/dev/null; then break; fi
  sleep 1
done
curl --fail --silent "$app_url/api/health" >/dev/null
if ! env -i "${test_env[@]}" node scripts/check-issue4-pack-core.mjs; then
  cat "$scratch/app.log" >&2
  exit 1
fi
