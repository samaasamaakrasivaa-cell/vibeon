#!/usr/bin/env python3
"""Capacity checks with synthetic files, devices and Docker metadata."""
import datetime
import gzip
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import tarfile
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
from contextlib import redirect_stdout

ROOT = Path(__file__).resolve().parents[1]


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    result = importlib.util.module_from_spec(spec)
    sys.modules[name] = result
    spec.loader.exec_module(result)
    return result


capacity = module("release_capacity_fixture", "deploy/release_capacity.py")
delivery = module("release_delivery_fixture", "scripts/run-delivery.py")


class CapacityTest(unittest.TestCase):
    def budget(self, devices, free, inodes, archive=80, phases=2):
        backup, docker = Path("/backup"), Path("/docker")
        with patch.object(Path, "stat", lambda p: SimpleNamespace(st_dev=devices[str(p)])), \
                patch.object(capacity.os, "statvfs", lambda p: SimpleNamespace(
                    f_bavail=free[devices[str(p)]], f_frsize=1, f_favail=inodes)):
            return capacity.budget(20, 40, backup, [docker], archive, phases)

    def test_same_device_sums_transfer_and_backup_demands(self):
        paths = dict.fromkeys(("/backup", "/docker", "/tmp"), 1)
        threshold = capacity.MIN_RESERVE + 2*20 + 3*40 + 60 + 3*80
        self.assertEqual(self.budget(paths, {1: threshold}, 4096)["status"], "ready")
        report = self.budget(paths, {1: threshold - 1}, 4096)
        self.assertEqual(report["reason"], "insufficient_pretransfer_space")
        self.assertEqual(report["minimum_space_margin_bytes"], -1)
        self.assertEqual(self.budget(paths, {1: threshold}, 4095)["status"], "blocked")

    def test_distinct_devices_keep_independent_reserves(self):
        paths = {"/backup": 1, "/docker": 2, "/tmp": 3}
        floor = capacity.MIN_RESERVE
        free = {1: floor + 160 + 60, 2: floor + 160 + 240, 3: floor + 80}
        self.assertEqual(self.budget(paths, free, 4096)["status"], "ready")
        free[3] -= 1
        self.assertEqual(self.budget(paths, free, 4096)["status"], "blocked")

    def test_rechecks_capacity_with_same_lock_before_import(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            args = SimpleNamespace(mode="load", archive=8192, phases=1, images=["sha256:" + "a"*64])
            with capacity.release_lock(root, create=True), patch.object(capacity, "inventory") as read:
                with self.assertRaisesRegex(capacity.CapacityError, "release_already_running"):
                    capacity.operation(args, root)
                read.assert_not_called()
            with patch.object(capacity, "inventory", return_value=(20, 40, root, [root])), \
                    patch.object(capacity, "budget", return_value={"status": "blocked"}), \
                    patch.object(capacity.subprocess, "run") as load:
                self.assertEqual(capacity.operation(args, root), {"status": "blocked"})
                load.assert_not_called()

    def test_same_lock_is_held_through_import_and_identity_verification(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            image = "sha256:" + "a"*64
            args = SimpleNamespace(mode="load", archive=8192, phases=1, images=[image])
            def assert_locked(*_, **__):
                with self.assertRaisesRegex(capacity.CapacityError, "release_already_running"):
                    with capacity.release_lock(root):
                        self.fail("overlapped Docker load")
                return image
            with patch.object(capacity, "inventory", return_value=(20, 40, root, [root])), \
                    patch.object(capacity, "budget", return_value={"status": "ready"}), \
                    patch.object(capacity.subprocess, "run", side_effect=assert_locked), \
                    patch.object(capacity, "run", side_effect=assert_locked):
                self.assertEqual(capacity.operation(args, root), {"status": "ready"})

    def test_only_known_marked_old_stages_are_swept(self):
        with tempfile.TemporaryDirectory() as temporary:
            stages = Path(temporary)
            def stage(suffix, marked=True):
                path = stages / ("vibeon-delivery." + suffix)
                path.mkdir(mode=0o700)
                if marked:
                    marker = path / capacity.STAGE_MARKER
                    marker.write_bytes(b"vibeon-delivery-v1\n")
                    os.utime(marker, (100, 100))
                (path / "release-apply.py").write_text("synthetic fixture")
                return path
            stale = stage("stale123")
            active = stage("active12")
            unmarked = stage("unmarked", marked=False)
            linked = stage("symlink1")
            (linked / "release-preflight.sh").symlink_to(active / "release-apply.py")
            extra = stage("unknown1")
            (extra / "unknown.txt").write_text("synthetic unrelated file")
            hardlink = stage("hardlink")
            os.link(active / "release-apply.py", hardlink / "vibeon.sh")
            with patch.object(capacity, "STAGE_OWNER_UID", os.getuid()):
                self.assertEqual(capacity.sweep_stages(active, stages, 100_000), 1)
            self.assertFalse(stale.exists())
            for path in (active, unmarked, linked, extra, hardlink):
                self.assertTrue(path.exists())

    def test_archive_sizing_counts_expanded_encoded_layer(self):
        data = b"synthetic" * 10_000
        layer = gzip.compress(data)
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "archive.tar"
            with tarfile.open(path, "w") as archive:
                for name, content in (("manifest.json", b'[{"Layers":["layer"]}]'), ("layer", layer)):
                    entry = tarfile.TarInfo(name)
                    entry.size = len(content)
                    archive.addfile(entry, io.BytesIO(content))
            self.assertEqual(delivery.archive_bytes(path), path.stat().st_size + len(data) - len(layer))

    def test_driver_stops_before_staging_or_transfer_when_probe_blocks(self):
        live = "b" * 40
        target = "a" * 40
        image = "sha256:" + "c" * 64
        state = delivery.State("sha256:" + "d" * 64, live, live)
        connection = Mock()
        connection.preflight.return_value = state
        connection.capacity.side_effect = delivery.CapacityBlocked("insufficient_pretransfer_space", {
            "minimum_space_margin_bytes": -1,
        })
        with patch.object(delivery, "assert_current_main"), patch.object(delivery, "ensure_commit"), \
                patch.object(delivery, "committed_file", return_value=b"synthetic"), \
                patch.object(delivery, "make_plan", return_value=[delivery.Phase(target, live, state.image)]), \
                patch.object(delivery, "verify_local_image"), patch.object(delivery, "command") as command, \
                patch.object(delivery, "storage_only_changes", return_value=False), \
                patch.object(delivery, "Connection", return_value=connection):
            report = delivery.deliver(target, {"shared_proxy_image": "synthetic"}, image)
        self.assertEqual(report["reason"], "insufficient_pretransfer_space")
        self.assertEqual(report["storage_capacity"], {"minimum_space_margin_bytes": -1})
        for operation in (command, connection.stage, connection.transfer, connection.apply):
            operation.assert_not_called()

    def test_storage_only_diff_is_exact_and_ordinary(self):
        live, target = "b" * 40, "a" * 40
        image = "sha256:" + "d" * 64
        state = delivery.State(image, live, live)
        phases = [delivery.Phase(target, live, image)]
        for paths, expected in (
            (b"deploy/release_capacity.py\0scripts/run-delivery.py\0", True),
            (b"deploy/release_capacity.py\0src/app/api/health/route.ts\0", False),
            (b".github/workflows/ci.yml.backup\0", False),
            (b"Dockerfile\0", False),
            (b"deploy/release_capacity.py", False),
            (b"", False),
        ):
            with self.subTest(paths=paths), patch.object(delivery, "command", return_value=paths) as git:
                self.assertEqual(delivery.storage_only_changes(target, state, phases), expected)
                self.assertIn("--no-renames", git.call_args.args[0])
        with patch.object(delivery, "command") as git:
            self.assertFalse(delivery.storage_only_changes(target, state, [delivery.Phase(target, live)]))
            self.assertFalse(delivery.storage_only_changes(target, delivery.State(image, live, target), phases))
            git.assert_not_called()

    def test_storage_only_driver_never_builds_or_transfers_application(self):
        live, target = "b" * 40, "a" * 40
        image = "sha256:" + "d" * 64
        state = delivery.State(image, live, live)
        phase = delivery.Phase(live, live, image)
        policy = {"shared_proxy_image": "synthetic"}
        connection = Mock()
        connection.preflight.return_value = state
        connection.capacity.return_value = {"minimum_space_margin_bytes": 1}
        connection.apply.return_value = {"status": "storage_maintained", "sha": live, "image": image}
        connection.stage_operation.return_value = 0
        with patch.object(delivery, "assert_current_main") as main, patch.object(delivery, "ensure_commit"), \
                patch.object(delivery, "committed_file", return_value=b"synthetic"), \
                patch.object(delivery, "make_plan", return_value=[delivery.Phase(target, live, image)]), \
                patch.object(delivery, "verify_local_image") as verify, patch.object(delivery, "command") as command, \
                patch.object(delivery, "storage_only_changes", return_value=True), \
                patch.object(delivery, "Connection", return_value=connection):
            report = delivery.deliver(target, policy, "sha256:" + "c" * 64)
        self.assertEqual((report["status"], report["sha"], report["maintenance_revision"]),
                         ("storage_maintained", live, target))
        connection.stage.assert_called_once_with(target)
        connection.apply.assert_called_once_with(phase, image, image, image, policy, storage_only=True)
        for call in connection.capacity.call_args_list:
            self.assertEqual(call.args, (target, 0, 1))
        self.assertEqual(connection.preflight.call_count, 2)
        self.assertEqual(main.call_count, 3)
        for operation in (verify, command, connection.transfer, connection.install_tooling):
            operation.assert_not_called()

    def test_freshness_requires_private_daily_verified_pair_and_known_journal(self):
        now = datetime.datetime(2026, 11, 28, 12, tzinfo=datetime.timezone.utc)
        with tempfile.TemporaryDirectory() as temporary, patch.object(capacity, "STAGE_OWNER_UID", os.getuid()):
            root = Path(temporary)
            pair = root / "backups/releases/20261128T060000Z-aaaaaaaaaaaa-bbbbbbbb"
            pair.mkdir(parents=True, mode=0o700)
            for name in ("database.dump", "uploads.tar.gz"):
                path = pair / name
                path.write_bytes(b"fixture")
                path.chmod(0o600)
            marker = pair / "verified.json"
            record = {"schema_version": 1, "kind": "daily", "sha": "a"*40,
                      "captured_at": (now - datetime.timedelta(hours=6)).isoformat(),
                      "verified_at": (now - datetime.timedelta(hours=5)).isoformat(),
                      "database_dump_sha256": "d"*64, "uploads_archive_sha256": "e"*64,
                      "migration_fingerprint": "f"*64, "schema_sha256": "1"*64}
            def write(path, content):
                path.write_text(json.dumps(content))
                path.chmod(0o600)
            for key, invalid in (("kind", "release"), ("migration_fingerprint", "bad"),
                                 ("captured_at", (now - datetime.timedelta(hours=25)).isoformat()),
                                 ("verified_at", (now + datetime.timedelta(hours=1)).isoformat())):
                write(marker, {**record, key: invalid})
                self.assertFalse(capacity.has_fresh_daily_backup(root, now))
            write(marker, record)
            self.assertTrue(capacity.has_fresh_daily_backup(root, now))
            (pair / "database.dump").chmod(0o644)
            self.assertFalse(capacity.has_fresh_daily_backup(root, now))

            capacity.check_backup_journal(root)
            for state in ("stopping", "stopped", "verifying", "unknown"):
                write(root / "backup-state.json", {"schema_version": 1, "status": state})
                with self.assertRaisesRegex(capacity.CapacityError, "daily_backup_interrupted"):
                    capacity.check_backup_journal(root)
            write(root / "backup-state.json", {"schema_version": 1, "status": "daily_backup_completed"})
            capacity.check_backup_journal(root)

    def test_normal_release_blocks_before_image_storage_if_daily_pair_is_stale(self):
        target, live = "a"*40, "b"*40
        image = "sha256:" + "c"*64
        state = delivery.State(image, live, live)
        connection = Mock()
        connection.preflight.return_value = state
        connection.capacity.side_effect = delivery.CapacityBlocked("daily_backup_not_fresh", {})
        with patch.object(delivery, "assert_current_main"), patch.object(delivery, "ensure_commit"), \
                patch.object(delivery, "committed_file", return_value=b"synthetic"), \
                patch.object(delivery, "make_plan", return_value=[delivery.Phase(target, live, image)]), \
                patch.object(delivery, "storage_only_changes", return_value=False), \
                patch.object(delivery, "command") as command, \
                patch.object(delivery, "Connection", return_value=connection):
            report = delivery.deliver(target, {"shared_proxy_image": "synthetic"}, image)
        self.assertEqual(report["reason"], "daily_backup_not_fresh")
        connection.capacity.assert_called_once_with(target, 0, 1, fresh_daily=True)
        for operation in (command, connection.stage, connection.transfer, connection.apply):
            operation.assert_not_called()

    def test_daily_backup_executor_uses_current_image_only(self):
        target, live = "a"*40, "b"*40
        image = "sha256:" + "c"*64
        policy = {"shared_proxy_image": "synthetic", "legacy_image": "legacy", "placement_fallback": live}
        connection = Mock()
        connection.preflight.return_value = delivery.State(image, live, live)
        connection.capacity.return_value = {"minimum_space_margin_bytes": 1}
        connection.apply.return_value = {"status": "daily_backup_completed", "sha": live, "image": image}
        with patch.object(delivery, "assert_current_main") as main, patch.object(delivery, "is_ancestor", return_value=True), \
                patch.object(delivery, "Connection", return_value=connection), patch.object(delivery, "command") as cmd:
            report = delivery.daily_full_backup(target, policy)
        self.assertEqual(report["status"], "daily_backup_completed")
        connection.apply.assert_called_once_with(delivery.Phase(live, live, image), image, image, image,
                                                 policy, daily_full_backup=True)
        self.assertEqual(main.call_count, 3)
        for operation in (cmd, connection.transfer, connection.install_tooling):
            operation.assert_not_called()

    def test_pr_measurement_has_no_server_or_release_steps(self):
        sha = "a" * 40
        image = "sha256:" + "b" * 64
        env = {"GITHUB_ACTIONS": "true", "GITHUB_REPOSITORY": delivery.REPO,
               "GITHUB_EVENT_NAME": "pull_request", "GITHUB_SHA": sha}
        with tempfile.TemporaryDirectory() as root:
            summary = Path(root) / "summary"
            env["GITHUB_STEP_SUMMARY"] = str(summary)
            with patch.dict(os.environ, env, clear=True), patch.object(sys, "argv", ["runner", "--measure-image", image]), \
                    patch.object(delivery, "verify_local_image") as verify, patch.object(delivery, "command") as command, \
                    patch.object(delivery, "archive_bytes", return_value=42), patch.object(delivery, "Connection") as ssh, \
                    redirect_stdout(io.StringIO()):
                self.assertEqual(delivery.main(), 0)
                verify.assert_called_once_with(image, sha, sha)
                self.assertEqual(command.call_args.args[0][:3], ["docker", "save", "-o"])
                ssh.assert_not_called()
            text = summary.read_text()
            self.assertIn("Expanded archive: 42 bytes", text)
            self.assertIn("Ingest reserve if absent on server: 126 bytes", text)

    def test_failure_summary_keeps_pre_transfer_and_final_measurements(self):
        with tempfile.TemporaryDirectory() as root:
            summary = Path(root) / "summary"
            report = {"status": "blocked", "reason": "insufficient_pretransfer_space",
                      "storage_capacity": {"archive_bytes": 300, "minimum_space_margin_bytes": 600},
                      "storage_capacity_latest": {"archive_bytes": 0, "minimum_space_margin_bytes": -50}}
            with patch.dict(os.environ, {"GITHUB_STEP_SUMMARY": str(summary)}):
                delivery.job_summary(report)
            text = summary.read_text()
            self.assertIn("Reason: `insufficient_pretransfer_space`", text)
            self.assertIn("| Lowest filesystem headroom (bytes) | 600 |", text)
            self.assertIn("| Lowest filesystem headroom (bytes) | -50 |", text)
            self.assertIn("1 GiB warning margin", text)

    def test_block_reason_and_retention_metrics_are_allowlisted(self):
        raw = json.dumps({"status": "blocked", "reason": ["synthetic unrelated data"]}).encode()
        with self.assertRaisesRegex(delivery.CapacityBlocked, "capacity_reply_invalid"):
            delivery.capacity_reply(raw)
        self.assertIsNone(delivery.retention_reply({"storage_retention": {"status": "ok"}}))


if __name__ == "__main__":
    unittest.main()
