#!/usr/bin/env python3
"""Pure plan tests: no Docker, SSH, Git mutations or production access."""
import importlib.util
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

root = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("delivery_plan", root / "scripts/run-delivery.py")
delivery = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = delivery
spec.loader.exec_module(delivery)
POLICY = json.loads((root / "deploy/release-policy.json").read_text())
TARGET = "a" * 40
MANAGED = "b" * 40
IMAGE = "sha256:" + "d" * 64
tooling = types.ModuleType("tooling_test")
exec(compile(delivery.TOOLING_INSTALLER, "tooling_installer", "exec"), tooling.__dict__)


def ancestor(base, head):
    if base == head:
        return True
    return (base, head) in {
        (POLICY["placement_base"], TARGET), (POLICY["teacher_source"], TARGET),
        (POLICY["placement_fallback"], TARGET), (POLICY["placement_base"], MANAGED),
        (MANAGED, TARGET),
    }


class PlanTest(unittest.TestCase):
    def plan(self, state):
        return delivery.make_plan(POLICY, TARGET, state, ancestor)

    def test_bootstrap_preserves_te_before_placement_and_compatible_fallback(self):
        phases = self.plan(delivery.State(POLICY["legacy_image"], "unlabelled", "dev"))
        self.assertEqual(phases, [delivery.Phase(POLICY["teacher_source"], POLICY["legacy_source"]),
                                  delivery.Phase(TARGET, POLICY["placement_fallback"])])
        required_images = {p.source for p in phases} | {p.fallback_source for p in phases}
        self.assertEqual(len(required_images), 4)

    def test_mid_bootstrap_only_publishes_placement_with_compatible_fallback(self):
        phases = self.plan(delivery.State(IMAGE, POLICY["teacher_source"], POLICY["teacher_source"]))
        self.assertEqual(phases, [delivery.Phase(TARGET, POLICY["placement_fallback"])])
        self.assertIsNone(phases[0].fallback_image)

    def test_ordinary_release_preserves_exact_running_image(self):
        self.assertEqual(self.plan(delivery.State(IMAGE, MANAGED, MANAGED)),
                         [delivery.Phase(TARGET, MANAGED, IMAGE)])

    def test_placement_fallback_can_advance_without_rebuilding_running_rollback(self):
        fallback = POLICY["placement_fallback"]
        self.assertEqual(self.plan(delivery.State(IMAGE, fallback, fallback)),
                         [delivery.Phase(TARGET, fallback, IMAGE)])

    def test_current_target_is_noop(self):
        self.assertEqual(self.plan(delivery.State(IMAGE, TARGET, TARGET)), [])

    def test_unknown_unlabelled_or_disagreeing_versions_block(self):
        states = [delivery.State(IMAGE, "unlabelled", "dev"), delivery.State(IMAGE, MANAGED, "dev"),
                  delivery.State(IMAGE, MANAGED, TARGET), delivery.State(POLICY["legacy_image"], MANAGED, MANAGED),
                  delivery.State(IMAGE, POLICY["legacy_source"], POLICY["legacy_source"])]
        for state in states:
            with self.subTest(state=state), self.assertRaises(delivery.DeliveryError):
                self.plan(state)

    def test_unknown_labelled_branch_cannot_be_downgraded_to_te(self):
        with self.assertRaisesRegex(delivery.DeliveryError, "unknown_server_source"):
            self.plan(delivery.State(IMAGE, "c" * 40, "c" * 40))

    def test_managed_future_or_divergent_source_blocks_downgrade(self):
        def divergent(base, head):
            return (base == POLICY["placement_base"] and head in {MANAGED, TARGET})
        with self.assertRaisesRegex(delivery.DeliveryError, "target_would_downgrade"):
            delivery.make_plan(POLICY, TARGET, delivery.State(IMAGE, MANAGED, MANAGED), divergent)

    def test_stale_main_is_rejected(self):
        delivery.assert_current_main(TARGET, (TARGET + "\trefs/heads/main\n").encode())
        for reply in ((MANAGED + "\trefs/heads/main\n").encode(), b"", b"private unexpected response"):
            with self.assertRaisesRegex(delivery.DeliveryError, "main_changed_before_release"):
                delivery.assert_current_main(TARGET, reply)

    def test_enabled_policy_requires_exact_reviewed_proxy(self):
        with self.assertRaisesRegex(delivery.DeliveryError, "reviewed_proxy_identity_required"):
            delivery.validate_policy({**POLICY, "enabled": True, "shared_proxy_image": None})
        delivery.validate_policy({**POLICY, "enabled": True, "shared_proxy_image": IMAGE})

    def test_blocked_preflight_or_missing_health_never_becomes_release_state(self):
        checks = {"app_image_id": IMAGE, "app_revision": MANAGED, "health_version": MANAGED, "health_ok": True}
        valid = {"schema_version": 1, "read_only": True, "status": "observed", "checks": checks}
        self.assertEqual(delivery.preflight_state(valid), delivery.State(IMAGE, MANAGED, MANAGED))
        for report in ({**valid, "status": "blocked"}, {**valid, "checks": {**checks, "health_ok": False}}):
            with self.assertRaises(delivery.DeliveryError):
                delivery.preflight_state(report)

    def test_tooling_known_old_and_exact_new_are_idempotent(self):
        old = {name: "1" * 64 for name in delivery.TOOLING_NAMES}
        new = {name: "2" * 64 for name in delivery.TOOLING_NAMES}
        self.assertEqual(tooling.validate_tooling_hashes(old, new, old), sorted(delivery.TOOLING_NAMES))
        self.assertEqual(tooling.validate_tooling_hashes(new, new, old), [])
        current = {**old, "vibeon.sh": new["vibeon.sh"]}
        self.assertEqual(tooling.validate_tooling_hashes(current, new, old), ["attach-proxy.sh"])

    def test_tooling_validates_both_before_any_file_write(self):
        # Local synthetic files only. Unknown second helper cannot partially
        # update the valid first helper or create a backup of private content.
        with tempfile.TemporaryDirectory() as directory:
            root, stage = Path(directory) / "root", Path(directory) / "stage"
            root.mkdir(); stage.mkdir()
            old = {name: hashlib.sha256(b"known original").hexdigest() for name in delivery.TOOLING_NAMES}
            approved = {name: hashlib.sha256(b"approved replacement").hexdigest() for name in delivery.TOOLING_NAMES}
            for name in delivery.TOOLING_NAMES:
                (root / name).write_bytes(b"known original" if name == "vibeon.sh" else b"unknown private helper")
                (stage / name).write_bytes(b"approved replacement")
            with patch.object(tooling, "atomic") as writer:
                with self.assertRaisesRegex(ValueError, "unknown_legacy_tooling"):
                    tooling.install(root, stage, TARGET, old, approved)
                writer.assert_not_called()
            self.assertEqual((root / "vibeon.sh").read_bytes(), b"known original")
            self.assertFalse((root / "backups").exists())

    def test_tooling_rejects_unapproved_staged_bytes_before_write(self):
        with tempfile.TemporaryDirectory() as directory:
            root, stage = Path(directory) / "root", Path(directory) / "stage"
            root.mkdir(); stage.mkdir()
            old = {name: hashlib.sha256(b"old").hexdigest() for name in delivery.TOOLING_NAMES}
            approved = {name: hashlib.sha256(b"new").hexdigest() for name in delivery.TOOLING_NAMES}
            for name in delivery.TOOLING_NAMES:
                (root / name).write_bytes(b"old")
                (stage / name).write_bytes(b"truncated")
            with patch.object(tooling, "atomic") as writer:
                with self.assertRaisesRegex(ValueError, "staged_tooling_hash_mismatch"):
                    tooling.install(root, stage, TARGET, old, approved)
                writer.assert_not_called()


if __name__ == "__main__":
    unittest.main()
