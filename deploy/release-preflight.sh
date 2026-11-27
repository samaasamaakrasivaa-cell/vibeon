#!/usr/bin/env bash
# Read-only observation for CD-01. Never source .env or print raw Docker output.
set -euo pipefail
if ! command -v python3 >/dev/null 2>&1; then
  printf '%s\n' '{"schema_version":1,"status":"blocked","blockers":["python3_unavailable"]}'
  exit 1
fi
python3 - <<'PREFLIGHT_PY'
import json
import re
import shutil
import subprocess
import sys

# Select topology fields only: no environment, log, host path, IP or credentials.
INSPECT = r'''{"id":{{json .Id}},"image":{{json .Image}},"image_ref":{{json .Config.Image}},"project":{{if .Config.Labels}}{{json (index .Config.Labels "com.docker.compose.project")}}{{else}}null{{end}},"service":{{if .Config.Labels}}{{json (index .Config.Labels "com.docker.compose.service")}}{{else}}null{{end}},"revision":{{if .Config.Labels}}{{json (index .Config.Labels "org.opencontainers.image.revision")}}{{else}}null{{end}},"mounts":[{{range .Mounts}}{"type":{{json .Type}},"name":{{json (index . "Name")}},"destination":{{json .Destination}},"rw":{{json .RW}}},{{end}}null],"networks":[{{range $k,$v := .NetworkSettings.Networks}}{{json $k}},{{end}}null],"published_ports":[{{range $k,$v := .HostConfig.PortBindings}}{{if $v}}{{json $k}},{{end}}{{end}}null]}'''
HEALTH = "fetch('http://127.0.0.1:3000/api/health',{signal:AbortSignal.timeout(8000)}).then(async r=>{const j=await r.json();console.log(JSON.stringify({ok:r.ok&&j.ok===true,version:j.version}))}).catch(()=>process.exit(1))"
ID = re.compile(r"[0-9a-f]{64}\Z")
SHA = re.compile(r"[0-9a-f]{40}\Z")
IMAGE = re.compile(r"sha256:[0-9a-f]{64}\Z")


def run(*args):
    # stderr can include configuration/secrets. It is never forwarded, even on failure.
    result = subprocess.run(args, capture_output=True, text=True, timeout=30, check=False)
    if result.returncode or len(result.stdout) > 8 * 1024 * 1024:
        raise RuntimeError("command_failed")
    return result.stdout


def revision(value):
    return value if isinstance(value, str) and SHA.fullmatch(value) else "unlabelled"


def expected_volume(container, destination, name):
    mounts = [m for m in container["mounts"] if m and m.get("destination") == destination]
    return len(mounts) == 1 and mounts[0] == {
        "type": "volume", "name": name, "destination": destination, "rw": True
    }


def collect():
    report = {"schema_version": 1, "status": "blocked", "read_only": True,
              "checks": {}, "blockers": []}
    checks, blockers = report["checks"], report["blockers"]
    for name in ("docker", "flock", "tar", "gzip", "sha256sum"):
        checks[name + "_available"] = shutil.which(name) is not None
    if not checks["docker_available"]:
        blockers.append("docker_unavailable")
        return report
    try:
        run("docker", "compose", "version", "--short")
        checks["compose_available"] = True
    except Exception:
        checks["compose_available"] = False
        blockers.append("compose_unavailable")
    observation_stage = "container_inventory_failed"
    try:
        ids = run("docker", "ps", "--quiet", "--no-trunc").split()
        if not ids or any(not ID.fullmatch(item) for item in ids):
            raise ValueError("invalid_container_inventory")
        observation_stage = "container_inspection_failed"
        inspected = run("docker", "inspect", "--type", "container", "--format", INSPECT, *ids)
        observation_stage = "container_metadata_invalid"
        containers = [json.loads(line) for line in inspected.splitlines()]
        if len(containers) != len(ids) or {c["id"] for c in containers} != set(ids):
            raise ValueError("inventory_changed")
        apps = [c for c in containers if c["project"] == "vibeon" and c["service"] == "app"]
        dbs = [c for c in containers if c["project"] == "vibeon" and c["service"] == "db"]
        checks.update(app_replicas=len(apps), db_replicas=len(dbs))
        if len(apps) != 1 or len(dbs) != 1:
            blockers.append("expected_single_app_and_db")
            return report
        app, db = apps[0], dbs[0]
        checks["app_image_id"] = app["image"] if IMAGE.fullmatch(app["image"]) else "unknown"
        checks["app_revision"] = revision(app["revision"])
        checks["db_family"] = "postgres:16" if re.fullmatch(r"(?:docker\.io/library/)?postgres:16(?:-alpine)?(?:@sha256:[0-9a-f]{64})?", db["image_ref"]) else "unsupported"
        checks["db_ports_published"] = any(db["published_ports"])
        checks["expected_uploads_volume"] = expected_volume(app, "/app/uploads", "vibeon_uploads")
        checks["expected_db_volume"] = expected_volume(db, "/var/lib/postgresql/data", "vibeon_pgdata")
        app_networks = set(filter(None, app["networks"]))
        db_networks = set(filter(None, db["networks"]))
        checks["expected_networks"] = app_networks == db_networks == {"vibeon_vibeon"}
        peers = [c for c in containers if c["id"] not in {app["id"], db["id"]}]
        checks["unknown_db_network_peers"] = sum(
            bool(db_networks & set(filter(None, c["networks"])))
            and not (c["project"] == "vibeon" and c["service"] in {"backup", "caddy"}) for c in peers)
        checks["other_uploads_users"] = sum(
            any(m and m.get("type") == "volume" and m.get("name") == "vibeon_uploads" for m in c["mounts"])
            for c in containers if c["id"] != app["id"])
        if checks["app_image_id"] == "unknown":
            blockers.append("invalid_image_identity")
        for key in ("expected_uploads_volume", "expected_db_volume", "expected_networks"):
            if not checks[key]:
                blockers.append(key + "_mismatch")
        for key in ("db_ports_published", "unknown_db_network_peers", "other_uploads_users"):
            if checks[key]:
                blockers.append(key)
        if checks["db_family"] == "unsupported":
            blockers.append("unsupported_database_image")
        try:
            health = json.loads(run("docker", "exec", app["id"], "node", "-e", HEALTH))
            checks["health_ok"] = health.get("ok") is True
            checks["health_version"] = "dev" if health.get("version") == "dev" else revision(health.get("version"))
        except Exception:
            checks["health_ok"] = False
        if not checks["health_ok"]:
            blockers.append("health_unavailable")
    except Exception:
        blockers.append(observation_stage)
    try:
        checks["backup_filesystem_free_bytes"] = shutil.disk_usage("/opt/vibeon/deploy").free
    except OSError:
        blockers.append("deployment_directory_unavailable")
    # Observation is not release admission: no backup/restore/role scenario was tested.
    report["status"] = "observed" if not blockers else "blocked"
    return report


if __name__ == "__main__":
    try:
        report = collect()
    except Exception:
        report = {"schema_version": 1, "status": "blocked", "read_only": True,
                  "blockers": ["preflight_failed"]}
    print(json.dumps(report, sort_keys=True, separators=(",", ":")))
    sys.exit(0 if report["status"] == "observed" else 1)
PREFLIGHT_PY
