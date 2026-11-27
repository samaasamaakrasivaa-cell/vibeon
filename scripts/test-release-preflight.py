#!/usr/bin/env python3
"""Synthetic preflight checks. No Docker, server, secrets or customer records needed."""
import copy
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

source = (Path(__file__).resolve().parents[1] / "deploy/release-preflight.sh").read_text()
code = source.split("<<'PREFLIGHT_PY'\n", 1)[1].rsplit("\nPREFLIGHT_PY", 1)[0]
preflight = types.ModuleType("preflight_test")
exec(compile(code, "release-preflight.sh", "exec"), preflight.__dict__)
SECRET = "private-user@example.invalid secret-value 192.0.2.10"


def container(n, service):
    return {"id": str(n) * 64, "image": "sha256:" + "a" * 64,
            "image_ref": "postgres:16-alpine" if service == "db" else "vibeon-app:latest",
            "project": "vibeon", "service": service, "revision": SECRET,
            "mounts": [None], "networks": ["vibeon_vibeon", None], "published_ports": [None]}


class PreflightTest(unittest.TestCase):
    def setUp(self):
        self.app, self.db = container(1, "app"), container(2, "db")
        self.app["mounts"] = [{"type": "volume", "name": "vibeon_uploads", "destination": "/app/uploads", "rw": True}, None]
        self.db["mounts"] = [{"type": "volume", "name": "vibeon_pgdata", "destination": "/var/lib/postgresql/data", "rw": True}, None]
        self.containers = [self.app, self.db, container(3, "backup")]
        self.health = {"ok": True, "version": SECRET, "unexpected_private_data": SECRET}
        self.commands = []

    def command(self, *args):
        self.commands.append(args)
        if args[:3] == ("docker", "compose", "version"):
            return "2.39.0"
        if args[:2] == ("docker", "ps"):
            return "\n".join(c["id"] for c in self.containers)
        if args[:2] == ("docker", "inspect"):
            template = args[args.index("--format") + 1]
            if template == preflight.PEER_ENV_INSPECT:
                peer = next(c for c in self.containers if c["id"] == args[-1])
                return json.dumps(peer.get("synthetic_db_env", False))
            self.assertNotIn(".Config.Env", template)
            self.assertNotIn(".Source", template)
            return "\n".join(json.dumps(c) for c in self.containers)
        if args[:2] == ("docker", "exec"):
            self.assertEqual(args[3:5], ("node", "-e"))
            self.assertIn("http://127.0.0.1:3000/api/health", args[5])
            return json.dumps(self.health)
        self.fail("Unexpected command: " + repr(args[:2]))

    def collect(self):
        with patch.object(preflight, "run", self.command), patch.object(preflight.shutil, "which", return_value="present"), patch.object(preflight.shutil, "disk_usage", return_value=types.SimpleNamespace(free=10_000_000)):
            report = preflight.collect()
        self.assertNotIn(SECRET, json.dumps(report))
        return report

    def test_expected_topology_and_private_fields_filtered(self):
        report = self.collect()
        self.assertEqual(report["status"], "observed")
        self.assertTrue(report["read_only"])
        self.assertEqual(report["checks"]["app_revision"], "unlabelled")
        self.assertEqual(report["checks"]["health_version"], "unlabelled")
        self.assertEqual(report["checks"]["app_replicas"], 1)

    def test_unknown_writer_blocks_without_disclosing_identity(self):
        other = container(4, SECRET)
        other["project"] = SECRET
        other["mounts"] = copy.deepcopy(self.app["mounts"])
        self.containers.append(other)
        report = self.collect()
        self.assertEqual(report["status"], "blocked")
        self.assertEqual(report["checks"]["unknown_db_network_peers"], 1)
        self.assertEqual(report["checks"]["other_uploads_users"], 1)

    def test_published_database_port_blocks(self):
        self.db["published_ports"] = ["5432/tcp", None]
        self.assertIn("db_ports_published", self.collect()["blockers"])

    def test_peer_metadata_is_allowlisted_and_never_admits_proxy(self):
        peer = container(4, SECRET)
        peer.update(project=SECRET, image_ref="docker.io/library/caddy:2.8-alpine",
                    exposed_ports=["80/tcp", "443/tcp", "443/udp", SECRET, None],
                    synthetic_db_env=True)
        peer["mounts"] = [{"type": "bind", "name": SECRET, "destination": SECRET, "rw": True},
                          {"type": "volume", "name": "vibeon_pgdata", "destination": SECRET, "rw": True}]
        self.containers.append(peer)
        report = self.collect()
        self.assertEqual(report["status"], "blocked")
        self.assertIn("unknown_db_network_peers", report["blockers"])
        metadata = report["checks"]["unknown_peer_metadata"][0]
        self.assertEqual(metadata["family"], "caddy")
        self.assertEqual(metadata["compose_project"], "other")
        self.assertEqual(metadata["exposed_ports"], {"http": 1, "https": 2, "other": 1})
        self.assertEqual(metadata["bind_mount_count"], 1)
        self.assertTrue(metadata["shares_db_volume"])
        self.assertFalse(metadata["shares_upload_volume"])
        self.assertTrue(metadata["has_db_credential_env_keys"])
        self.assertNotIn("DATABASE_URL", json.dumps(report))

    def test_private_or_lookalike_image_is_not_official_family(self):
        peer = container(4, "proxy")
        peer["project"] = None
        for image_ref in ("private.example/caddy:2", "attacker/nginx:latest", "caddy.evil:2", SECRET):
            peer["image_ref"] = image_ref
            with patch.object(preflight, "run", return_value="false"):
                metadata = preflight.peer_metadata(peer)
            self.assertEqual(metadata["family"], "other")
            self.assertEqual(metadata["compose_project"], "none")
            self.assertFalse(metadata["has_db_credential_env_keys"])
            self.assertNotIn(SECRET, json.dumps(metadata))

    def test_failed_peer_credential_probe_stays_unknown_and_redacted(self):
        with patch.object(preflight, "run", side_effect=RuntimeError(SECRET)):
            metadata = preflight.peer_metadata(container(4, "other"))
        self.assertIsNone(metadata["has_db_credential_env_keys"])
        self.assertFalse(metadata["credential_env_check_available"])
        self.assertNotIn(SECRET, json.dumps(metadata))

    def test_multiple_app_replicas_block(self):
        self.containers.append(container(4, "app"))
        self.assertIn("expected_single_app_and_db", self.collect()["blockers"])

    def test_unhealthy_site_blocks(self):
        self.health["ok"] = False
        self.assertIn("health_unavailable", self.collect()["blockers"])

    def test_command_error_never_discloses_stderr(self):
        with patch.object(preflight, "run", side_effect=RuntimeError(SECRET)), patch.object(preflight.shutil, "which", return_value="present"), patch.object(preflight.shutil, "disk_usage", return_value=types.SimpleNamespace(free=1)):
            report = preflight.collect()
        self.assertEqual(report["status"], "blocked")
        self.assertNotIn(SECRET, json.dumps(report))

    def test_unexpected_mount_name_is_not_reported(self):
        self.app["mounts"][0]["name"] = SECRET
        self.assertIn("expected_uploads_volume_mismatch", self.collect()["blockers"])

    def test_exact_revision_and_dev_health_are_supported(self):
        self.app["revision"] = "b" * 40
        self.health["version"] = "dev"
        checks = self.collect()["checks"]
        self.assertEqual(checks["app_revision"], "b" * 40)
        self.assertEqual(checks["health_version"], "dev")

    def test_ssh_style_stdin_returns_failure_without_raw_errors(self):
        # Execute the actual Bash/heredoc entry point with a fake Docker binary.
        # PATH is isolated, so the test cannot reach any real Docker daemon.
        with tempfile.TemporaryDirectory() as directory:
            binaries = Path(directory)
            (binaries / "python3").symlink_to(sys.executable)
            fake = binaries / "docker"
            fake.write_text("#!/bin/sh\nprintf '%s\\n' '" + SECRET + "' >&2\nexit 9\n")
            fake.chmod(0o700)
            result = subprocess.run(["/bin/bash", "-s"], input=source, text=True,
                                    capture_output=True, timeout=10,
                                    env={**os.environ, "PATH": directory})
        self.assertEqual(result.returncode, 1)
        self.assertEqual(json.loads(result.stdout)["status"], "blocked")
        self.assertNotIn(SECRET, result.stdout + result.stderr)
        self.assertEqual(result.stderr, "")


