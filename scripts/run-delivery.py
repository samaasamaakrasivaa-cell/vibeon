#!/usr/bin/env python3
"""Release reviewed main through the existing SSH connection, without new services.

The caller may supply --candidate-image only after check-release-image.sh passed
for that exact local image in this trusted main CI job. All other images are
built and checked here before any application switch. No private server output
is forwarded, and a lost SSH reply is reported as unknown, never as published.
"""
import argparse
import contextlib
from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import sys
import tarfile
import tempfile

REPO = "samaasamaakrasivaa-cell/vibeon"
REMOTE = "https://github.com/" + REPO + ".git"
ROOT = Path(__file__).resolve().parents[1]
SHA = re.compile(r"[0-9a-f]{40}\Z")
DIGEST = re.compile(r"sha256:[0-9a-f]{64}\Z")
HEX = re.compile(r"[0-9a-f]{64}\Z")
REMOTE_DIRECTORY = re.compile(r"/tmp/vibeon-delivery\.[A-Za-z0-9]{8}\Z")
IMAGE_LABELS = r'''{{$l := index .Config "Labels"}}{"id":{{json .Id}},"source":{{if $l}}{{json (index $l "org.opencontainers.image.revision")}}{{else}}null{{end}},"recipe":{{if $l}}{{json (index $l "io.vibeon.recipe-revision")}}{{else}}null{{end}}}'''
POLICY_KEYS = {"schema_version", "enabled", "shared_proxy_image", "compose_sha256", "legacy_tooling_sha256", "legacy_source", "legacy_image", "teacher_source", "placement_base", "placement_fallback"}
TOOLING_NAMES = {"vibeon.sh", "attach-proxy.sh"}
ENGINE_CODES = {"unexpected_current_image", "migration_set_mismatch", "schema_change_requires_separate_release", "configuration_changed_during_backup", "database_clients_still_connected", "insufficient_backup_space", "database_backup_failed", "uploads_backup_failed", "database_restore_verification_failed", "uploads_restore_verification_failed", "uploads_restore_content_mismatch", "restore_cleanup_failed", "app_switch_failed", "app_health_failed", "rollback_failed", "release_already_running", "interrupted_release_requires_recovery", "unknown_database_peer", "unsupported_volume_topology", "compose_contract_mismatch", "release_interrupted"}
TOOLING_INSTALLER = r'''
import fcntl, hashlib, json, os, pathlib, re, sys, tempfile
NAMES = {"vibeon.sh", "attach-proxy.sh"}

def validate_tooling_hashes(current, approved, previous):
    # Complete validation precedes the first write, including for the other file.
    if any(not isinstance(values, dict) or set(values) != NAMES for values in (current, approved, previous)):
        raise ValueError("tooling_policy_invalid")
    if any(not isinstance(digest, str) or not re.fullmatch(r"[0-9a-f]{64}", digest)
           for values in (current, approved, previous) for digest in values.values()):
        raise ValueError("tooling_policy_invalid")
    if any(current[name] not in {previous[name], approved[name]} for name in NAMES):
        raise ValueError("unknown_legacy_tooling")
    return sorted(name for name in NAMES if current[name] != approved[name])

def atomic(path, content):
    fd, temporary = tempfile.mkstemp(prefix=".delivery-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(temporary, 0o700)
        os.replace(temporary, path)
        parent = os.open(path.parent, os.O_DIRECTORY)
        try:
            os.fsync(parent)
        finally:
            os.close(parent)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)

def install(root, stage, revision, previous, approved):
    if not re.fullmatch(r"[0-9a-f]{40}", revision):
        raise ValueError("tooling_policy_invalid")
    fd = os.open(root / ".release.lock", os.O_CREAT | os.O_RDWR, 0o600)
    try:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise ValueError("legacy_tooling_installation_locked") from None
        if any((root / name).is_symlink() or (stage / name).is_symlink() for name in NAMES):
            raise ValueError("unknown_legacy_tooling")
        old = {name: (root / name).read_bytes() for name in NAMES}
        new = {name: (stage / name).read_bytes() for name in NAMES}
        actual_new = {name: hashlib.sha256(value).hexdigest() for name, value in new.items()}
        if actual_new != approved:
            raise ValueError("staged_tooling_hash_mismatch")
        changes = validate_tooling_hashes({name: hashlib.sha256(value).hexdigest() for name, value in old.items()}, approved, previous)
        if not changes:
            return
        backup = root / "backups" / "tooling" / revision
        backup.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(backup.parent, 0o700)
        os.chmod(backup, 0o700)
        # Verify every existing backup before installing either file.
        for name in changes:
            destination = backup / name
            if destination.is_symlink() or (destination.exists() and destination.read_bytes() != old[name]):
                raise ValueError("tooling_backup_mismatch")
        for name in changes:
            if not (backup / name).exists():
                atomic(backup / name, old[name])
        for name in changes:
            atomic(root / name, new[name])
    finally:
        os.close(fd)

def main():
    os.umask(0o077)
    try:
        stage, revision, previous, approved = sys.argv[1:]
        if not re.fullmatch(r"/tmp/vibeon-delivery\.[A-Za-z0-9]{8}", stage):
            raise ValueError("tooling_policy_invalid")
        install(pathlib.Path("/opt/vibeon/deploy"), pathlib.Path(stage), revision, json.loads(previous), json.loads(approved))
        print('{"status":"installed"}')
        return 0
    except Exception as error:
        allowed = {"tooling_policy_invalid", "unknown_legacy_tooling", "staged_tooling_hash_mismatch", "legacy_tooling_installation_locked", "tooling_backup_mismatch"}
        reason = str(error) if isinstance(error, ValueError) and str(error) in allowed else "legacy_tooling_installation_failed"
        print(json.dumps({"status":"blocked", "reason":reason}, separators=(",", ":")))
        return 1

if __name__ == "__main__":
    sys.exit(main())
'''


