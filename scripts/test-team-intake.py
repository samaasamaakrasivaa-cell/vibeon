"""Synthetic TEAM-INTAKE-01 tests, including simultaneous claims against a local git ref."""

import concurrent.futures
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


SCRIPT = Path(__file__).with_name("team-intake.py")
SPEC = importlib.util.spec_from_file_location("team_intake", SCRIPT)
INTAKE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(INTAKE)

KEY = "TE-SYNTH-01"
CLAIM = "1" * 32
NEW_CLAIM = "2" * 32
HEAD = "a" * 40
MERGE = "b" * 40
BASE = "c" * 40
REQUEST = {"key": KEY, "source": "direct", "owner": "teacher-test", "claim_id": CLAIM}
CURRENT = {"key": KEY, "claim_id": CLAIM}
PROGRESS = {
    "stage": "publication", "next": "Verify the deployment and site.", "branch": "codex/teacher/synth-01",
    "base_sha": BASE, "head_sha": HEAD, "merge_sha": MERGE, "pr": 12, "test_run": 101,
}


def checkpointed():
    receipt = INTAKE.transform("claim", REQUEST)
    return INTAKE.transform("checkpoint", CURRENT | {"issue": 11, "progress": PROGRESS}, receipt)


def release_proof():
    return {
        "review": {"sha": HEAD, "comment": 123, "result": "success"},
        "ci": {"sha": HEAD, "run": 123, "result": "success"},
        "delivery": {"sha": MERGE, "run": 124, "result": "success"},
        "site_sha": MERGE,
        "owner_note": "Для владельца: Кабинет ученика — Видит пробную карточку.",
    }


