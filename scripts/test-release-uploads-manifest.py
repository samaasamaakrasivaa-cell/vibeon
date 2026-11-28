#!/usr/bin/env python3
"""Verify historical upload archive proofs against synthetic backups and Node."""
import ast
import gzip
import hashlib
import io
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "deploy"))

from release_uploads_manifest import uploads_tree_sha256


def backup(entries):
    uncompressed = io.BytesIO()
    with tarfile.open(fileobj=uncompressed, mode="w", format=tarfile.GNU_FORMAT) as archive:
        for name, kind, content in entries:
            member = tarfile.TarInfo(name)
            member.type = kind
            if kind in (tarfile.SYMTYPE, tarfile.LNKTYPE):
                member.linkname = content
                archive.addfile(member)
            elif kind == tarfile.REGTYPE:
                member.size = len(content)
                archive.addfile(member, io.BytesIO(content))
            else:
                archive.addfile(member)
    return uncompressed.getvalue()


def tree(archive):
    return uploads_tree_sha256(io.BytesIO(gzip.compress(archive)))


def file_entry(name, content=b"fixture"):
    return (name, tarfile.REGTYPE, content)


def directory_entry(name):
    return (name, tarfile.DIRTYPE, None)


class UploadManifestTests(unittest.TestCase):
    def test_empty_tree(self):
        self.assertEqual(tree(backup([directory_entry(".")])), hashlib.sha256().hexdigest())

    def test_directory_order_and_file_digest_match_historical_formats(self):
        entry_hash = hashlib.sha256(b"fixture").hexdigest()
        expected = (f"F\0/a\0{entry_hash}\0D\0/dir\0F\0/dir/nested\0{entry_hash}\0"
                    f"F\0/\U00010000\0{entry_hash}\0F\0/\ue000\0{entry_hash}\0")
        archive = backup([directory_entry("."), file_entry("./\ue000"), file_entry("./dir/nested"),
                          file_entry("./\U00010000"), directory_entry("./dir"), file_entry("a")])
        self.assertEqual(tree(archive), hashlib.sha256(expected.encode()).hexdigest())

    def test_rejects_duplicates_parent_ambiguity_links_and_other_types(self):
        for entries in (
            [directory_entry("."), file_entry("a"), file_entry("./a")],
            [directory_entry("."), file_entry("./../a")],
            [directory_entry("."), file_entry("/a")],
            [directory_entry("."), file_entry("./a//b")],
            [directory_entry("."), file_entry("./a/b")],
            [directory_entry("."), file_entry("a"), file_entry("a/b")],
            [directory_entry("."), ("ln", tarfile.SYMTYPE, "../elsewhere")],
            [directory_entry("."), ("ln", tarfile.LNKTYPE, "a")],
            [directory_entry("."), ("device", tarfile.CHRTYPE, None)],
            [directory_entry("."), ("unknown", b"Z", None)],
            [file_entry("./without_root")],
        ):
            with self.subTest(entries=entries), self.assertRaisesRegex(ValueError, "proof unavailable"):
                tree(backup(entries))

    def test_rejects_truncated_corrupt_or_appended_archive(self):
        archive = backup([directory_entry("."), file_entry("private-fixture")])
        for mutated in (archive[:1536], archive[:-1], archive + archive):
            with self.subTest(size=len(mutated)), self.assertRaisesRegex(ValueError, "proof unavailable"):
                tree(mutated)
        compressed = bytearray(gzip.compress(archive))
        compressed[-8] ^= 1
        with self.assertRaisesRegex(ValueError, "proof unavailable"):
            uploads_tree_sha256(io.BytesIO(compressed))

    @unittest.skipUnless(shutil.which("node") and shutil.which("tar"), "Node and tar required")
    def test_matches_real_historical_node_tree_digest(self):
        source = ast.parse((ROOT / "deploy/release-apply.py").read_text())
        expression = next(node.value for node in source.body if isinstance(node, ast.Assign)
                          and any(getattr(target, "id", "") == "FILES_JS" for target in node.targets))
        scanner = ast.literal_eval(expression).replace("walk('/files','')", "walk(process.argv[1],'')")
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            files = root / "files"
            files.mkdir()
            (files / "empty directory").mkdir()
            nested = files / "a nested directory"
            nested.mkdir()
            (nested / ("long-" + "name"*35)).write_bytes(b"historical synthetic test")
            (nested / "\U00010000").write_bytes(b"non-BMP")
            (nested / "\ue000").write_bytes(b"private use")
            (files / "empty file").touch()
            archive = root / "uploads.tar.gz"
            subprocess.run(["tar", "-czf", str(archive), "-C", str(files), "."], check=True, capture_output=True)
            result = subprocess.check_output(["node", "-e", scanner, str(files)], timeout=10)
            with archive.open("rb") as handle:
                self.assertEqual(uploads_tree_sha256(handle), json.loads(result)["sha256"])


if __name__ == "__main__":
    unittest.main()