class DeliveryError(Exception):
    """Only fixed codes chosen by this program are emitted."""


def child_environment():
    return {k: v for k, v in os.environ.items() if k not in {"SSH_KEY", "SSH_HOST"}}


def command(args, reason, *, data=None, output=None, timeout=300, cwd=ROOT):
    try:
        result = subprocess.run(args, input=data, stdout=output if output is not None else subprocess.PIPE,
                                stderr=subprocess.PIPE, cwd=cwd, env=child_environment(), timeout=timeout, check=False)
    except (OSError, subprocess.TimeoutExpired):
        raise DeliveryError(reason) from None
    if result.returncode:
        raise DeliveryError(reason)
    return result.stdout or b""


def object_reply(raw, reason):
    try:
        if len(raw) > 1024 * 1024:
            raise ValueError()
        value = json.loads(raw)
        if not isinstance(value, dict):
            raise ValueError()
        return value
    except (TypeError, ValueError):
        raise DeliveryError(reason) from None


def validate_policy(policy):
    if not isinstance(policy, dict) or set(policy) != POLICY_KEYS or policy.get("schema_version") != 1 or type(policy.get("enabled")) is not bool:
        raise DeliveryError("release_policy_invalid")
    for name in ("legacy_source", "teacher_source", "placement_base", "placement_fallback"):
        if not isinstance(policy[name], str) or not SHA.fullmatch(policy[name]):
            raise DeliveryError("release_policy_invalid")
    if not isinstance(policy["compose_sha256"], str) or not HEX.fullmatch(policy["compose_sha256"]) or not isinstance(policy["legacy_image"], str) or not DIGEST.fullmatch(policy["legacy_image"]):
        raise DeliveryError("release_policy_invalid")
    proxy = policy["shared_proxy_image"]
    if proxy is not None and (not isinstance(proxy, str) or not DIGEST.fullmatch(proxy)):
        raise DeliveryError("release_policy_invalid")
    if policy["enabled"] and proxy is None:
        raise DeliveryError("reviewed_proxy_identity_required")
    tooling = policy["legacy_tooling_sha256"]
    if not isinstance(tooling, dict) or set(tooling) != TOOLING_NAMES or any(not isinstance(v, str) or not HEX.fullmatch(v) for v in tooling.values()):
        raise DeliveryError("release_policy_invalid")
    return policy


