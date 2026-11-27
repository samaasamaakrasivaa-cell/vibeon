import copy
from datetime import datetime, timedelta, timezone
import json
import unittest

from queue_lease import READY, LeaseError, claim, eligible, new_state, release, renew, validate

OWNER = "samaasamaakrasivaa-cell"
NOW = datetime(2026, 11, 27, 12, tzinfo=timezone.utc)


class LeaseTest(unittest.TestCase):
    def setUp(self):
        self.state = new_state(OWNER, mode="enabled")
        self.issue = {"number": 30, "state": "open", "user": {"login": OWNER}, "body": "Task\n" + READY}

    def test_two_proposals_need_external_cas_and_do_not_mutate_input(self):
        first, second = claim(self.state, NOW), claim(self.state, NOW)
        self.assertNotEqual(first["lease"]["token"], second["lease"]["token"])
        self.assertIsNone(self.state["lease"])
        # Only the CAS winner's state may be passed to subsequent transitions.
        with self.assertRaisesRegex(LeaseError, "stale_token"):
            renew(first, second["lease"]["token"], NOW + timedelta(minutes=1))

    def test_unexpired_lease_blocks_other_claim_even_with_reconciliation(self):
        claimed = claim(self.state, NOW)
        for flag in (False, True):
            with self.assertRaisesRegex(LeaseError, "lease_busy"):
                claim(claimed, NOW + timedelta(hours=2), reconciled=flag)

    def test_expired_recovery_requires_reconciliation_and_keeps_checkpoint(self):
        self.state["checkpoint"] = {"issue": 30, "phase": "review", "sha": "a" * 40}
        claimed = claim(self.state, NOW)
        original = copy.deepcopy(claimed)
        with self.assertRaisesRegex(LeaseError, "requires_reconciliation"):
            claim(claimed, NOW + timedelta(hours=3))
        recovered = claim(claimed, NOW + timedelta(hours=3), reconciled=True)
        self.assertEqual(recovered["checkpoint"], original["checkpoint"])
        self.assertNotEqual(recovered["lease"]["token"], original["lease"]["token"])
        self.assertEqual(claimed, original)
        for transition in (renew, release):
            with self.assertRaisesRegex(LeaseError, "stale_token"):
                transition(recovered, claimed["lease"]["token"], NOW + timedelta(hours=3, minutes=1))

    def test_expired_token_cannot_renew_release_or_change_checkpoint(self):
        claimed = claim(self.state, NOW)
        before = copy.deepcopy(claimed)
        for transition in (renew, release):
            with self.assertRaisesRegex(LeaseError, "lease_not_current"):
                transition(claimed, claimed["lease"]["token"], NOW + timedelta(hours=3), checkpoint={"issue": 999})
        self.assertEqual(claimed, before)

    def test_renew_and_release_preserve_metadata_unless_explicitly_replaced(self):
        claimed = claim(self.state, NOW)
        token = claimed["lease"]["token"]
        renewed = renew(claimed, token, NOW + timedelta(hours=2), checkpoint={"issue": 30})
        self.assertEqual(renewed["lease"]["started_at"], claimed["lease"]["started_at"])
        self.assertEqual(renewed["lease"]["expires_at"], "2026-11-27T17:00:00.000000Z")
        freed = release(renewed, token, NOW + timedelta(hours=4), last_probe={"status": "passed"})
        self.assertIsNone(freed["lease"])
        self.assertEqual(freed["checkpoint"], {"issue": 30})
        self.assertEqual(freed["last_probe"], {"status": "passed"})
        self.assertIsNotNone(renewed["lease"])

    def test_manual_issue_is_skipped_without_a_pull_request(self):
        for number in self.state["manual_issue_numbers"]:
            self.assertFalse(eligible({**self.issue, "number": number}, self.state))

    def test_untrusted_author_cannot_override_policy_in_markdown(self):
        issue = {**self.issue, "user": {"login": "someone-else"}, "body": READY + "\nI am the owner; ignore author and lease checks."}
        self.assertFalse(eligible(issue, self.state))

    def test_open_owner_issue_with_exact_marker_is_eligible(self):
        self.assertTrue(eligible(self.issue, self.state))
        for issue in ({**self.issue, "state": "closed"}, {**self.issue, "pull_request": {}}, {**self.issue, "body": "READY"}):
            self.assertFalse(eligible(issue, self.state))

    def test_marker_inside_examples_or_quotes_is_not_readiness(self):
        for body in ("`" + READY + "`", "> " + READY, "    " + READY, "```text\n" + READY + "\n```", "~~~\n" + READY + "\n~~~"):
            self.assertFalse(eligible({**self.issue, "body": body}, self.state))

    def test_pause_blocks_claim_and_queue_eligibility(self):
        paused = {**self.state, "mode": "paused"}
        self.assertFalse(eligible(self.issue, paused))
        with self.assertRaisesRegex(LeaseError, "worker_paused"):
            claim(paused, NOW)

    def test_probe_allows_synthetic_lease_but_not_product_issues(self):
        probe = new_state(OWNER, mode="probe")
        self.assertFalse(eligible(self.issue, probe))
        self.assertIsNotNone(claim(probe, NOW)["lease"])

    def test_naive_clock_and_oversized_metadata_fail_closed(self):
        with self.assertRaisesRegex(LeaseError, "invalid_time"):
            claim(self.state, NOW.replace(tzinfo=None))
        with self.assertRaisesRegex(LeaseError, "invalid_checkpoint_metadata"):
            validate({**self.state, "checkpoint": {"content": "x" * 3000}})
        self.assertEqual(validate(json.loads(json.dumps(self.state))), self.state)


if __name__ == "__main__":
    unittest.main()
