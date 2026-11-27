#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
for env_file in .env .env.local .env.production .env.production.local; do
  if [[ -e "$env_file" ]]; then
    printf 'Use a clean test checkout without %s\n' "$env_file" >&2
    exit 1
  fi
done

# All database commands target a new disposable local Docker instance.
docker_endpoint=$(docker context inspect "$(docker context show)" --format '{{.Endpoints.docker.Host}}')
if [[ "$docker_endpoint" != unix://* || ${DOCKER_HOST:-$docker_endpoint} != unix://* ]]; then
  echo "The rehearsal requires a local Unix Docker socket" >&2
  exit 1
fi
scratch=$(mktemp -d)
container="vibeon-sec0011-${scratch##*.}"
app_pid=
cleanup() {
  if [[ -n "$app_pid" ]]; then kill "$app_pid" 2>/dev/null || true; fi
  docker rm -f -v "$container" >/dev/null 2>&1 || true
  rm -rf -- "$scratch"
}
trap cleanup EXIT

docker run --rm --detach --name "$container" --publish 127.0.0.1::5432 \
  --env POSTGRES_USER=sec_test --env POSTGRES_PASSWORD=sec_test_local \
  --env POSTGRES_DB=sec0011 --volume /var/lib/postgresql/data postgres:16-alpine >/dev/null
for attempt in {1..60}; do
  if docker exec "$container" pg_isready -q -h 127.0.0.1 -U sec_test -d sec0011; then break; fi
  sleep 1
done
docker exec "$container" pg_isready -q -h 127.0.0.1 -U sec_test -d sec0011
db_port=$(docker port "$container" 5432/tcp)
db_url="postgresql://sec_test:sec_test_local@$db_port"
app_port=$(node -e 'const s=require("node:net").createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')
app_url="http://127.0.0.1:$app_port"

sql() {
  local database=$1
  shift
  docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U sec_test -d "$database" "$@"
}

mkdir -p "$scratch/prior/migrations" "$scratch/source-files" "$scratch/restored-files" "$scratch/copy"
cp prisma/schema.prisma "$scratch/prior/"
cp prisma/migrations/migration_lock.toml "$scratch/prior/migrations/"
for migration in prisma/migrations/[0-9]*; do
  if [[ ${migration##*/} < 20261215090000_payment_documents ]]; then cp -r "$migration" "$scratch/prior/migrations/"; fi
done
DATABASE_URL="$db_url/sec0011" ./node_modules/.bin/prisma migrate deploy --schema "$scratch/prior/schema.prisma" >"$scratch/prior.log"
size=$(node scripts/check-sec-001-1.mjs create-files "$scratch/source-files")
sql sec0011 -q -v fixture_size="$size" < scripts/check-sec-001-1-fixtures.sql

# Capture evidence while the synthetic historic invoice still has its link.
sql sec0011 -q <<'SQL' >"$scratch/financial.csv"
COPY (
    SELECT u.id AS upload_id, u.path, u."ownerId" AS owner_id,
        'financial' AS disposition, i.id AS evidence_reference
    FROM "Invoice" i
    JOIN "Upload" u ON i."receiptFile" = '/api/files/' || u.path
    WHERE i.id IN ('invoice-historical', 'invoice-historical-conflict')
) TO STDOUT WITH (FORMAT csv, HEADER true);
SQL
sql sec0011 -qc "UPDATE \"Invoice\" SET \"receiptFile\" = NULL WHERE id IN ('invoice-historical', 'invoice-historical-conflict')"
[[ $(wc -l < "$scratch/financial.csv") == 3 ]]
before=$(sql sec0011 -Atc 'SELECT md5(jsonb_agg(to_jsonb(i) ORDER BY id)::text) FROM "Invoice" i')

# Rehearse a paired backup in a quiescent environment and restore into a new DB
# and file directory while the application is stopped.
docker exec "$container" pg_dump -Fc -U sec_test sec0011 > "$scratch/copy/database.dump"
tar -C "$scratch/source-files" -cf "$scratch/copy/uploads.tar" .
(cd "$scratch/copy" && sha256sum database.dump uploads.tar > SHA256SUMS && sha256sum -c SHA256SUMS)
docker exec -i "$container" pg_restore --list < "$scratch/copy/database.dump" >/dev/null
tar -tf "$scratch/copy/uploads.tar" >/dev/null
mkdir -p "$scratch/corrupt-copy"
cp "$scratch/copy/database.dump" "$scratch/copy/SHA256SUMS" "$scratch/corrupt-copy/"
printf 'incomplete archive' > "$scratch/corrupt-copy/uploads.tar"
if (cd "$scratch/corrupt-copy" && sha256sum -c SHA256SUMS >/dev/null 2>&1); then
  echo "A corrupt paired backup passed validation" >&2
  exit 1
fi
docker exec "$container" createdb -U sec_test sec0011_restored
docker exec -i "$container" pg_restore --exit-on-error --single-transaction -U sec_test -d sec0011_restored < "$scratch/copy/database.dump"
tar -C "$scratch/restored-files" -xf "$scratch/copy/uploads.tar"
diff -rq "$scratch/source-files" "$scratch/restored-files"
[[ $(sql sec0011_restored -Atc 'SELECT md5(jsonb_agg(to_jsonb(i) ORDER BY id)::text) FROM "Invoice" i') == "$before" ]]
echo "Paired backup restored in isolation"

DATABASE_URL="$db_url/sec0011_restored" ./node_modules/.bin/prisma migrate deploy >"$scratch/current.log"
[[ $(sql sec0011_restored -Atc 'SELECT md5(jsonb_agg(to_jsonb(i) ORDER BY id)::text) FROM "Invoice" i') == "$before" ]]
pending=$(sql sec0011_restored -Atc "SELECT count(*) FROM \"Upload\" WHERE \"legacyUnverified\"")
[[ "$pending" == 3 ]]
[[ $(sql sec0011_restored -Atc "SELECT \"paymentKind\" FROM \"Upload\" WHERE id = 'legacy-conflicting-history'") == RECEIPT ]]
docker cp scripts/classify-legacy-upload-evidence.sql "$container":/tmp/classify-legacy-upload-evidence.sql
cat "$scratch/financial.csv" > "$scratch/reviewed.csv"
printf 'legacy-unknown,2026/11/HHHHHHHHHHHHHHHHHHHHHHHH.png,teacher-a,educational,synthetic-reviewed-lesson-history\n' >> "$scratch/reviewed.csv"
apply_inventory() { sql sec0011_restored -q -f /tmp/classify-legacy-upload-evidence.sql; }
apply_inventory < "$scratch/reviewed.csv"
apply_inventory < "$scratch/reviewed.csv"
sed 's/financial/educational/g' "$scratch/financial.csv" > "$scratch/conflict.csv"
if apply_inventory < "$scratch/conflict.csv" >"$scratch/conflict.log" 2>&1; then
  echo "Educational reclassification of a financial file was accepted" >&2
  exit 1
fi
grep -q 'conflicts with financial evidence' "$scratch/conflict.log"
echo "Historical evidence and controlled educational recovery passed"
DATABASE_URL="$db_url/sec0011_restored" ./node_modules/.bin/prisma generate
node --conditions=react-server --import tsx scripts/check-payment-document-content.ts

# Clear the inherited environment so mail, bot and OCR cannot use real credentials.
test_path="$(dirname "$(command -v node)"):/usr/local/bin:/usr/bin:/bin"
test_env=(
  "PATH=$test_path" "DATABASE_URL=$db_url/sec0011_restored" "APP_URL=$app_url"
  "UPLOAD_DIR=$scratch/restored-files" "AI_PROVIDER=mock" "BILLING_SCHEDULER=off" "NEXT_TELEMETRY_DISABLED=1"
)
env -i "${test_env[@]}" npm run build
mkdir -p .next/standalone/content/placement
cp -a .next/static .next/standalone/.next/
cp -a public prompts .next/standalone/
cp -a content/placement/audio .next/standalone/content/placement/
env -i "${test_env[@]}" HOSTNAME=127.0.0.1 PORT="$app_port" node .next/standalone/server.js >"$scratch/app.log" 2>&1 &
app_pid=$!
for attempt in {1..60}; do
  if curl --fail --silent "$app_url/api/health" >/dev/null; then break; fi
  sleep 1
done
curl --fail --silent "$app_url/api/health" >/dev/null
if ! env -i "${test_env[@]}" node scripts/check-sec-001-1.mjs verify; then
  cat "$scratch/app.log" >&2
  exit 1
fi