@dataclass(frozen=True)
class State:
    image: str
    revision: str
    health_version: str


@dataclass(frozen=True)
class Phase:
    source: str
    fallback_source: str
    # None means build/check a fallback before the first switch; a digest means
    # the already running compatible image remains on the server for rollback.
    fallback_image: str | None = None


def preflight_state(report):
    if report.get("schema_version") != 1 or report.get("read_only") is not True or report.get("status") != "observed":
        raise DeliveryError("server_preflight_blocked")
    checks = report.get("checks", {})
    image, revision, health = checks.get("app_image_id"), checks.get("app_revision"), checks.get("health_version")
    if checks.get("health_ok") is not True or not isinstance(image, str) or not DIGEST.fullmatch(image):
        raise DeliveryError("current_server_identity_unavailable")
    if not isinstance(revision, str) or not isinstance(health, str):
        raise DeliveryError("current_server_identity_unavailable")
    return State(image, revision, health)


def make_plan(policy, target, state, is_ancestor):
    """Pure, narrow bootstrap/ordinary-release state machine."""
    validate_policy(policy)
    if not SHA.fullmatch(target) or not DIGEST.fullmatch(state.image):
        raise DeliveryError("invalid_release_identity")
    if not is_ancestor(policy["placement_base"], target):
        raise DeliveryError("target_missing_approved_placement_base")
    if state.image == policy["legacy_image"]:
        if state.revision != "unlabelled" or state.health_version != "dev":
            raise DeliveryError("ambiguous_legacy_state")
        return [Phase(policy["teacher_source"], policy["legacy_source"]), Phase(target, policy["placement_fallback"])]
    if not SHA.fullmatch(state.revision) or state.health_version != state.revision:
        raise DeliveryError("unknown_or_ambiguous_server_state")
    if state.revision == policy["teacher_source"]:
        if not is_ancestor(state.revision, target):
            raise DeliveryError("target_would_downgrade")
        return [Phase(target, policy["placement_fallback"])]
    if state.revision == policy["placement_fallback"] or is_ancestor(policy["placement_base"], state.revision):
        if not is_ancestor(state.revision, target):
            raise DeliveryError("target_would_downgrade")
        if state.revision == target:
            return []
        return [Phase(target, state.revision, state.image)]
    raise DeliveryError("unknown_server_source")


def ensure_commit(sha):
    try:
        command(["git", "cat-file", "-e", sha + "^{commit}"], "git_source_unavailable")
    except DeliveryError:
        command(["git", "fetch", "--no-tags", REMOTE, sha], "git_source_unavailable")


def is_ancestor(base, head):
    ensure_commit(base)
    ensure_commit(head)
    try:
        result = subprocess.run(["git", "merge-base", "--is-ancestor", base, head], cwd=ROOT,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=child_environment(), timeout=30, check=False)
    except (OSError, subprocess.TimeoutExpired):
        raise DeliveryError("git_ancestry_unavailable") from None
    if result.returncode not in (0, 1):
        raise DeliveryError("git_ancestry_unavailable")
    return result.returncode == 0


def assert_current_main(expected, remote_reply=None):
    raw = command(["git", "ls-remote", REMOTE, "refs/heads/main"], "main_head_unavailable") if remote_reply is None else remote_reply
    try:
        entries = raw.decode("ascii").strip().splitlines()
        fields = entries[0].split() if len(entries) == 1 else []
    except (UnicodeError, IndexError):
        fields = []
    if fields != [expected, "refs/heads/main"]:
        raise DeliveryError("main_changed_before_release")


def committed_file(sha, path):
    return command(["git", "show", sha + ":" + path], "reviewed_release_file_unavailable")


