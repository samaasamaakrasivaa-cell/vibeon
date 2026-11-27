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
            self.assertNotIn(".Config.Env", args[3])
            self.assertNotIn(".Source", args[3])
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


if __name__ == "__main__":
    unittest.main()
