#!/usr/bin/env bash
set -euo pipefail

verify() {
  local bundle=$1
  (cd "$bundle" && sha256sum -c SHA256SUMS && tar -tf uploads.tar >/dev/null)
}

case "${1:-}" in
  verify)
    [[ $# == 2 ]]
    verify "$2"
    ;;
  capture)
    if [[ $# != 6 ]]; then
      echo "Usage: $0 capture DB_CONTAINER DB_USER DB_NAME UPLOAD_VOLUME OUTPUT_DIRECTORY" >&2
      exit 2
    fi
    db=$2 user=$3 database=$4 uploads=$5 output=$6
    for value in "$db" "$user" "$database" "$uploads"; do [[ "$value" =~ ^[A-Za-z0-9_.-]+$ ]]; done
    [[ ! -e "$output" ]]
    # Docker exec uses the PostgreSQL Unix socket while network admission is closed.
    # The operator holds ingress and writer automation closed throughout.
    isolated_db() {
      local network_mode networks ports
      network_mode=$(docker inspect --format '{{.HostConfig.NetworkMode}}' "$db") || return 1
      networks=$(docker inspect --format '{{range $name, $_ := .NetworkSettings.Networks}}{{if ne $name "none"}}{{$name}}{{end}}{{end}}' "$db") || return 1
      ports=$(docker inspect --format '{{range .NetworkSettings.Ports}}{{range .}}{{.HostPort}}{{end}}{{end}}' "$db") || return 1
      [[ "$network_mode" != host && "$network_mode" != container:* && -z "$networks" && -z "$ports" ]]
    }
    isolated_db || { echo "Disconnect PostgreSQL from Docker networks before capture" >&2; exit 1; }
    docker volume inspect "$uploads" >/dev/null
    writers=$(docker ps -q --filter "volume=$uploads")
    [[ -z "$writers" ]] || { echo "Uploads volume is still mounted by a running container" >&2; exit 1; }
    idle_db() {
      [[ $(docker exec "$db" psql -X -At -v ON_ERROR_STOP=1 -U "$user" -d "$database" -c         'SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()') == 0 ]]
    }
    idle_db || { echo "Other sessions can still write the database" >&2; exit 1; }
    umask 077
    tmp=$(mktemp -d "${output}.partial.XXXXXXXX")
    trap 'rm -rf -- "$tmp"' EXIT
    docker exec "$db" pg_dump -Fc -U "$user" "$database" > "$tmp/database.dump"
    docker exec -i "$db" pg_restore --list < "$tmp/database.dump" > /dev/null
    docker run --rm --network none --mount "type=volume,source=$uploads,target=/uploads,readonly"       --entrypoint tar postgres:16-alpine -C /uploads -cf - . > "$tmp/uploads.tar"
    isolated_db && idle_db || { echo "Database admission reopened during capture" >&2; exit 1; }
    writers=$(docker ps -q --filter "volume=$uploads")
    [[ -z "$writers" ]]
    (cd "$tmp" && sha256sum database.dump uploads.tar > SHA256SUMS)
    verify "$tmp"
    sync -f "$tmp"
    mv -T -- "$tmp" "$output"
    sync -f "$output"
    ;;
  *)
    echo "Usage: $0 capture DB_CONTAINER DB_USER DB_NAME UPLOAD_VOLUME OUTPUT_DIRECTORY | verify BUNDLE" >&2
    exit 2
    ;;
esac