def verify_local_image(image, source, recipe):
    if not DIGEST.fullmatch(image):
        raise DeliveryError("candidate_image_invalid")
    metadata = object_reply(command(["docker", "image", "inspect", "--format", IMAGE_LABELS, image], "candidate_image_unavailable"), "candidate_image_metadata_invalid")
    if metadata != {"id": image, "source": source, "recipe": recipe}:
        raise DeliveryError("candidate_image_provenance_mismatch")


def build_image(source, recipe, directory, recipe_bytes, checker):
    ensure_commit(source)
    context = directory / source
    context.mkdir()
    archive = directory / (source + ".tar")
    with archive.open("wb") as output:
        command(["git", "archive", "--format=tar", source], "source_archive_failed", output=output)
    try:
        with tarfile.open(archive) as contents:
            contents.extractall(context, filter="data")
    except (OSError, tarfile.TarError, TypeError):
        raise DeliveryError("source_archive_invalid") from None
    archive.unlink()
    (context / "Dockerfile").write_bytes(recipe_bytes)
    tag = "vibeon-delivery:" + source[:12] + "-" + recipe[:12]
    command(["docker", "build", "--build-arg", "BUILD_STAMP=" + source, "--build-arg", "APP_VERSION=" + source,
             "--label", "org.opencontainers.image.revision=" + source,
             "--label", "io.vibeon.recipe-revision=" + recipe, "-t", tag, str(context)], "release_image_build_failed", timeout=1800)
    image = command(["docker", "image", "inspect", "--format", "{{.Id}}", tag], "built_image_unavailable").decode().strip()
    verify_local_image(image, source, recipe)
    command(["bash", str(checker), image, source], "release_image_smoke_failed", timeout=600)
    return image


