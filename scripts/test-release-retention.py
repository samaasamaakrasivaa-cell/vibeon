#!/usr/bin/env python3
"""Synthetic VibeOn retention safeguards; no server or Docker dependency."""
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
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

    def backup(self, day, record, marked=True, checksummed=False):
        path = self.root / "backups" / "releases" / f"202611{day:02}T010101Z-{record['sha'][:12]}-abcd1234"
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
        self.rotate(protected=(row(6)["image"],))
        self.assertEqual(self.removed, [])

    def test_backup_plan_counts_only_verified_excess_without_deleting(self):
        paths = [self.backup(i, row(i), marked=i != 5) for i in range(1, 6)]
        pinned = {**row(50), "sha": next(iter(retention.PINS))}
        paths.append(self.backup(1, pinned))
        report = self.rotate()
        self.assertEqual(report["verified_full_backups"], 5)
        self.assertEqual(report["full_backup_candidates"], 1)
        self.assertEqual(report["full_backup_candidate_bytes"], 11)
        self.assertTrue(all(path.exists() for path in paths))

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