class TeamIntakeTest(unittest.TestCase):
    def test_direct_repeat_and_pm_collision_use_one_receipt(self):
        receipt = checkpointed()
        self.assertEqual(INTAKE.transform("claim", REQUEST | {"issue": 11}, receipt), receipt)
        with self.assertRaisesRegex(ValueError, "already_claimed"):
            INTAKE.transform("claim", REQUEST | {"source": "pm", "owner": "pm-test", "claim_id": NEW_CLAIM}, receipt)
        with self.assertRaisesRegex(ValueError, "issue_already_bound"):
            INTAKE.transform("claim", REQUEST | {"issue": 99}, receipt)

    def test_checkpoint_preserves_resume_state_and_bound_references(self):
        receipt = checkpointed()
        intent = {"stage": "blocked", "next": "Await fixture status."}
        resumed = INTAKE.transform("checkpoint", CURRENT | {"progress": intent}, receipt)
        self.assertEqual(resumed["progress"], PROGRESS | intent)
        self.assertEqual(resumed["issue"], 11)
        with self.assertRaisesRegex(ValueError, "issue_already_bound"):
            INTAKE.transform("checkpoint", CURRENT | {"issue": 99, "progress": intent}, resumed)
        with self.assertRaisesRegex(ValueError, "branch_or_pr_already_bound"):
            INTAKE.transform("checkpoint", CURRENT | {"progress": intent | {"pr": 99}}, resumed)

    def test_architect_handoff_freezes_writer_until_explicit_acceptance(self):
        receipt = checkpointed()
        approval = {"to": "tech-lead-test", "approval_comment": 77}
        request = CURRENT | {"owner": "tech-lead-test", "new_claim_id": NEW_CLAIM, "approval_comment": 77}
        with self.assertRaisesRegex(ValueError, "handoff_not_confirmed"):
            INTAKE.transform("accept", request, receipt)
        frozen = INTAKE.transform("handoff", CURRENT | approval, receipt)
        with self.assertRaisesRegex(ValueError, "claim_not_active"):
            INTAKE.transform("claim", REQUEST, frozen)
        with self.assertRaisesRegex(ValueError, "handoff_pending"):
            INTAKE.transform("checkpoint", CURRENT | {"progress": PROGRESS}, frozen)
        with self.assertRaisesRegex(ValueError, "handoff_not_confirmed"):
            INTAKE.transform("accept", request | {"approval_comment": 78}, frozen)
        new = INTAKE.transform("accept", request, frozen)
        self.assertEqual(new["progress"], receipt["progress"])
        self.assertEqual(new["issue"], receipt["issue"])
        self.assertEqual(new["claim_id"], NEW_CLAIM)
        with self.assertRaisesRegex(ValueError, "claim_changed"):
            INTAKE.transform("checkpoint", CURRENT | {"progress": PROGRESS}, new)
        same_owner = INTAKE.transform("handoff", CURRENT | approval | {"to": receipt["owner"]}, receipt)
        resumed = INTAKE.transform("accept", request | {"owner": receipt["owner"]}, same_owner)
        self.assertEqual((resumed["owner"], resumed["claim_id"]), (receipt["owner"], NEW_CLAIM))

    def test_release_requires_exact_checks_integrated_sha_and_site(self):
        receipt = checkpointed()
        release = release_proof()
        result = INTAKE.transform("release", CURRENT | {"release": release}, receipt)
        self.assertEqual(result["release"], release)
        self.assertEqual(result["issue"], 11)
        for field in ("review", "ci"):
            for proof in ({"sha": BASE}, {"result": "failure"}):
                with self.subTest(field=field, proof=proof), self.assertRaises(ValueError):
                    INTAKE.transform("release", CURRENT | {"release": release | {field: release[field] | proof}}, receipt)
        cases = {
            "missing review": {name: value for name, value in release.items() if name != "review"},
            "unrelated but deployed commit": release | {"delivery": release["delivery"] | {"sha": BASE}, "site_sha": BASE},
            "site mismatch": release | {"site_sha": BASE},
            "publication phrase missing": release | {"owner_note": "Published."},
            "publication category unknown": release | {"owner_note": "Для владельца: Прочее — Выпущено."},
        }
        for name, candidate in cases.items():
            with self.subTest(name=name), self.assertRaises(ValueError):
                INTAKE.transform("release", CURRENT | {"release": candidate}, receipt)
        with self.assertRaisesRegex(ValueError, "already_released"):
            INTAKE.transform("checkpoint", CURRENT | {"progress": PROGRESS}, result)

    def test_receipt_cli_refuses_a_corrupt_existing_file(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            request = folder / "request.json"
            request.write_text(json.dumps(REQUEST), encoding="utf-8")
            receipt = folder / "receipt.json"
            receipt.write_text("null", encoding="utf-8")
            run = subprocess.run([sys.executable, str(SCRIPT), "claim", str(request), str(receipt)],
                                 check=False, capture_output=True, text=True)
            self.assertEqual(run.returncode, 1)
            self.assertEqual(run.stdout, "")
            self.assertEqual(run.stderr, "invalid_receipt\n")

    def test_concurrent_claims_commit_one_winner_with_expected_head(self):
        ref = "refs/heads/codex/coordination/team-intake"
        with tempfile.TemporaryDirectory() as temporary:
            repo = Path(temporary) / "bare"
            subprocess.run(["git", "init", "--quiet", "--bare", str(repo)], check=True)

            def git(*args, data=None, check=True):
                return subprocess.run(["git", "-C", str(repo), "-c", "user.name=VibeOn Test",
                                       "-c", "user.email=test@example.invalid", *args],
                                      input=data, check=check, capture_output=True, text=True)

            empty = git("mktree", data="").stdout.strip()
            original = git("commit-tree", empty, "-m", "Synthetic registry").stdout.strip()
            git("update-ref", ref, original)

            def prepare(request):
                receipt = INTAKE.transform("claim", request)
                blob = git("hash-object", "-w", "--stdin", data=json.dumps(receipt)).stdout.strip()
                tree = git("mktree", data=f"100644 blob {blob}\t{KEY}.json\n").stdout.strip()
                return git("commit-tree", tree, "-p", original, "-m", "Claim").stdout.strip()

            pm = REQUEST | {"source": "pm", "owner": "pm-test", "claim_id": NEW_CLAIM}
            commits = [prepare(request) for request in (REQUEST, pm)]
            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
                results = list(pool.map(lambda oid: git("update-ref", ref, oid, original, check=False), commits))
            self.assertEqual(sorted(result.returncode == 0 for result in results), [False, True])
            winner = commits[next(i for i, result in enumerate(results) if result.returncode == 0)]
            self.assertEqual(git("rev-parse", ref).stdout.strip(), winner)
            receipt = json.loads(git("show", f"{ref}:{KEY}.json").stdout)
            loser = pm if receipt["source"] == "direct" else REQUEST
            with self.assertRaisesRegex(ValueError, "already_claimed"):
                INTAKE.transform("claim", loser, receipt)


if __name__ == "__main__":
    unittest.main()
