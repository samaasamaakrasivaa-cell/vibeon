#!/usr/bin/env bash
# Read-only observation for CD-01. Never source .env or print raw Docker output.
set -euo pipefail
if ! command -v python3 >/dev/null 2>&1; then
  printf '%s\n' '{"schema_version":1,"status":"blocked","blockers":["python3_unavailable"]}'
  exit 1
fi
python3 - <<'PREFLIGHT_PY'
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys

# Select topology fields only: no environment, log, host path, IP or credentials.
INSPECT = r'''{{$labels := index .Config "Labels"}}{"id":{{json .Id}},"image":{{json .Image}},"image_ref":{{json .Config.Image}},"project":{{if $labels}}{{json (index $labels "com.docker.compose.project")}}{{else}}null{{end}},"service":{{if $labels}}{{json (index $labels "com.docker.compose.service")}}{{else}}null{{end}},"revision":{{if $labels}}{{json (index $labels "org.opencontainers.image.revision")}}{{else}}null{{end}},"mounts":[{{range .Mounts}}{"type":{{json .Type}},"name":{{json (index . "Name")}},"destination":{{json .Destination}},"rw":{{json .RW}}},{{end}}null],"networks":[{{range $k,$v := (index .NetworkSettings "Networks")}}{{json $k}},{{end}}null],"published_ports":[{{range $k,$v := (index .HostConfig "PortBindings")}}{{if $v}}{{json $k}},{{end}}{{end}}null],"exposed_ports":[{{range $k,$v := (index .Config "ExposedPorts")}}{{json $k}},{{end}}null]}'''
# Only unexpected peers receive this extra query. Docker reduces environment keys
# to a boolean on the server; no key names or values cross the output boundary.
PEER_ENV_INSPECT = r'''{{$labels := index .Config "Labels"}}{{$found := false}}{{range (index .Config "Env")}}{{$key := index (split . "=") 0}}{{if or (eq $key "DATABASE_URL") (eq $key "DIRECT_URL") (eq $key "DATABASE_PASSWORD") (eq $key "DATABASE_USER") (eq $key "DB_PASSWORD") (eq $key "DB_USER") (eq $key "DB_URL") (eq $key "DB_HOST") (eq $key "PGPASSWORD") (eq $key "PGUSER") (eq $key "PGHOST") (eq $key "POSTGRES_PASSWORD") (eq $key "POSTGRES_USER")}}{{$found = true}}{{end}}{{end}}{{json $found}}'''
PEER_CMD_INSPECT = r'''{{$entry := index .Config "Entrypoint"}}{{$cmd := index .Config "Cmd"}}{{$ok := false}}{{if $cmd}}{{if not $entry}}{{if ge (len $cmd) 2}}{{if and (eq (index $cmd 0) "caddy") (eq (index $cmd 1) "run")}}{{$ok = true}}{{end}}{{end}}{{else}}{{if and (eq (index $entry 0) "caddy") (eq (index $cmd 0) "run")}}{{$ok = true}}{{end}}{{end}}{{end}}{{json $ok}}'''
# Private input to the local predicate below; this JSON is never returned/logged.
PEER_MOUNTS_INSPECT = r'''[{{range .Mounts}}{"type":{{json .Type}},"name":{{json (index . "Name")}},"source":{{json .Source}},"destination":{{json .Destination}},"rw":{{json .RW}}},{{end}}null]'''
HEALTH = "fetch('http://127.0.0.1:3000/api/health',{signal:AbortSignal.timeout(8000)}).then(async r=>{const j=await r.json();console.log(JSON.stringify({ok:r.ok&&j.ok===true,version:j.version}))}).catch(()=>process.exit(1))"
ID = re.compile(r"[0-9a-f]{64}\Z")
SHA = re.compile(r"[0-9a-f]{40}\Z")
IMAGE = re.compile(r"sha256:[0-9a-f]{64}\Z")
OFFICIAL_FAMILY = re.compile(r"(?:(?:docker\.io/)?library/|docker\.io/)?(caddy|nginx|redis|postgres|node)(?::[A-Za-z0-9_][A-Za-z0-9_.-]*)?(?:@sha256:[0-9a-f]{64})?\Z")


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


