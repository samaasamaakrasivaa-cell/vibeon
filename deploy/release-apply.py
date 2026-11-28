#!/usr/bin/env python3
"""CD-01 app-only release executor. Run on the server; never export its backups.

Supports only the reviewed, single-app VibeOn Compose topology and releases with
identical migration histories. All subprocess output is private unless a fixed
allowlisted summary explicitly includes it. This script never restores live DBs.
"""
import argparse
import contextlib
import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import time
import urllib.request
import uuid

SHA = re.compile(r"[0-9a-f]{40}\Z")
DIGEST = re.compile(r"sha256:[0-9a-f]{64}\Z")
HEX = re.compile(r"[0-9a-f]{64}\Z")
MIGRATION = re.compile(r"[0-9]{14}_[a-zA-Z0-9_]+\Z")
ROOT = Path("/opt/vibeon/deploy")
INSPECT = r'''{"id":{{json .Id}},"image":{{json .Image}},"image_ref":{{json .Config.Image}},"project":{{with (index .Config "Labels")}}{{json (index . "com.docker.compose.project")}}{{else}}null{{end}},"service":{{with (index .Config "Labels")}}{{json (index . "com.docker.compose.service")}}{{else}}null{{end}},"mounts":[{{range (index . "Mounts")}}{"type":{{json .Type}},"name":{{json (index . "Name")}},"destination":{{json .Destination}},"rw":{{json .RW}}},{{end}}null],"networks":[{{range $k,$v := (index .NetworkSettings "Networks")}}{{json $k}},{{end}}null],"published_ports":[{{range $k,$v := (index .HostConfig "PortBindings")}}{{if $v}}{{json $k}},{{end}}{{end}}null]}'''
IMAGE_REVISION = '{{with (index .Config "Labels")}}{{json (index . "org.opencontainers.image.revision")}}{{else}}null{{end}}'
VOLUME_INFO = '{"driver":{{json .Driver}},"scope":{{json .Scope}},"custom_options":{{if (index . "Options")}}true{{else}}false{{end}}}'
MIGRATION_JS = r'''const fs=require('fs'),c=require('crypto');const p='/app/prisma/migrations';const m=fs.readdirSync(p,{withFileTypes:true}).filter(x=>x.isDirectory()).sort((a,b)=>a.name.localeCompare(b.name)).map(x=>({name:x.name,checksum:c.createHash('sha256').update(fs.readFileSync(p+'/'+x.name+'/migration.sql')).digest('hex')}));console.log(JSON.stringify({migrations:m,schema_sha256:c.createHash('sha256').update(fs.readFileSync('/app/prisma/schema.prisma')).digest('hex')}));'''
FILES_JS = r'''const fs=require('fs'),c=require('crypto');const h=c.createHash('sha256');let count=0,bytes=0;function walk(p,r){for(const n of fs.readdirSync(p).sort()){const q=p+'/'+n,s=fs.lstatSync(q),k=r+'/'+n;if(s.isSymbolicLink())throw Error('unsupported');if(s.isDirectory()){h.update('D\0'+k+'\0');walk(q,k)}else if(s.isFile()){const f=c.createHash('sha256'),b=Buffer.alloc(65536),fd=fs.openSync(q,'r');let z;while((z=fs.readSync(fd,b,0,b.length,null))>0)f.update(b.subarray(0,z));fs.closeSync(fd);h.update('F\0'+k+'\0'+f.digest('hex')+'\0');count++;bytes+=s.size}else throw Error('unsupported')}}walk('/files','');console.log(JSON.stringify({sha256:h.digest('hex'),count,bytes}));'''
HEALTH_JS = "fetch('http://127.0.0.1:3000/api/health',{signal:AbortSignal.timeout(5000)}).then(async r=>{const j=await r.json();console.log(JSON.stringify({ok:r.ok&&j.ok===true,version:j.version}))}).catch(()=>process.exit(1))"
MIGRATION_SQL = '''SELECT COALESCE(json_agg(json_build_object('name', migration_name, 'checksum', checksum, 'finished', finished_at IS NOT NULL, 'rolled_back', rolled_back_at IS NOT NULL)), '[]'::json) FROM "_prisma_migrations";'''


class ReleaseError(Exception):
    """The code is a constant chosen here, never raw subprocess or data text."""