class Connection:
    def __init__(self, directory):
        key, host = os.environ.get("SSH_KEY", ""), os.environ.get("SSH_HOST", "")
        if not key or not host:
            raise DeliveryError("ssh_connection_unavailable")
        if not re.fullmatch(r"[A-Za-z0-9.:-]+", host) or host.startswith("-"):
            raise DeliveryError("ssh_host_invalid")
        self.directory, self.remote_directory = directory, None
        directory.mkdir(mode=0o700)
        private_key = directory / "id"
        # Match the proven shell `printf '%s\n'`: Secrets may omit the final
        # newline required by OpenSSH's private-key parser.
        private_key.write_text(key + "\n")
        private_key.chmod(0o600)
        hosts = command(["ssh-keyscan", "-T", "15", host], "ssh_host_key_unavailable", timeout=30)
        if not hosts.strip():
            raise DeliveryError("ssh_host_key_unavailable")
        (directory / "known_hosts").write_bytes(hosts)
        config = ("Host srv\n  HostName " + host + "\n  User root\n  IdentityFile " + str(private_key)
                  + "\n  UserKnownHostsFile " + str(directory / "known_hosts")
                  + "\n  StrictHostKeyChecking yes\n  IdentitiesOnly yes\n  BatchMode yes\n  ConnectTimeout 15\n  ServerAliveInterval 15\n  ServerAliveCountMax 3\n")
        self.config = directory / "config"
        self.config.write_text(config)
        self.config.chmod(0o600)

    def ssh_args(self, remote):
        return ["ssh", "-F", str(self.config), "srv", remote]

    def run(self, remote, reason, *, data=None, timeout=300):
        return command(self.ssh_args(remote), reason, data=data, timeout=timeout)

    def stage(self, recipe):
        path = self.run("umask 077; mktemp -d /tmp/vibeon-delivery.XXXXXXXX", "remote_staging_failed").decode().strip()
        if not REMOTE_DIRECTORY.fullmatch(path):
            raise DeliveryError("remote_staging_identity_invalid")
        self.remote_directory = path
        for name in ("release-preflight.sh", "release-apply.py", "vibeon.sh", "attach-proxy.sh"):
            destination = shlex.quote(path + "/" + name)
            self.run("umask 077; cat > " + destination + " && chmod 700 " + destination,
                     "remote_script_upload_failed", data=committed_file(recipe, "deploy/" + name))

    def preflight(self, proxy):
        remote = "env VIBEON_EXPECTED_PROXY_IMAGE=" + shlex.quote(proxy) + " bash " + shlex.quote(self.remote_directory + "/release-preflight.sh")
        # A blocked preflight exits nonzero. Discard its private output and stop.
        return preflight_state(object_reply(self.run(remote, "server_preflight_blocked"), "preflight_reply_invalid"))

    def install_tooling(self, recipe, policy):
        approved = {name: hashlib.sha256(committed_file(recipe, "deploy/" + name)).hexdigest() for name in TOOLING_NAMES}
        args = ["python3", "-", self.remote_directory, recipe,
                json.dumps(policy["legacy_tooling_sha256"], sort_keys=True), json.dumps(approved, sort_keys=True)]
        report = object_reply(self.run(shlex.join(args), "legacy_tooling_installation_failed", data=TOOLING_INSTALLER.encode()), "legacy_tooling_reply_invalid")
        if report != {"status": "installed"}:
            raise DeliveryError("legacy_tooling_installation_failed")

    def transfer(self, images):
        # Stream one shared-layer archive; no persistent runner/server archive.
        images = sorted(set(images))
        if not images or any(not DIGEST.fullmatch(i) for i in images):
            raise DeliveryError("transfer_image_identity_invalid")
        processes = []
        with tempfile.TemporaryFile() as errors:
            try:
                save = subprocess.Popen(["docker", "save", *images], stdout=subprocess.PIPE, stderr=errors, env=child_environment())
                processes.append(save)
                gzip = subprocess.Popen(["gzip", "-1"], stdin=save.stdout, stdout=subprocess.PIPE, stderr=errors, env=child_environment())
                processes.append(gzip)
                save.stdout.close()
                remote = "bash -o pipefail -c " + shlex.quote("gzip -dc | docker load >/dev/null 2>&1")
                upload = subprocess.Popen(self.ssh_args(remote), stdin=gzip.stdout, stdout=subprocess.PIPE, stderr=errors, env=child_environment())
                processes.append(upload)
                gzip.stdout.close()
                upload.communicate(timeout=1200)
                if upload.returncode or gzip.wait(timeout=30) or save.wait(timeout=30):
                    raise DeliveryError("image_transfer_failed")
            except (OSError, subprocess.TimeoutExpired):
                raise DeliveryError("image_transfer_failed") from None
            finally:
                for process in reversed(processes):
                    if process.poll() is None:
                        process.kill()
                    with contextlib.suppress(Exception):
                        process.wait(timeout=10)
        for image in images:
            reply = self.run("docker image inspect --format '{{.Id}}' " + shlex.quote(image), "loaded_image_unavailable")
            if reply.decode().strip() != image:
                raise DeliveryError("loaded_image_identity_mismatch")

    def apply(self, phase, image, fallback, expected, policy):
        args = ["python3", self.remote_directory + "/release-apply.py", "--sha", phase.source, "--image", image,
                "--rollback-sha", phase.fallback_source, "--rollback-image", fallback,
                "--compose-sha256", policy["compose_sha256"], "--expected-current-image", expected,
                "--allowed-proxy-image", policy["shared_proxy_image"]]
        # An executor may correctly return nonzero after rollback. Capture its
        # JSON separately from transport errors without ever forwarding stderr.
        try:
            reply = subprocess.run(self.ssh_args(shlex.join(args)), stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                   env=child_environment(), timeout=1800, check=False)
        except (OSError, subprocess.TimeoutExpired):
            raise DeliveryError("release_result_unknown") from None
        if reply.returncode == 255:
            raise DeliveryError("release_result_unknown")
        report = object_reply(reply.stdout, "release_result_unknown")
        status = report.get("status")
        if status == "released" and reply.returncode == 0 and report.get("sha") == phase.source and report.get("image") == image:
            return {"status": "released", "sha": phase.source, "image": image}
        if status == "rolled_back" and reply.returncode != 0 and report.get("sha") == phase.fallback_source and report.get("image") == fallback:
            return {"status": "rolled_back", "sha": phase.fallback_source, "image": fallback,
                    "reason": report.get("reason") if report.get("reason") in ENGINE_CODES else "executor_failed"}
        if status in {"blocked", "unchanged"} and reply.returncode != 0:
            return {"status": status, "reason": report.get("reason") if report.get("reason") in ENGINE_CODES else "executor_failed"}
        raise DeliveryError("release_result_unknown")

    def cleanup(self):
        if self.remote_directory and REMOTE_DIRECTORY.fullmatch(self.remote_directory):
            with contextlib.suppress(DeliveryError):
                self.run("rm -rf -- " + shlex.quote(self.remote_directory), "remote_staging_cleanup_failed", timeout=30)


