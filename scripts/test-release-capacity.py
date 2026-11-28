#!/usr/bin/env python3
"""Capacity checks with synthetic files, devices and Docker metadata."""
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
                patch.object(delivery, "Connection", return_value=connection):
            report = delivery.deliver(target, {"shared_proxy_image": "synthetic"}, image)
        self.assertEqual(report["reason"], "insufficient_pretransfer_space")
        self.assertEqual(report["storage_capacity"], {"minimum_space_margin_bytes": -1})
        for operation in (command, connection.stage, connection.transfer, connection.apply):
            operation.assert_not_called()

    def test_block_reason_and_retention_metrics_are_allowlisted(self):
        raw = json.dumps({"status": "blocked", "reason": ["synthetic unrelated data"]}).encode()
        with self.assertRaisesRegex(delivery.CapacityBlocked, "capacity_reply_invalid"):
            delivery.capacity_reply(raw)
        self.assertIsNone(delivery.retention_reply({"storage_retention": {"status": "ok"}}))


if __name__ == "__main__":
    unittest.main()
