#!/usr/bin/env python3
"""Synthetic failure/recovery contracts; never connects to Docker or production."""
import importlib.util
import hashlib
import json
import os
from pathlib import Path
import signal
import tempfile
import unittest
from unittest.mock import patch

script = Path(__file__).resolve().parents[1] / "deploy/release-apply.py"
spec = importlib.util.spec_from_file_location("release_apply", script)
release_apply = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release_apply)
SHA = "a" * 40
FALLBACK_SHA = "b" * 40
CANDIDATE = "sha256:" + "c" * 64
FALLBACK = "sha256:" + "d" * 64
PREVIOUS = "sha256:" + "e" * 64
CONFIG = "f" * 64
SECRET = "sensitive-person@example.invalid SECRET 192.0.2.1"
MIGRATIONS = {"20261103194346_init": "1" * 64}


class FakeRelease(release_apply.Release):
    def __init__(self, root):
        super().__init__(SHA, CANDIDATE, FALLBACK_SHA, FALLBACK, CONFIG, PREVIOUS, root)
        self.events = []
        self.fail = None

    def inspect(self):
        self.events.append("inspect")
        if self.fail == "migration":
            raise release_apply.ReleaseError("migration_set_mismatch")
        self.app_id, self.db_id, self.current_image = "1" * 64, "2" * 64, PREVIOUS
        self.migrations = MIGRATIONS
        self.config_before = {"docker-compose.prod.yml": CONFIG, ".env": "9" * 64}

    def config_fingerprint(self):
        return self.config_before

    def live_migrations(self, _container):
        return MIGRATIONS

    def retain(self):
        self.events.append("retain")

    def stop(self):
        self.events.append("stop")
        self.stopped = True

    def backup(self):
        self.events.append("snapshot")
        if self.fail == "backup":
            raise release_apply.ReleaseError("database_backup_failed")
        if self.fail == "interrupt":
            raise KeyboardInterrupt()
        if self.fail == "private_error":
            raise RuntimeError(SECRET)
        self.resume_original()
        self.stopped = False
        self.events.append("restore_rehearsal")
        if self.fail == "restore":
            raise release_apply.ReleaseError("database_restore_verification_failed")

    def resume_original(self):
        self.events.append("resume_original")

    def verify(self, _app_id, image, _sha):
        self.events.append("verify_original" if image == PREVIOUS else "verify_candidate")

    def switch(self, image, sha):
        self.events.append("switch_candidate" if image == CANDIDATE else "switch_fallback")
        release_apply.atomic_json(self.override, self.override_content(image, sha))
        if image == CANDIDATE and self.fail == "switch":
            raise release_apply.ReleaseError("app_health_failed")


class ReleaseTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        root = Path(self.directory.name) / "deploy"
        root.mkdir()
        self.release = FakeRelease(root)

    def test_success_keeps_service_running_during_rehearsal(self):
        report = self.release.apply()
        self.assertEqual(report["status"], "released")
        self.assertEqual(self.release.events, ["inspect", "retain", "stop", "snapshot", "resume_original", "restore_rehearsal", "verify_original", "switch_candidate"])
        override = json.loads(self.release.override.read_text())
        self.assertEqual(override["services"]["app"]["image"], CANDIDATE)
        self.assertEqual(override["services"]["app"]["entrypoint"], ["node"])
        self.assertEqual(override["services"]["app"]["command"], ["server.js"])

    def test_retention_failure_does_not_rollback_a_published_release(self):
        self.release.retention_enabled = True
        with patch.object(self.release, "post_publication_retention", side_effect=OSError):
            report = self.release.apply()
        self.assertEqual(report["status"], "released")
        self.assertEqual(report["storage_retention"]["status"], "attention")
        self.assertEqual(json.loads(self.release.journal.read_text())["status"], "released")
        self.assertNotIn("switch_fallback", self.release.events)

    def prepare_storage_only(self, status="released"):
        self.release.image = self.release.rollback_image = PREVIOUS
        self.release.rollback_sha = SHA
        self.release.retention_enabled = True
        release_apply.atomic_json(self.release.override, self.release.override_content(PREVIOUS, SHA))
        release_apply.atomic_json(self.release.journal, {"schema_version": 1, "status": status, "sha": SHA,
                                  "image": PREVIOUS, "rollback_image": FALLBACK, "previous_image": CANDIDATE})
        return self.release.journal.read_bytes()

    def test_storage_only_preserves_running_app_journal_and_prior_images(self):
        before = self.prepare_storage_only()
        with patch.object(self.release, "post_publication_retention", return_value={"status": "ok"}) as rotate:
            report = self.release.maintain_storage()
        rotate.assert_called_once_with({FALLBACK, CANDIDATE})
        self.assertEqual(report["status"], "storage_maintained")
        self.assertEqual(self.release.journal.read_bytes(), before)
        for event in ("stop", "snapshot", "switch_candidate", "switch_fallback"):
            self.assertNotIn(event, self.release.events)

    def test_storage_only_rejects_pending_or_uncertain_release(self):
        self.prepare_storage_only("unchanged")
        with self.assertRaisesRegex(release_apply.ReleaseError, "storage_only_identity_invalid"):
            self.release.maintain_storage()
        self.assertEqual(self.release.events, [])

    def test_backup_failure_restarts_exact_original_before_any_override(self):
        self.release.fail = "backup"
        report = self.release.apply()
        self.assertEqual(report["status"], "unchanged")
        self.assertEqual(self.release.events[-1], "resume_original")
        self.assertFalse(self.release.override.exists())
        self.assertNotIn("switch_candidate", self.release.events)

    def test_restore_failure_keeps_restarted_original(self):
        self.release.fail = "restore"
        report = self.release.apply()
        self.assertEqual(report["status"], "unchanged")
        self.assertEqual(self.release.events.count("resume_original"), 1)
        self.assertNotIn("switch_candidate", self.release.events)

    def test_failed_switch_uses_compatible_image_with_current_data(self):
        self.release.fail = "switch"
        report = self.release.apply()
        self.assertEqual(report, {"status": "rolled_back", "reason": "app_health_failed", "sha": FALLBACK_SHA, "image": FALLBACK})
        self.assertEqual(self.release.events[-2:], ["switch_candidate", "switch_fallback"])
        override = json.loads(self.release.override.read_text())
        self.assertEqual(override["services"]["app"]["image"], FALLBACK)
        self.assertEqual(override["services"]["app"]["environment"]["APP_VERSION"], FALLBACK_SHA)
        self.assertEqual(set(override["services"]["app"]), {"image", "entrypoint", "command", "environment"})

    def test_migration_mismatch_never_stops_current_site(self):
        self.release.fail = "migration"
        with self.assertRaisesRegex(release_apply.ReleaseError, "migration_set_mismatch"):
            self.release.apply()
        self.assertEqual(self.release.events, ["inspect"])

    def test_concurrent_release_rejected_before_docker(self):
        with release_apply.release_lock(self.release.root):
            with self.assertRaisesRegex(release_apply.ReleaseError, "release_already_running"):
                self.release.apply()
        self.assertEqual(self.release.events, [])

    def test_interruption_restarts_original(self):
        self.release.fail = "interrupt"
        self.assertEqual(self.release.apply()["status"], "unchanged")
        self.assertEqual(self.release.events[-1], "resume_original")

    def test_signals_during_recovery_are_ignored_and_handlers_restored(self):
        self.release.fail = "backup"
        previous = {sig: signal.getsignal(sig) for sig in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP)}
        def must_not_run(_sig, _frame):
            raise AssertionError("signal_interrupted_recovery")
        def resume_with_signals():
            for sig in previous:
                os.kill(os.getpid(), sig)
            self.release.events.append("resume_original")
        try:
            for sig in previous:
                signal.signal(sig, must_not_run)
            with patch.object(self.release, "resume_original", side_effect=resume_with_signals):
                report = self.release.apply()
            self.assertEqual(report["status"], "unchanged")
            self.assertEqual(self.release.events[-1], "resume_original")
            for sig in previous:
                self.assertIs(signal.getsignal(sig), must_not_run)
        finally:
            for sig, handler in previous.items():
                signal.signal(sig, handler)

    def test_unexpected_errors_do_not_leak_data(self):
        self.release.fail = "private_error"
        report = self.release.apply()
        self.assertEqual(report["reason"], "release_failed")
        self.assertNotIn(SECRET, json.dumps(report))

    def test_helpers_cannot_start_application_or_reach_network(self):
        args = self.release.helper(CANDIDATE, "node", "type=volume,source=vibeon_uploads,target=/files,readonly")
        self.assertEqual(args[args.index("--network") + 1], "none")
        self.assertIn("--read-only", args)
        self.assertEqual(args[args.index("--pull") + 1], "never")
        self.assertNotIn(".env", " ".join(args))
        self.assertNotIn("server.js", args)

    def test_public_wrong_sha_is_rejected_without_response_disclosure(self):
        response = unittest.mock.MagicMock()
        response.__enter__.return_value = response
        response.status = 200
        response.read.return_value = json.dumps({"ok": True, "version": "dev", "private": SECRET}).encode()
        opener = unittest.mock.MagicMock()
        opener.open.return_value = response
        with patch.object(release_apply.urllib.request, "build_opener", return_value=opener):
            self.assertFalse(release_apply.public_health(SHA))

    def test_live_migrations_reject_unfinished_rollback_and_duplicates(self):
        row = {"name": next(iter(MIGRATIONS)), "checksum": "1" * 64, "finished": True, "rolled_back": False}
        self.assertEqual(release_apply.migration_map([row], live=True), MIGRATIONS)
        for rows in ([{**row, "finished": False}], [{**row, "rolled_back": True}], [row, row], [{**row, "checksum": SECRET}]):
            with self.subTest(rows=rows):
                with self.assertRaises(release_apply.ReleaseError):
                    release_apply.migration_map(rows, live=True)

    def test_non_digest_images_and_injected_inputs_are_rejected(self):
        with self.assertRaisesRegex(release_apply.ReleaseError, "invalid_release_identity"):
            release_apply.Release(SHA, "vibeon-app:latest", FALLBACK_SHA, FALLBACK, CONFIG, PREVIOUS)
        with self.assertRaisesRegex(release_apply.ReleaseError, "invalid_release_identity"):
            release_apply.Release(SECRET, CANDIDATE, FALLBACK_SHA, FALLBACK, CONFIG, PREVIOUS)

    def test_actual_backup_commands_restore_only_isolated_resources(self):
        self.release.inspect()
        self.release.db_image = "sha256:" + "8" * 64
        self.release.stopped = True
        (self.release.root / ".env").write_text(SECRET)
        (self.release.root / "docker-compose.prod.yml").write_text("synthetic")
        commands = []
        order = []
        manifest = {"sha256": "7" * 64, "count": 1, "bytes": 9}

        def command(args, **options):
            commands.append(args)
            if "pg_dump" in args:
                order.append("dump")
                options["stdout"].write(b"synthetic-private-dump")
            if "-czf" in args:
                order.append("uploads_snapshot")
                (self.release.backup_dir / "uploads.tar.gz").write_bytes(b"synthetic-archive")
            if "pg_restore" in args:
                order.append("restore")
                self.assertNotEqual(args[3], self.release.db_id)
                self.assertTrue(args[3].startswith("vibeon-restore-"))
                self.assertEqual(options["stdin"].read(), b"synthetic-private-dump")
            if args[:3] == ["docker", "volume", "rm"]:
                self.assertTrue(args[3].startswith("vibeon-restore-"))
            if args[:2] == ["docker", "run"]:
                self.assertEqual(args[args.index("--network") + 1], "none")
            if args[-1] == "SELECT pg_database_size(current_database());":
                return b"100"
            if args[:2] == ["docker", "info"]:
                return str(self.release.root).encode()
            if "psql" in args:
                return b"0"
            return b""

        def resume():
            order.append("resume_original")

        with (patch.object(release_apply, "command", command),
              patch.object(release_apply.shutil, "disk_usage", return_value=type("Usage", (), {"free": 1024 ** 3})()),
              patch.object(self.release, "files_manifest", return_value=manifest),
              patch.object(self.release, "resume_original", resume)):
            release_apply.Release.backup(self.release)
        self.assertEqual(order, ["dump", "uploads_snapshot", "resume_original", "restore"])
        self.assertFalse(self.release.stopped)
        self.assertTrue((self.release.backup_dir / "verified.json").exists())
        self.assertEqual((self.release.backup_dir / ".env").stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.release.backup_dir.stat().st_mode & 0o777, 0o700)
        self.assertTrue(any("pg_restore" in args for args in commands))

    def test_revision_written_only_after_successful_verification(self):
        def command(args, **_options):
            return b"1" * 64 if "--quiet" in args else b""
        with patch.object(release_apply, "command", command), patch.object(self.release, "verify", return_value=None):
            release_apply.Release.switch(self.release, CANDIDATE, SHA)
        self.assertEqual((self.release.root.parent / "REVISION").read_text(), SHA + "\n")

    def test_failed_verification_does_not_publish_revision(self):
        def command(args, **_options):
            return b"1" * 64 if "--quiet" in args else b""
        with patch.object(release_apply, "command", command), patch.object(self.release, "verify", side_effect=release_apply.ReleaseError("app_health_failed")):
            with self.assertRaises(release_apply.ReleaseError):
                release_apply.Release.switch(self.release, CANDIDATE, SHA)
        self.assertFalse((self.release.root.parent / "REVISION").exists())

    def test_proxy_allowance_requires_immutable_identity(self):
        with self.assertRaisesRegex(release_apply.ReleaseError, "invalid_proxy_identity"):
            release_apply.Release(SHA, CANDIDATE, FALLBACK_SHA, FALLBACK, CONFIG, PREVIOUS, allowed_proxy_image="caddy:2")

    def test_proxy_allowance_fails_closed_on_blocked_preflight(self):
        self.release.allowed_proxy_image = "sha256:" + "9" * 64
        with patch.object(release_apply, "json_command", return_value={"status": "blocked", "checks": {}}):
            with self.assertRaisesRegex(release_apply.ReleaseError, "proxy_preflight_blocked"):
                self.release.qualify_proxy()

    def test_proxy_allowance_binds_qualified_container_identity(self):
        self.release.allowed_proxy_image = "sha256:" + "9" * 64
        proxy_id = "8" * 64
        fingerprint = hashlib.sha256(proxy_id.encode()).hexdigest()
        report = {"status": "observed", "checks": {"app_image_id": PREVIOUS, "trusted_proxy_count": 1, "trusted_proxy_ids_sha256": fingerprint}}
        with patch.object(release_apply, "json_command", return_value=report) as observe:
            self.release.proxy_qualification = self.release.qualify_proxy()
        self.assertEqual(observe.call_args.kwargs["env"]["VIBEON_EXPECTED_PROXY_IMAGE"], self.release.allowed_proxy_image)
        self.release.bind_proxy_ids([proxy_id])
        with self.assertRaisesRegex(release_apply.ReleaseError, "proxy_preflight_identity_changed"):
            self.release.bind_proxy_ids(["7" * 64])
        with self.assertRaisesRegex(release_apply.ReleaseError, "proxy_preflight_identity_changed"):
            self.release.bind_proxy_ids([])

    def test_proxy_allowance_rejects_changed_current_application(self):
        self.release.allowed_proxy_image = "sha256:" + "9" * 64
        report = {"status": "observed", "checks": {"app_image_id": CANDIDATE, "trusted_proxy_count": 0, "trusted_proxy_ids_sha256": hashlib.sha256(b"").hexdigest()}}
        with patch.object(release_apply, "json_command", return_value=report):
            with self.assertRaisesRegex(release_apply.ReleaseError, "proxy_preflight_current_image_changed"):
                self.release.qualify_proxy()


if __name__ == "__main__":
    unittest.main()