def deliver(target, policy, candidate_image=None):
    assert_current_main(target)
    ensure_commit(target)
    recipe_bytes = committed_file(target, "Dockerfile")
    completed = []
    with tempfile.TemporaryDirectory(prefix="vibeon-delivery-") as temporary:
        workspace = Path(temporary)
        checker = workspace / "check-release-image.sh"
        checker.write_bytes(committed_file(target, "scripts/check-release-image.sh"))
        connection = Connection(workspace / "ssh")
        try:
            connection.stage(target)
            state = connection.preflight(policy["shared_proxy_image"])
            phases = make_plan(policy, target, state, is_ancestor)
            if not phases:
                return {"status": "already_current", "sha": target, "image": state.image}
            built = {}
            if candidate_image:
                verify_local_image(candidate_image, target, target)
                built[target] = candidate_image
            needed = {p.source for p in phases} | {p.fallback_source for p in phases if p.fallback_image is None}
            for source in sorted(needed):
                if source not in built:
                    built[source] = build_image(source, target, workspace, recipe_bytes, checker)
            # Every bootstrap image and fallback is now tested, before any switch.
            assert_current_main(target)
            connection.transfer(built[source] for source in needed)
            assert_current_main(target)
            connection.install_tooling(target, policy)
            expected = state.image
            for phase in phases:
                latest = connection.preflight(policy["shared_proxy_image"])
                if latest.image != expected:
                    raise DeliveryError("current_image_changed_before_release")
                assert_current_main(target)  # Last external check before executor.
                result = connection.apply(phase, built[phase.source], phase.fallback_image or built[phase.fallback_source], expected, policy)
                if result["status"] != "released":
                    result["completed_phases"] = completed
                    return result
                completed.append(result["sha"])
                expected = result["image"]
            return {"status": "released", "sha": target, "image": expected, "completed_phases": completed}
        except DeliveryError as error:
            report = {"status": "unknown" if str(error) == "release_result_unknown" else "blocked", "reason": str(error)}
            if completed:
                report["completed_phases"] = completed
            return report
        finally:
            connection.cleanup()


class SafeParser(argparse.ArgumentParser):
    def error(self, _message):
        raise DeliveryError("invalid_arguments")


def main():
    try:
        parser = SafeParser(add_help=False)
        parser.add_argument("--candidate-image")
        args = parser.parse_args()
        target = os.environ.get("GITHUB_SHA", "")
        if (os.environ.get("GITHUB_ACTIONS") != "true" or os.environ.get("GITHUB_REPOSITORY") != REPO
                or os.environ.get("GITHUB_REF") != "refs/heads/main" or os.environ.get("GITHUB_EVENT_NAME") != "push"
                or not SHA.fullmatch(target)):
            raise DeliveryError("trusted_main_ci_required")
        policy = validate_policy(object_reply(committed_file(target, "deploy/release-policy.json"), "release_policy_invalid"))
        if not policy["enabled"]:
            report = {"status": "disabled", "reason": "release_policy_disabled"}
        else:
            report = deliver(target, policy, args.candidate_image)
    except DeliveryError as error:
        report = {"status": "blocked", "reason": str(error)}
    except BaseException:
        report = {"status": "unknown", "reason": "delivery_interrupted_or_failed"}
    print(json.dumps(report, sort_keys=True, separators=(",", ":")))
    return 0 if report["status"] in {"released", "already_current", "disabled"} else 1


if __name__ == "__main__":
    sys.exit(main())