@unittest.skipUnless(os.environ.get("CD01_REAL_DOCKER") == "1", "Docker integration runs in CI")
class DockerMetadataTest(unittest.TestCase):
    def test_unlabelled_and_labelled_containers_with_bind_mount(self):
        # Exercise Docker's Go-template parser, rather than a mocked JSON reply.
        # Fixtures never run, have no network and contain only synthetic values.
        fixture_ids = []
        with tempfile.TemporaryDirectory() as directory:
            try:
                subprocess.run(["docker", "pull", "busybox:1.36"], check=True,
                               stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=90)
                for labelled in (False, True):
                    args = ["docker", "create", "--network", "none",
                            "--mount", "type=bind,source=" + directory + ",target=/fixture,readonly",
                            "--env", "SYNTHETIC_SECRET=" + SECRET]
                    if labelled:
                        args += ["--label", "com.docker.compose.project=vibeon",
                                 "--label", "com.docker.compose.service=app",
                                 "--env", "DATABASE_URL=" + SECRET]
                    args += ["busybox:1.36", "true"]
                    created = subprocess.run(args, check=True, capture_output=True, text=True, timeout=30)
                    fixture_id = created.stdout.strip()
                    self.assertRegex(fixture_id, r"^[0-9a-f]{64}$")
                    fixture_ids.append(fixture_id)
                    observed = subprocess.run(
                        ["docker", "inspect", "--type", "container", "--format", preflight.INSPECT, fixture_id],
                        check=True, capture_output=True, text=True, timeout=30)
                    metadata = json.loads(observed.stdout)
                    self.assertEqual(metadata["project"], "vibeon" if labelled else None)
                    self.assertIsNone(metadata["revision"])
                    mount = next(m for m in metadata["mounts"] if m)
                    self.assertEqual(mount["type"], "bind")
                    self.assertIn(mount["name"], (None, ""))
                    self.assertNotIn(SECRET, observed.stdout)
                    self.assertNotIn(directory, observed.stdout)
                    env_presence = subprocess.run(
                        ["docker", "inspect", "--type", "container", "--format", preflight.PEER_ENV_INSPECT, fixture_id],
                        check=True, capture_output=True, text=True, timeout=30)
                    self.assertEqual(json.loads(env_presence.stdout), labelled)
                    self.assertNotIn(SECRET, env_presence.stdout)
                    self.assertNotIn("DATABASE_URL", env_presence.stdout)
            finally:
                for fixture_id in fixture_ids:
                    subprocess.run(["docker", "rm", fixture_id], check=False,
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=30)


if __name__ == "__main__":
    unittest.main()
