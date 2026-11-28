#!/usr/bin/env python3
"""Synthetic VibeOn retention safeguards; no server or Docker dependency."""
import datetime
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
import tarfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "deploy"))
import release_retention as retention


def row(i):
    return {"image": f"sha256:{i:064x}", "sha": f"{i:040x}"}


def tag(record):
    return retention.TAG_PREFIX + record["image"].removeprefix("sha256:")


class RetentionTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.history = [row(i) for i in range(1, 9)]
        self.current = row(9)
        self.removed, self.used, self.foreign, self.bad_digest = [], set(), set(), set()
        self.write(self.root / "release-image-retention.json", self.history)

    def write(self, path, value):
        path.write_text(json.dumps(value))

    def docker(self, action, command, *args):
        if (action, command) == ("image", "ls"):
            return "\n".join(map(tag, self.history + [row(999)]))
        if (action, command) == ("image", "inspect"):
            (record,) = [item for item in self.history if tag(item) == args[-1]]
            digest, sha = record["image"], record["sha"]
            tags = [tag(record), "unrelated:keep"] if digest in self.foreign else [tag(record)]
            namespace = "unrelated" if digest in self.bad_digest else "vibeon-retained"
            labels = {"org.opencontainers.image.revision": sha, "io.vibeon.recipe-revision": sha}
            return " ".join(map(json.dumps, (digest, tags, [namespace + "@" + digest], labels)))
        if (action, command) == ("ps", "--all"):
            return "running-or-stopped" if args[-1].removeprefix("ancestor=") in self.used else ""
        if (action, command) == ("image", "rm"):
            self.assertEqual(args[0], "--no-prune")
            self.removed.append(args[-1])
            return ""
        self.fail((action, command, args))

    def rotate(self, protected=()):
        return retention.rotate(self.root, self.current["image"], self.current["sha"], protected,
                                docker=self.docker, write_json=self.write)

    def backup(self, day, record, marked=True, checksummed=False, hour=1):
        path = self.root / "backups" / "releases" / f"202611{day:02}T{hour:02}0101Z-{record['sha'][:12]}-abcd1234"
        path.mkdir(parents=True, mode=0o700)
        (path / "database.dump").write_bytes(b"dump")
        (path / "uploads.tar.gz").write_bytes(b"archive")
        if marked:
            marker = {**record, "schema_version": 1, "rollback_image": record["image"],
                      "uploads_sha256": "a" * 64, "database_dump_sha256": hashlib.sha256(b"dump").hexdigest()}
            if checksummed:
                marker["uploads_archive_sha256"] = hashlib.sha256(b"archive").hexdigest()
            self.write(path / "verified.json", marker)
        return path

    def test_removes_only_bounded_number_of_managed_old_images(self):
        report = self.rotate()
        self.assertEqual(self.removed, [tag(r) for r in self.history[:3]])
        self.assertEqual(report["images_removed"], 3)

    def test_keeps_foreign_used_pinned_and_recovery_images(self):
        pinned = next(iter(retention.PINS))
        self.history[0]["sha"] = pinned
        self.write(self.root / "release-image-retention.json", self.history)
        self.used.add(row(2)["image"])
        self.foreign.add(row(3)["image"])
        self.bad_digest.add(row(4)["image"])
        self.backup(28, row(5))
        self.rotate(protected=(row(6)["image"], row(7)["image"]))
        self.assertEqual(self.removed, [tag(row(8))])
        self.assertNotIn(tag(self.current), self.removed)

    def test_backup_plan_counts_only_verified_excess_without_deleting(self):
        paths = [self.backup(i, row(i), marked=i != 5) for i in range(1, 6)]
        pinned = {**row(50), "sha": next(iter(retention.PINS))}
        paths.append(self.backup(1, pinned))
        verified, candidates, _ = retention.full_backup_plan(self.root)
        self.assertEqual(len(verified), 5)
        self.assertEqual([backup.bytes for backup in candidates], [11])
        with self.assertRaises(ValueError):
            self.rotate()
        self.assertTrue(all(path.exists() for path in paths))

    def test_keep_three_newest_and_exclude_future_receipts(self):
        for hour in (8, 9, 14, 15, 16, 17, 18):
            self.backup(23, row(hour), hour=hour)
        now = datetime.datetime(2026, 11, 23, 18, 2, tzinfo=datetime.timezone.utc)
        verified, old, _ = retention.full_backup_plan(self.root, now=now)
        self.assertEqual(len(verified), 7)
        self.assertEqual([backup.timestamp.hour for backup in old], [15, 14, 9, 8])

    def test_expires_only_old_verified_pairs_with_three_intact_replacements(self):
        old = self.backup(1, row(1))
        foreign = self.backup(2, row(2))
        (foreign / "foreign").write_text("leave alone")
        latest = [self.backup(i, row(i), checksummed=True) for i in range(21, 24)]
        report = self.rotate()
        self.assertEqual(report["full_backups_removed"], 1)
        self.assertEqual(report["full_backups_removed_bytes"], 11)
        self.assertFalse(old.exists())
        self.assertTrue(foreign.exists())
        self.assertTrue(all(entry.exists() for entry in latest))

    def test_daily_receipt_must_be_fresh_and_match_release_schema(self):
        current = self.backup(23, row(23), checksummed=True)
        marker = retention.load_json(current / "verified.json")
        captured = datetime.datetime(2026, 11, 23, 1, 1, 1, tzinfo=datetime.timezone.utc)
        marker.update(kind="daily", captured_at=captured.isoformat(), verified_at=captured.isoformat(),
                      migration_fingerprint="a" * 64, schema_sha256="b" * 64)
        self.write(current / "verified.json", marker)
        now = captured + datetime.timedelta(hours=12)
        self.assertEqual(retention.fresh_daily_backup(self.root, "a" * 64, "b" * 64, now), captured)
        self.assertIsNone(retention.fresh_daily_backup(self.root, "a" * 64, "c" * 64, now))
        self.assertIsNone(retention.fresh_daily_backup(self.root, "a" * 64, "b" * 64, now + datetime.timedelta(hours=13)))

    def test_legacy_restore_digest_proves_three_replacements(self):
        old = self.backup(1, row(1))
        for day in (21, 22, 23):
            current = self.backup(day, row(day))
            with tarfile.open(current / "uploads.tar.gz", "w:gz") as archive:
                root = tarfile.TarInfo(".")
                root.type = tarfile.DIRTYPE
                archive.addfile(root)
            marker = retention.load_json(current / "verified.json")
            marker["uploads_sha256"] = hashlib.sha256(b"").hexdigest()
            self.write(current / "verified.json", marker)
        self.assertEqual(self.rotate()["full_backups_removed"], 1)
        self.assertFalse(old.exists())

    def test_corrupt_replacement_preserves_every_backup_and_image(self):
        old = self.backup(1, row(1))
        latest = [self.backup(i, row(i), checksummed=True) for i in range(21, 24)]
        (latest[-1] / "uploads.tar.gz").write_bytes(b"corrupt")
        with self.assertRaises(ValueError):
            self.rotate()
        self.assertTrue(old.exists())
        self.assertEqual(self.removed, [])

    def test_shared_or_mounted_replacement_preserves_old_pair(self):
        old = self.backup(1, row(1))
        latest = [self.backup(i, row(i), checksummed=True) for i in range(21, 24)]
        for mount in (latest[1], latest[1].parent, latest[1].parent.parent):
            with patch.object(retention, "backup_mounts", return_value=[mount]):
                self.assertEqual(self.rotate()["full_backups_removed"], 0)
        source = latest[0] / "database.dump"
        target = latest[1] / "database.dump"
        target.unlink()
        os.link(source, target)
        self.assertEqual(self.rotate()["full_backups_removed"], 0)
        self.assertTrue(old.exists())

    def test_docker_failure_does_not_remove_newer_images(self):
        original = self.docker

        def fail_after_first(action, command, *args):
            if (action, command) == ("image", "rm") and self.removed:
                raise OSError
            return original(action, command, *args)

        self.docker = fail_after_first
        report = self.rotate()
        self.assertEqual((report["status"], report["images_removed"]), ("attention", 1))


if __name__ == "__main__":
    unittest.main()
