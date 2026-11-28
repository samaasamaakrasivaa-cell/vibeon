#!/usr/bin/env python3
"""Exercise the real executor on disposable, synthetic Docker fixtures only.

Requires a GitHub-hosted runner with no existing VibeOn objects. It never contacts
the public VibeOn site. Its tiny HTTP app tests delivery mechanics, not VibeOn UI.
"""
import contextlib
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
from unittest.mock import patch
import uuid

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "deploy"))
spec = importlib.util.spec_from_file_location("fixture_release", ROOT / "deploy/release-apply.py")
delivery = importlib.util.module_from_spec(spec)
spec.loader.exec_module(delivery)
INITIAL_SHA = "1" * 40
CANDIDATE_SHA = "2" * 40
BAD_SHA = "3" * 40


def run(args, *, data=None, check=True, timeout=300):
    result = subprocess.run(args, input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            timeout=timeout, check=False)
    if check and result.returncode:
        # Even fixture logs remain private to the runner; print only the stage.
        raise RuntimeError("fixture_command_failed")
    return result.stdout


def guard():
    if os.environ.get("GITHUB_ACTIONS") != "true" or os.environ.get("RUNNER_ENVIRONMENT") != "github-hosted" or os.environ.get("GITHUB_REPOSITORY") != "samaasamaakrasivaa-cell/vibeon":
        raise RuntimeError("isolated_github_runner_required")
    # The production executor runs as SSH root. Docker's PostgreSQL/tar helper
    # creates root-owned snapshot files on its bind mount; use the same UID here.
    if os.geteuid() != 0:
        raise RuntimeError("root_fixture_execution_required")
    if run(["docker", "ps", "--all", "--quiet", "--filter", "label=com.docker.compose.project=vibeon"]).strip():
        raise RuntimeError("existing_vibeon_containers")
    volumes = run(["docker", "volume", "ls", "--format", "{{.Name}}"]).decode().splitlines()
    networks = run(["docker", "network", "ls", "--format", "{{.Name}}"]).decode().splitlines()
    if any(name.startswith("vibeon_") for name in volumes) or "vibeon_vibeon" in networks:
        raise RuntimeError("existing_vibeon_storage_or_network")


@contextlib.contextmanager
def engine_diagnostics():
    """Keep unexpected CI failures useful without printing values or messages."""
    previous = sys.gettrace()
    seen = set()
    engine_path = str(ROOT / "deploy/release-apply.py")
    def trace(frame, event, argument):
        if event == "exception" and frame.f_code.co_filename == engine_path:
            kind, _value, _traceback = argument
            if not issubclass(kind, (delivery.ReleaseError, StopIteration)):
                name = kind.__name__ if kind.__name__.isidentifier() else "UnknownError"
                function = frame.f_code.co_name if frame.f_code.co_name.isidentifier() else "unknown"
                record = (name, function, frame.f_lineno)
                if record not in seen and len(seen) < 40:
                    seen.add(record)
                    print(json.dumps({"fixture_diagnostic": {"exception_class": name,
                                      "engine_function": function, "line": frame.f_lineno}}), flush=True)
        return trace
    sys.settrace(trace)
    try:
        yield
    finally:
        sys.settrace(previous)


def write_fixtures(context):
    migration = "CREATE TABLE fixture_answers (id integer PRIMARY KEY, answer text NOT NULL);\n"
    migrations = context / "prisma/migrations/20261103194346_init"
    migrations.mkdir(parents=True)
    (migrations / "migration.sql").write_text(migration)
    (context / "prisma/schema.prisma").write_text('datasource db {\n provider = "postgresql"\n url = env("DATABASE_URL")\n}\n')
    (context / "server.js").write_text("const http=require('http');http.createServer((q,s)=>{const ok=process.env.FIXTURE_BAD!=='1';s.writeHead(ok?200:503,{'Content-Type':'application/json'});s.end(JSON.stringify({ok,version:process.env.APP_VERSION}));}).listen(3000,'0.0.0.0');\n")
    (context / "Dockerfile").write_text("""FROM node:22-bookworm-slim
ARG REVISION
ARG FIXTURE_BAD=0
ENV APP_VERSION=$REVISION FIXTURE_BAD=$FIXTURE_BAD
LABEL org.opencontainers.image.revision=$REVISION
WORKDIR /app
COPY server.js ./server.js
COPY prisma ./prisma
RUN mkdir -p /app/uploads && chown node:node /app/uploads
USER node
ENTRYPOINT ["node"]
CMD ["server.js"]
""")
    images = {}
    for sha in (INITIAL_SHA, CANDIDATE_SHA, BAD_SHA):
        tag = "vibeon-fixture:" + sha
        run(["docker", "build", "--build-arg", "REVISION=" + sha, "--build-arg", "FIXTURE_BAD=" + ("1" if sha == BAD_SHA else "0"), "-t", tag, str(context)])
        images[sha] = run(["docker", "image", "inspect", "--format", "{{.Id}}", tag]).decode().strip()
    return images, hashlib.sha256(migration.encode()).hexdigest()