def safe_mount_layout(mounts, docker_root):
    """Check private server paths in memory and return only a fixed boolean."""
    if not isinstance(mounts, list) or not isinstance(docker_root, str) or not docker_root.startswith("/"):
        return False
    try:
        protected = [Path(p).resolve() for p in ("/opt/vibeon", docker_root, "/dev", "/proc", "/sys", "/run", "/var/run")]
        destinations = set()
        for mount in mounts:
            if mount is None:
                continue
            if not isinstance(mount, dict) or not isinstance(mount.get("rw"), bool):
                return False
            destination = mount.get("destination")
            if destination in destinations:
                return False
            destinations.add(destination)
            if mount.get("type") == "volume":
                if destination not in {"/data", "/config"} or mount.get("name") in {"vibeon_pgdata", "vibeon_uploads"}:
                    return False
                if not isinstance(mount.get("name"), str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]*", mount["name"]):
                    return False
            elif mount.get("type") == "bind":
                if destination not in {"/etc/caddy", "/etc/caddy/Caddyfile"}:
                    return False
                source = mount.get("source")
                if not isinstance(source, str) or not source.startswith("/"):
                    return False
                resolved = Path(source).resolve(strict=True)
                if resolved == Path("/") or resolved.name.endswith(".sock") or resolved.is_socket():
                    return False
                if any(resolved == p or resolved in p.parents or p in resolved.parents for p in protected):
                    return False
            else:
                return False
        return True
    except (OSError, RuntimeError, TypeError, ValueError):
        return False


def peer_metadata(container):
    family = OFFICIAL_FAMILY.fullmatch(container.get("image_ref") or "")
    mounts = [m for m in container["mounts"] if m]
    ports = set(filter(None, container.get("exposed_ports", [])))
    result = {
        "family": family.group(1) if family else "other",
        "image_id": container["image"] if IMAGE.fullmatch(container["image"]) else "unknown",
        "compose_project": "same" if container["project"] == "vibeon" else ("other" if container["project"] else "none"),
        "shares_db_volume": any(m.get("type") == "volume" and m.get("name") == "vibeon_pgdata" for m in mounts),
        "shares_upload_volume": any(m.get("type") == "volume" and m.get("name") == "vibeon_uploads" for m in mounts),
        "bind_mount_count": sum(m.get("type") == "bind" for m in mounts),
        "exposed_ports": {"http": int("80/tcp" in ports), "https": len(ports & {"443/tcp", "443/udp"}),
                          "other": len(ports - {"80/tcp", "443/tcp", "443/udp"})},
        "has_db_credential_env_keys": None,
        "credential_env_check_available": False,
        "command_is_caddy_run": None,
        "safe_mount_layout": False,
        "mount_layout_check_available": False,
    }
    try:
        present = json.loads(run("docker", "inspect", "--type", "container", "--format", PEER_ENV_INSPECT, container["id"]))
        if not isinstance(present, bool):
            raise ValueError("invalid_boolean")
        result["has_db_credential_env_keys"] = present
        result["credential_env_check_available"] = True
    except Exception:
        pass  # Unknown remains unknown and the network-peer blocker stays active.
    try:
        command_is_caddy = json.loads(run("docker", "inspect", "--type", "container", "--format", PEER_CMD_INSPECT, container["id"]))
        if isinstance(command_is_caddy, bool):
            result["command_is_caddy_run"] = command_is_caddy
    except Exception:
        pass
    try:
        private_mounts = json.loads(run("docker", "inspect", "--type", "container", "--format", PEER_MOUNTS_INSPECT, container["id"]))
        docker_root = json.loads(run("docker", "info", "--format", "{{json .DockerRootDir}}"))
        result["safe_mount_layout"] = safe_mount_layout(private_mounts, docker_root)
        result["mount_layout_check_available"] = True
    except Exception:
        pass
    return result


def trusted_proxy(metadata, expected_image):
    return bool(expected_image and IMAGE.fullmatch(expected_image)
                and metadata["image_id"] == expected_image
                and metadata["family"] == "caddy"
                and metadata["command_is_caddy_run"] is True
                and metadata["credential_env_check_available"] is True
                and metadata["has_db_credential_env_keys"] is False
                and metadata["mount_layout_check_available"] is True
                and metadata["safe_mount_layout"] is True
                and metadata["shares_db_volume"] is False
                and metadata["shares_upload_volume"] is False)


def collect():
    report = {"schema_version": 1, "status": "blocked", "read_only": True,
              "checks": {}, "blockers": []}
    checks, blockers = report["checks"], report["blockers"]
    expected_proxy = os.environ.get("VIBEON_EXPECTED_PROXY_IMAGE", "")
    if expected_proxy and not IMAGE.fullmatch(expected_proxy):
        blockers.append("invalid_expected_proxy_image")
        return report
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
        unknown_peers = [c for c in peers
                         if db_networks & set(filter(None, c["networks"]))
                         and not (c["project"] == "vibeon" and c["service"] in {"backup", "caddy"})]
        unknown_metadata, trusted_ids = [], []
        for peer in unknown_peers:
            metadata = peer_metadata(peer)
            if trusted_proxy(metadata, expected_proxy):
                trusted_ids.append(peer["id"])
            else:
                unknown_metadata.append(metadata)
        checks["unknown_db_network_peers"] = len(unknown_metadata)
        checks["unknown_peer_metadata"] = unknown_metadata
        checks["trusted_proxy_count"] = len(trusted_ids)
        checks["trusted_proxy_ids_sha256"] = hashlib.sha256("\n".join(sorted(trusted_ids)).encode()).hexdigest()
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