def command(args, *, reason, stdin=None, stdout=None, timeout=120, env=None):
    try:
        result = subprocess.run(args, stdin=stdin, stdout=stdout if stdout is not None else subprocess.PIPE,
                                stderr=subprocess.PIPE, timeout=timeout, check=False, env=env)
    except (OSError, subprocess.TimeoutExpired):
        raise ReleaseError(reason) from None
    if result.returncode:
        raise ReleaseError(reason)
    return result.stdout or b""


def json_command(args, *, reason, timeout=120, env=None):
    try:
        return json.loads(command(args, reason=reason, timeout=timeout, env=env))
    except (ValueError, TypeError):
        raise ReleaseError(reason) from None


def migration_map(rows, *, live=False):
    if not isinstance(rows, list) or not rows:
        raise ReleaseError("migration_metadata_invalid")
    mapping = {}
    for row in rows:
        if not isinstance(row, dict) or not MIGRATION.fullmatch(str(row.get("name", ""))) or not HEX.fullmatch(str(row.get("checksum", ""))):
            raise ReleaseError("migration_metadata_invalid")
        if row["name"] in mapping:
            raise ReleaseError("migration_history_duplicate")
        if live and (row.get("finished") is not True or row.get("rolled_back") is not False):
            raise ReleaseError("migration_history_unfinished")
        mapping[row["name"]] = row["checksum"]
    return mapping