def main():
    guard()  # Must run before any mutating command or fixture directory creation.
    with tempfile.TemporaryDirectory(prefix="vibeon-release-fixtures-") as temporary:
        root = Path(temporary)
        context = root / "build"
        context.mkdir()
        deployment = root / "deploy"
        deployment.mkdir()
        images, checksum = write_fixtures(context)
        compose = {"name": "vibeon", "services": {
            "app": {"image": images[INITIAL_SHA], "env_file": ".env", "volumes": ["uploads:/app/uploads"], "networks": ["vibeon"], "depends_on": {"db": {"condition": "service_healthy"}}},
            "db": {"image": "postgres:16-alpine", "environment": {"POSTGRES_USER": "vibeon", "POSTGRES_DB": "vibeon", "POSTGRES_PASSWORD": "synthetic-fixture-only"}, "volumes": ["pgdata:/var/lib/postgresql/data"], "networks": ["vibeon"], "healthcheck": {"test": ["CMD-SHELL", "pg_isready -h 127.0.0.1 -U vibeon"], "interval": "1s", "retries": 30}}},
            "networks": {"vibeon": {}}, "volumes": {"uploads": {}, "pgdata": {}}}
        compose_path = deployment / "docker-compose.prod.yml"
        compose_path.write_text(json.dumps(compose))
        (deployment / ".env").write_text("SYNTHETIC_FIXTURE=1\n")
        compose_hash = hashlib.sha256(compose_path.read_bytes()).hexdigest()
        compose_args = ["docker", "compose", "--project-name", "vibeon", "--env-file", str(deployment / ".env"), "-f", str(compose_path)]
        engines = []
        unlabelled = "vibeon-fixture-unlabelled-" + uuid.uuid4().hex
        try:
            run(compose_args + ["up", "-d", "--wait"])
            db_id = run(compose_args + ["ps", "--quiet", "db"]).decode().strip()
            app_id = run(compose_args + ["ps", "--quiet", "app"]).decode().strip()
            seed = ("CREATE TABLE \"_prisma_migrations\" (id text PRIMARY KEY, checksum text NOT NULL, migration_name text NOT NULL, finished_at timestamptz, rolled_back_at timestamptz);\n"
                    "CREATE TABLE fixture_answers (id integer PRIMARY KEY, answer text NOT NULL);\n"
                    "INSERT INTO \"_prisma_migrations\" VALUES ('synthetic','" + checksum + "','20261103194346_init',now(),NULL);\n"
                    "INSERT INTO fixture_answers VALUES (1,'initial-answer');\n")
            run(["docker", "exec", "-i", db_id, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", "vibeon", "-d", "vibeon"], data=seed.encode())
            run(["docker", "exec", app_id, "node", "-e", "require('fs').writeFileSync('/app/uploads/initial.txt','initial-upload')"])
            # Exercise the real Go template on an unrelated, unlabelled container
            # with a bind mount: optional Labels/Name/PortBindings may be absent.
            run(["docker", "run", "-d", "--name", unlabelled, "--network", "none", "--mount", "type=bind,source=" + str(context) + ",target=/fixture,readonly", "--entrypoint", "sh", "postgres:16-alpine", "-c", "sleep 600"])

            def engine(sha, rollback_sha, cls=delivery.Release, daily=False):
                instance = cls(sha, images[sha], rollback_sha, images[rollback_sha], compose_hash, images[rollback_sha], deployment, daily_policy=daily)
                engines.append(instance)
                return instance

            original_command, original_sleep = delivery.command, time.sleep
            def fail_dump(args, **kwargs):
                if "pg_dump" in args:
                    raise delivery.ReleaseError("database_backup_failed")
                return original_command(args, **kwargs)

            # Public health is replaced only in this isolated in-process test.
            # A second guard ensures an accidental production URL call fails.
            with engine_diagnostics(), patch.object(delivery, "public_health", return_value=True), patch.object(delivery.urllib.request, "build_opener", side_effect=AssertionError("production_network_forbidden")), patch.object(delivery.time, "sleep", side_effect=lambda seconds: original_sleep(min(seconds, 0.2))):
                stale = delivery.Release(CANDIDATE_SHA, images[CANDIDATE_SHA], INITIAL_SHA, images[INITIAL_SHA], compose_hash, "sha256:" + "f" * 64, deployment)
                try:
                    stale.apply()
                    raise RuntimeError("stale_current_image_not_rejected")
                except delivery.ReleaseError as error:
                    if str(error) != "unexpected_current_image":
                        raise
                with patch.object(delivery, "command", side_effect=fail_dump):
                    failed_backup = engine(CANDIDATE_SHA, INITIAL_SHA).apply()
                if failed_backup != {"status": "unchanged", "reason": "database_backup_failed"} or (deployment / "release-image.json").exists():
                    raise RuntimeError("backup_failure_contract_failed")
                original_command(["docker", "exec", app_id, "node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"], reason="fixture_original_not_resumed")

                daily = engine(INITIAL_SHA, INITIAL_SHA, daily=True)
                delivery.atomic_json(daily.override, daily.override_content(images[INITIAL_SHA], INITIAL_SHA))
                daily.current_image = images[INITIAL_SHA]
                daily.state("released")
                before = daily.journal.read_bytes()
                if daily.daily_full_backup().get("status") != "daily_backup_completed":
                    raise RuntimeError("daily_backup_not_completed")
                if (deployment / "release-state.json").read_bytes() != before:
                    raise RuntimeError("daily_backup_replaced_release_journal")
                if engine(INITIAL_SHA, INITIAL_SHA, daily=True).daily_full_backup().get("status") != "daily_backup_already_completed":
                    raise RuntimeError("same_day_backup_not_deduplicated")

                released = engine(CANDIDATE_SHA, INITIAL_SHA, daily=True).apply()
                if released.get("status") != "released":
                    raise RuntimeError("fixture_release_" + released.get("reason", "failed"))
                if (root / "REVISION").read_text().strip() != CANDIDATE_SHA:
                    raise RuntimeError("revision_not_verified")
                app_id = run(compose_args + ["ps", "--quiet", "app"]).decode().strip()
                run(["docker", "exec", db_id, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", "vibeon", "-d", "vibeon", "-c", "INSERT INTO fixture_answers VALUES (2,'after-first-release');"])
                run(["docker", "exec", app_id, "node", "-e", "require('fs').writeFileSync('/app/uploads/second.txt','after-first-release')"])

                class PostCutoverWrite(delivery.Release):
                    def verify(self, container, image, sha):
                        if sha == BAD_SHA:
                            # A new response/file accepted after the snapshot must
                            # survive reverting the application image.
                            run(["docker", "exec", db_id, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", "vibeon", "-d", "vibeon", "-c", "INSERT INTO fixture_answers VALUES (3,'accepted-after-cutover');"])
                            run(["docker", "exec", container, "node", "-e", "require('fs').writeFileSync('/app/uploads/third.txt','accepted-after-cutover')"])
                        return super().verify(container, image, sha)

                rolled_back = engine(BAD_SHA, CANDIDATE_SHA, PostCutoverWrite, daily=True).apply()
                if rolled_back.get("status") != "rolled_back" or rolled_back.get("reason") != "app_health_failed":
                    raise RuntimeError("fixture_rollback_" + rolled_back.get("reason", "failed"))
                if (root / "REVISION").read_text().strip() != CANDIDATE_SHA:
                    raise RuntimeError("rollback_revision_mismatch")
                answers = run(["docker", "exec", db_id, "psql", "-X", "-U", "vibeon", "-d", "vibeon", "-Atqc", "SELECT string_agg(answer,',' ORDER BY id) FROM fixture_answers;"]).decode().strip()
                if answers != "initial-answer,after-first-release,accepted-after-cutover":
                    raise RuntimeError("rollback_lost_answers")
                app_id = run(compose_args + ["ps", "--quiet", "app"]).decode().strip()
                uploads = run(["docker", "exec", app_id, "node", "-e", "const fs=require('fs');process.stdout.write(['initial.txt','second.txt','third.txt'].map(n=>fs.readFileSync('/app/uploads/'+n,'utf8')).join(','))"]).decode()
                if uploads != "initial-upload,after-first-release,accepted-after-cutover":
                    raise RuntimeError("rollback_lost_uploads")
                verified = list((deployment / "backups/releases").glob("*/verified.json"))
                if len(verified) != 1 or json.loads(verified[0].read_text()).get("kind") != "daily":
                    raise RuntimeError("backup_restore_rehearsal_not_verified")
            print(json.dumps({"status": "passed", "scenarios": ["backup_failure_resumes_original", "verified_daily_snapshot", "same_day_backup_idempotent", "routine_release_reuses_daily_snapshot", "failed_candidate_rolls_back_without_data_loss", "optional_docker_fields"], "production_contact": False}))
        finally:
            for instance in engines:
                if instance.restore_container:
                    run(["docker", "rm", "--force", instance.restore_container], check=False)
                for volume in (instance.restore_db_volume, instance.restore_uploads_volume):
                    if volume:
                        run(["docker", "volume", "rm", volume], check=False)
            run(["docker", "rm", "--force", unlabelled], check=False)
            # No existing VibeOn objects were permitted by guard(); these names
            # refer only to this runner's isolated fixture project.
            run(compose_args + ["down", "--volumes", "--remove-orphans"], check=False)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        reason = str(error) if isinstance(error, RuntimeError) and str(error).replace("_", "").isalnum() else "fixture_test_failed"
        print(json.dumps({"status": "failed", "reason": reason, "production_contact": False}))
        sys.exit(1)