def atomic_write(path, value):
    temporary = path.with_name(path.name + ".new")
    with open(temporary, "w", encoding="utf-8", opener=lambda p, flags: os.open(p, flags, 0o600)) as handle:
        handle.write(value)
        handle.flush()
        os.fsync(handle.fileno())
    os.chmod(temporary, 0o600)
    os.replace(temporary, path)
    fd = os.open(path.parent, os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def atomic_json(path, value):
    atomic_write(path, json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n")


def file_sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, newurl):
        return None


def public_health(sha):
    # Fixed public endpoint. Do not accept an arbitrary URL or print the response.
    try:
        opener = urllib.request.build_opener(NoRedirect)
        request = urllib.request.Request("https://vibeon.online/api/health", headers={"Cache-Control": "no-cache"})
        with opener.open(request, timeout=8) as response:
            data = json.loads(response.read(65537))
            return response.status == 200 and data.get("ok") is True and (sha is None or data.get("version") == sha)
    except Exception:
        return False


@contextlib.contextmanager
def release_lock(root):
    # Same inode must also be used by other server mutation entry points.
    fd = os.open(root / ".release.lock", os.O_CREAT | os.O_RDWR, 0o600)
    try:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise ReleaseError("release_already_running") from None
        yield
    finally:
        os.close(fd)


@contextlib.contextmanager
def recovery_signals():
    # Recovery must finish even when termination first arrives after an ordinary
    # error. Restore handlers for in-process callers and subsequent test cases.
    previous = {}
    try:
        for sig in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
            previous[sig] = signal.getsignal(sig)
            signal.signal(sig, signal.SIG_IGN)
        yield
    finally:
        for sig, handler in previous.items():
            signal.signal(sig, handler)


def volume_is(container, destination, name):
    mounts = [m for m in container["mounts"] if m and m.get("destination") == destination]
    return len(mounts) == 1 and mounts[0] == {"type": "volume", "name": name, "destination": destination, "rw": True}


class Release:
    def __init__(self, sha, image, rollback_sha, rollback_image, compose_sha256, expected_current_image, root=ROOT, allowed_proxy_image=None, retention_enabled=False):
        if not SHA.fullmatch(sha) or not SHA.fullmatch(rollback_sha) or not DIGEST.fullmatch(image) or not DIGEST.fullmatch(rollback_image) or not HEX.fullmatch(compose_sha256) or not DIGEST.fullmatch(expected_current_image):
            raise ReleaseError("invalid_release_identity")
        if allowed_proxy_image is not None and not DIGEST.fullmatch(allowed_proxy_image):
            raise ReleaseError("invalid_proxy_identity")
        self.sha, self.image = sha, image
        self.rollback_sha, self.rollback_image = rollback_sha, rollback_image
        self.compose_sha256, self.root = compose_sha256, Path(root)
        self.expected_current_image = expected_current_image
        self.allowed_proxy_image = allowed_proxy_image
        self.proxy_qualification = None
        self.retention_enabled = retention_enabled
        self.override = self.root / "release-image.json"
        self.journal = self.root / "release-state.json"
        self.backup_dir = None
        self.stopped = self.cutover = False
        self.restore_container = self.restore_db_volume = self.restore_uploads_volume = None

    def compose(self, *args):
        command_args = ["docker", "compose", "--project-name", "vibeon", "--env-file", str(self.root / ".env"), "-f", str(self.root / "docker-compose.prod.yml")]
        if self.override.exists():
            command_args += ["-f", str(self.override)]
        return command_args + list(args)

    def config_fingerprint(self):
        return {name: hashlib.sha256((self.root / name).read_bytes()).hexdigest()
                for name in ("docker-compose.prod.yml", ".env")}

    def state(self, status):
        atomic_json(self.journal, {"schema_version": 1, "status": status, "sha": self.sha,
                    "image": self.image, "rollback_sha": self.rollback_sha,
                    "rollback_image": self.rollback_image, "previous_image": self.current_image})

    def inspect(self):
        try:
            if self.allowed_proxy_image is not None:
                self.proxy_qualification = self.qualify_proxy()
            if self.journal.exists() and json.loads(self.journal.read_text())["status"] in {"stopping", "stopped", "verifying", "switching", "rollback_failed", "cleanup_failed"}:
                raise ReleaseError("interrupted_release_requires_recovery")
            self.config_before = self.config_fingerprint()
            if self.config_before["docker-compose.prod.yml"] != self.compose_sha256:
                raise ReleaseError("compose_contract_mismatch")
            if self.override.exists():
                existing = json.loads(self.override.read_text())
                app = existing["services"]["app"]
                if existing != self.override_content(app["image"], app["environment"]["APP_VERSION"]) or not DIGEST.fullmatch(app["image"]) or not SHA.fullmatch(app["environment"]["APP_VERSION"]):
                    raise ReleaseError("unknown_release_override")
            raw_ids = command(["docker", "ps", "--quiet", "--no-trunc"], reason="container_inventory_unavailable").decode().split()
            if not raw_ids or any(not HEX.fullmatch(i) for i in raw_ids):
                raise ReleaseError("container_inventory_invalid")
            rows = command(["docker", "inspect", "--type", "container", "--format", INSPECT, *raw_ids], reason="topology_unavailable").splitlines()
            containers = [json.loads(row) for row in rows]
            if {c["id"] for c in containers} != set(raw_ids):
                raise ReleaseError("container_inventory_changed")
            apps = [c for c in containers if c["project"] == "vibeon" and c["service"] == "app"]
            dbs = [c for c in containers if c["project"] == "vibeon" and c["service"] == "db"]
            if len(apps) != 1 or len(dbs) != 1:
                raise ReleaseError("unsupported_replica_count")
            app, db = apps[0], dbs[0]
            if not volume_is(app, "/app/uploads", "vibeon_uploads") or not volume_is(db, "/var/lib/postgresql/data", "vibeon_pgdata"):
                raise ReleaseError("unsupported_volume_topology")
            if any(len([m for m in c["mounts"] if m]) != 1 for c in (app, db)):
                raise ReleaseError("additional_application_or_database_mounts")
            volume_rows = command(["docker", "volume", "inspect", "--format", VOLUME_INFO, "vibeon_uploads", "vibeon_pgdata"], reason="volume_driver_unavailable").splitlines()
            if len(volume_rows) != 2 or any(json.loads(row) != {"driver": "local", "scope": "local", "custom_options": False} for row in volume_rows):
                raise ReleaseError("nonlocal_or_custom_volume_driver")
            if set(filter(None, app["networks"])) != {"vibeon_vibeon"} or set(filter(None, db["networks"])) != {"vibeon_vibeon"} or any(db["published_ports"]):
                raise ReleaseError("unsupported_database_network")
            qualified_proxy_ids = []
            for item in containers:
                if item["id"] not in {app["id"], db["id"]} and "vibeon_vibeon" in item["networks"] and not (item["project"] == "vibeon" and item["service"] in {"backup", "caddy"}):
                    if self.allowed_proxy_image is not None and item["image"] == self.allowed_proxy_image:
                        qualified_proxy_ids.append(item["id"])
                    else:
                        raise ReleaseError("unknown_database_peer")
                if item["id"] != app["id"] and any(m and m.get("name") == "vibeon_uploads" for m in item["mounts"]):
                    raise ReleaseError("unknown_uploads_user")
                if item["id"] != db["id"] and any(m and m.get("name") == "vibeon_pgdata" for m in item["mounts"]):
                    raise ReleaseError("unknown_database_volume_user")
            self.bind_proxy_ids(qualified_proxy_ids)
            if not re.fullmatch(r"(?:docker\.io/library/)?postgres:16(?:-alpine)?(?:@sha256:[0-9a-f]{64})?", db["image_ref"]):
                raise ReleaseError("unsupported_database_image")
            self.app_id, self.db_id, self.current_image, self.db_image = app["id"], db["id"], app["image"], db["image"]
            if not DIGEST.fullmatch(self.current_image) or not DIGEST.fullmatch(self.db_image):
                raise ReleaseError("invalid_running_image")
            if self.current_image != self.expected_current_image:
                raise ReleaseError("unexpected_current_image")
        except ReleaseError:
            raise
        except Exception:
            raise ReleaseError("server_configuration_invalid") from None
        for image, sha in ((self.image, self.sha), (self.rollback_image, self.rollback_sha)):
            if json_command(["docker", "image", "inspect", "--format", IMAGE_REVISION, image], reason="release_image_unavailable") != sha:
                raise ReleaseError("release_image_revision_mismatch")
        self.migrations = self.live_migrations(self.db_id)
        schema_digests = set()
        for image in {self.image, self.rollback_image, self.current_image}:
            metadata = json_command(self.helper(image, "node") + ["-e", MIGRATION_JS], reason="image_migration_metadata_unavailable")
            if not isinstance(metadata, dict) or not HEX.fullmatch(str(metadata.get("schema_sha256", ""))):
                raise ReleaseError("image_schema_metadata_invalid")
            schema_digests.add(metadata["schema_sha256"])
            if migration_map(metadata.get("migrations")) != self.migrations:
                raise ReleaseError("migration_set_mismatch")
        if len(schema_digests) != 1:
            raise ReleaseError("schema_change_requires_separate_release")
        self.verify(self.app_id, self.current_image, None)

    def qualify_proxy(self):
        report = json_command(["bash", str(Path(__file__).with_name("release-preflight.sh"))],
                              reason="proxy_preflight_failed", timeout=180,
                              env={**os.environ, "VIBEON_EXPECTED_PROXY_IMAGE": self.allowed_proxy_image})
        if not isinstance(report, dict) or report.get("status") != "observed":
            raise ReleaseError("proxy_preflight_blocked")
        checks = report.get("checks", {})
        if not isinstance(checks, dict) or checks.get("app_image_id") != self.expected_current_image:
            raise ReleaseError("proxy_preflight_current_image_changed")
        count = checks.get("trusted_proxy_count")
        fingerprint = checks.get("trusted_proxy_ids_sha256")
        if type(count) is not int or count < 0 or not isinstance(fingerprint, str) or not HEX.fullmatch(fingerprint):
            raise ReleaseError("proxy_preflight_identity_unavailable")
        return count, fingerprint

    def bind_proxy_ids(self, ids):
        if self.allowed_proxy_image is not None:
            fingerprint = hashlib.sha256("\n".join(sorted(ids)).encode("ascii")).hexdigest()
            if self.proxy_qualification != (len(ids), fingerprint):
                raise ReleaseError("proxy_preflight_identity_changed")

    def helper(self, image, entrypoint, *mounts):
        args = ["docker", "run", "--rm", "--pull", "never", "--network", "none", "--read-only", "--memory", "512m", "--pids-limit", "128", "--cpus", "0.5", "--security-opt", "no-new-privileges", "--entrypoint", entrypoint]
        for mount in mounts:
            args += ["--mount", mount]
        return args + [image]

    def live_migrations(self, container):
        rows = json_command(["docker", "exec", "-e", "PGOPTIONS=-c default_transaction_read_only=on", container, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", "vibeon", "-d", "vibeon", "-Atqc", MIGRATION_SQL], reason="database_migration_metadata_unavailable")
        return migration_map(rows, live=True)

    def files_manifest(self, volume):
        data = json_command(self.helper(self.image, "node", "type=volume,source=" + volume + ",target=/files,readonly") + ["-e", FILES_JS], reason="uploads_manifest_failed")
        if not isinstance(data, dict) or not HEX.fullmatch(str(data.get("sha256", ""))) or type(data.get("count")) is not int or type(data.get("bytes")) is not int or min(data["count"], data["bytes"]) < 0:
            raise ReleaseError("uploads_manifest_invalid")
        return data

    def retain(self):
        for image in {self.current_image, self.image, self.rollback_image}:
            command(["docker", "image", "tag", image, "vibeon-retained:" + image.replace(":", "-")], reason="image_retention_failed")

    def stop(self):
        self.state("stopping")
        self.stopped = True  # A timed-out docker client may already have stopped it.
        command(["docker", "stop", "--time", "30", self.app_id], reason="app_stop_failed", timeout=45)
        self.state("stopped")

    def backup(self):
        nonce = uuid.uuid4().hex
        self.backup_dir = self.root / "backups" / "releases" / (datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + self.sha[:12] + "-" + nonce[:8])
        self.backup_dir.mkdir(parents=True, mode=0o700)
        os.chmod(self.backup_dir, 0o700)
        for name in ("docker-compose.prod.yml", ".env", "release-image.json"):
            source = self.root / name
            if source.exists():
                shutil.copyfile(source, self.backup_dir / name)
                os.chmod(self.backup_dir / name, 0o600)
        # No outside client may still write while the app and its background jobs are stopped.
        peers = command(["docker", "exec", self.db_id, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", "vibeon", "-d", "vibeon", "-Atqc", "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND backend_type='client backend' AND pid<>pg_backend_pid();"], reason="database_writers_check_failed").strip()
        if peers != b"0":
            raise ReleaseError("database_clients_still_connected")
        source_files = self.files_manifest("vibeon_uploads")
        db_bytes = command(["docker", "exec", self.db_id, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", "vibeon", "-d", "vibeon", "-Atqc", "SELECT pg_database_size(current_database());"], reason="database_size_unavailable").strip()
        if not db_bytes.isdigit():
            raise ReleaseError("database_size_invalid")
        needed = 2 * int(db_bytes) + 3 * source_files["bytes"] + 512 * 1024 * 1024
        docker_root = command(["docker", "info", "--format", "{{.DockerRootDir}}"], reason="docker_storage_unavailable").decode().strip()
        if not docker_root.startswith("/") or min(shutil.disk_usage(self.backup_dir).free, shutil.disk_usage(docker_root).free) < needed:
            raise ReleaseError("insufficient_backup_space")
        dump = self.backup_dir / "database.dump"
        with open(dump, "wb", opener=lambda p, flags: os.open(p, flags, 0o600)) as target:
            command(["docker", "exec", self.db_id, "pg_dump", "-U", "vibeon", "-d", "vibeon", "--format=custom", "--no-owner", "--no-privileges"], reason="database_backup_failed", stdout=target, timeout=300)
        bind = "type=bind,source=" + str(self.backup_dir) + ",target=/backup"
        command(self.helper(self.db_image, "tar", "type=volume,source=vibeon_uploads,target=/files,readonly", bind) + ["-czf", "/backup/uploads.tar.gz", "-C", "/files", "."], reason="uploads_backup_failed", timeout=300)
        os.chmod(self.backup_dir / "uploads.tar.gz", 0o600)
        # The consistent snapshot is complete. Serve users during the isolated
        # restore rehearsal; later rollback always keeps the current live volumes.
        self.resume_original()
        self.stopped = False
        self.state("verifying")
        self.restore_container = "vibeon-restore-" + nonce
        self.restore_db_volume = self.restore_container + "-db"
        self.restore_uploads_volume = self.restore_container + "-uploads"
        try:
            for volume in (self.restore_db_volume, self.restore_uploads_volume):
                command(["docker", "volume", "create", volume], reason="restore_volume_failed")
            command(["docker", "run", "-d", "--pull", "never", "--name", self.restore_container, "--network", "none", "--memory", "512m", "--pids-limit", "128", "--cpus", "0.5", "--mount", "type=volume,source=" + self.restore_db_volume + ",target=/var/lib/postgresql/data", "-e", "POSTGRES_USER=vibeon", "-e", "POSTGRES_DB=vibeon", "-e", "POSTGRES_HOST_AUTH_METHOD=trust", self.db_image], reason="restore_database_start_failed")
            for attempt in range(30):
                try:
                    command(["docker", "exec", self.restore_container, "pg_isready", "-h", "127.0.0.1", "-U", "vibeon", "-d", "vibeon"], reason="restore_database_not_ready", timeout=5)
                    break
                except ReleaseError:
                    if attempt == 29:
                        raise
                    time.sleep(1)
            with open(dump, "rb") as source:
                command(["docker", "exec", "-i", self.restore_container, "pg_restore", "--exit-on-error", "--no-owner", "--no-privileges", "-U", "vibeon", "-d", "vibeon"], reason="database_restore_verification_failed", stdin=source, timeout=300)
            if self.live_migrations(self.restore_container) != self.migrations:
                raise ReleaseError("restored_migration_metadata_mismatch")
            command(self.helper(self.db_image, "tar", bind + ",readonly", "type=volume,source=" + self.restore_uploads_volume + ",target=/files") + ["-xzf", "/backup/uploads.tar.gz", "-C", "/files"], reason="uploads_restore_verification_failed", timeout=300)
            if self.files_manifest(self.restore_uploads_volume) != source_files:
                raise ReleaseError("uploads_restore_content_mismatch")
        finally:
            self.cleanup_restore()
        atomic_json(self.backup_dir / "verified.json", {"schema_version": 1, "sha": self.sha,
                    "image": self.image, "rollback_image": self.rollback_image, "previous_image": self.current_image,
                    "uploads_sha256": source_files["sha256"],
                    "database_dump_sha256": file_sha256(dump),
                    "uploads_archive_sha256": file_sha256(self.backup_dir / "uploads.tar.gz")})

    def cleanup_restore(self):
        failed = False
        if self.restore_container:
            try:
                command(["docker", "rm", "--force", self.restore_container], reason="restore_cleanup_failed")
            except ReleaseError:
                failed = True
        for volume in (self.restore_db_volume, self.restore_uploads_volume):
            if volume:
                try:
                    command(["docker", "volume", "rm", volume], reason="restore_cleanup_failed")
                except ReleaseError:
                    failed = True
        if failed:
            raise ReleaseError("restore_cleanup_failed")

    @staticmethod
    def override_content(image, sha):
        return {"services": {"app": {"image": image, "entrypoint": ["node"], "command": ["server.js"], "environment": {"APP_VERSION": sha}}}}

    def switch(self, image, sha):
        atomic_json(self.override, self.override_content(image, sha))
        command(self.compose("up", "-d", "--no-deps", "--no-build", "--pull", "never", "--force-recreate", "--timeout", "30", "app"), reason="app_switch_failed", timeout=90)
        app_id = command(self.compose("ps", "--quiet", "app"), reason="app_identity_unavailable").decode().strip()
        if not HEX.fullmatch(app_id):
            raise ReleaseError("app_identity_invalid")
        self.verify(app_id, image, sha)
        atomic_write(self.root.parent / "REVISION", sha + "\n")

    def verify(self, app_id, image, sha):
        if command(["docker", "inspect", "--type", "container", "--format", "{{.Image}}", app_id], reason="running_image_unavailable").decode().strip() != image:
            raise ReleaseError("running_image_mismatch")
        for attempt in range(30):
            try:
                data = json_command(["docker", "exec", app_id, "node", "-e", HEALTH_JS], reason="app_health_failed", timeout=8)
                if data.get("ok") is True and (sha is None or data.get("version") == sha) and public_health(sha):
                    return
            except ReleaseError:
                pass
            if attempt != 29:
                time.sleep(2)
        raise ReleaseError("app_health_failed")

    def resume_original(self):
        command(["docker", "start", self.app_id], reason="original_app_restart_failed", timeout=60)
        self.verify(self.app_id, self.current_image, None)

    def post_publication_retention(self, protected=()):
        from release_retention import rotate

        def docker(*args):
            return command(["docker", *args], reason="storage_inventory_failed").decode().strip()

        return rotate(self.root, self.image, self.sha, {self.current_image, self.rollback_image, *protected},
                      docker=docker, write_json=atomic_json)

    def retention_report(self, status, protected=()):
        report = {"status": status, "sha": self.sha, "image": self.image}
        if self.retention_enabled:
            try:
                report["storage_retention"] = self.post_publication_retention(protected)
            except (Exception, KeyboardInterrupt):
                report["storage_retention"] = {"status": "attention", "images_removed": 0,
                                               "verified_full_backups": 0, "full_backup_candidates": 0,
                                               "full_backup_candidate_bytes": 0,
                                               "full_backups_removed": 0, "full_backups_removed_bytes": 0}
        return report

    def maintain_storage(self):
        with release_lock(self.root):
            if self.image != self.expected_current_image or self.rollback_image != self.image or self.rollback_sha != self.sha:
                raise ReleaseError("storage_only_identity_invalid")
            try:
                if self.journal.is_symlink() or self.override.is_symlink():
                    raise ValueError()
                journal = json.loads(self.journal.read_text())
                override = json.loads(self.override.read_text())
                if (journal.get("schema_version") != 1 or journal.get("status") != "released"
                        or journal.get("sha") != self.sha or journal.get("image") != self.image
                        or override != self.override_content(self.image, self.sha)):
                    raise ValueError()
                protected = {journal["rollback_image"], journal["previous_image"]}
                if (not all(isinstance(image, str) and DIGEST.fullmatch(image) for image in protected)
                        or not isinstance(journal["rollback_sha"], str) or not SHA.fullmatch(journal["rollback_sha"])):
                    raise ValueError()
            except (OSError, ValueError, KeyError, TypeError, AttributeError):
                raise ReleaseError("storage_only_identity_invalid") from None
            self.inspect()
            for image in protected:
                if command(["docker", "image", "inspect", "--format", "{{.Id}}", image],
                           reason="storage_only_identity_invalid").decode().strip() != image:
                    raise ReleaseError("storage_only_identity_invalid")
            if json_command(["docker", "image", "inspect", "--format", IMAGE_REVISION, journal["rollback_image"]],
                            reason="storage_only_identity_invalid") != journal["rollback_sha"]:
                raise ReleaseError("storage_only_identity_invalid")
            self.verify(self.app_id, self.image, self.sha)
            report = self.retention_report("storage_maintained", protected)
            self.verify(self.app_id, self.image, self.sha)
            return report

    def apply(self):
        with release_lock(self.root):
            self.inspect()
            self.retain()
            try:
                self.stop()
                self.backup()
                if self.config_fingerprint() != self.config_before or self.live_migrations(self.db_id) != self.migrations:
                    raise ReleaseError("configuration_changed_during_backup")
                self.verify(self.app_id, self.current_image, None)
                self.state("switching")
                self.cutover = True
                self.switch(self.image, self.sha)
                self.state("released")
            except (Exception, KeyboardInterrupt) as error:
                reason = str(error) if isinstance(error, ReleaseError) else "release_failed"
                with recovery_signals():
                    try:
                        if self.cutover:
                            self.switch(self.rollback_image, self.rollback_sha)
                            self.state("rolled_back")
                            return {"status": "rolled_back", "reason": reason, "sha": self.rollback_sha, "image": self.rollback_image}
                        if self.stopped:
                            self.resume_original()
                        self.state("cleanup_failed" if reason == "restore_cleanup_failed" else "unchanged")
                        return {"status": "unchanged", "reason": reason}
                    except BaseException:
                        self.state("rollback_failed")
                        raise ReleaseError("rollback_failed") from None

            return self.retention_report("released")


class SafeParser(argparse.ArgumentParser):
    def error(self, message):
        raise ReleaseError("invalid_arguments")


def main():
    parser = SafeParser(add_help=False)
    for name in ("sha", "image", "rollback-sha", "rollback-image", "compose-sha256", "expected-current-image"):
        parser.add_argument("--" + name, required=True)
    parser.add_argument("--allowed-proxy-image", default=None)
    parser.add_argument("--storage-only", action="store_true")
    def interrupted(_signum, _frame):
        # Once recovery begins, a repeated signal must not interrupt it again.
        for sig in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
            signal.signal(sig, signal.SIG_IGN)
        raise ReleaseError("release_interrupted")
    for sig in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
        signal.signal(sig, interrupted)
    try:
        options = vars(parser.parse_args())
        storage_only = options.pop("storage_only")
        release = Release(**options, retention_enabled=True)
        report = release.maintain_storage() if storage_only else release.apply()
    except ReleaseError as error:
        report = {"status": "blocked", "reason": str(error)}
    except BaseException:
        report = {"status": "blocked", "reason": "release_executor_failed"}
    print(json.dumps(report, sort_keys=True, separators=(",", ":")))
    return 0 if report["status"] in ("released", "storage_maintained") else 1


if __name__ == "__main__":
    sys.exit(main())
