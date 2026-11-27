"""Prepare a TEAM-INTAKE-01 receipt. The caller commits it through an expected-head CAS."""

import argparse
import json
import re
from pathlib import Path


KEY = re.compile(r"[A-Z0-9]+(?:-[A-Z0-9]+)*")
OWNER = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")
CLAIM = re.compile(r"[0-9a-f]{32}")
SHA = re.compile(r"[0-9a-f]{40}")
BRANCH = re.compile(r"codex/[a-z0-9][a-z0-9-]*(?:/[a-z0-9][a-z0-9-]*)+")
STAGES = {"registered", "implementation", "review", "integration", "publication", "blocked"}
RECEIPT_FIELDS = {"version", "key", "source", "owner", "claim_id", "issue", "progress", "handoff", "release"}
PROGRESS_FIELDS = {"branch", "base_sha", "head_sha", "merge_sha", "pr", "test_run"}
OWNER_NOTE_PREFIX = "Для владельца: "
RELEASE_SECTIONS = {
    "Placement Test", "Roadmap и прогресс", "Кабинет преподавателя и расписание", "Кабинет ученика",
    "Уроки и конструктор", "Домашние задания", "Словарь и тренировки", "Финансы", "Стабильность и безопасность",
}


def require(condition, code):
    if not condition:
        raise ValueError(code)


def fields(value, required, optional=frozenset()):
    require(isinstance(value, dict) and required <= value.keys() <= required | optional, "invalid_fields")


def matches(pattern, value, limit=64):
    return isinstance(value, str) and len(value) <= limit and pattern.fullmatch(value) is not None


def number(value):
    return type(value) is int and value > 0


def public_line(value, limit):
    return isinstance(value, str) and 0 < len(value) <= limit and value == value.strip() and value.isprintable()


def valid_progress(progress):
    fields(progress, {"stage", "next"}, PROGRESS_FIELDS)
    require(isinstance(progress["stage"], str) and progress["stage"] in STAGES, "invalid_stage")
    require(public_line(progress["next"], 200), "invalid_next_step")
    for name in ("base_sha", "head_sha", "merge_sha"):
        if name in progress:
            require(matches(SHA, progress[name]), "invalid_sha")
    if "branch" in progress:
        require(matches(BRANCH, progress["branch"], 120), "invalid_branch")
    for name in ("pr", "test_run"):
        if name in progress:
            require(number(progress[name]), "invalid_reference")


def valid_handoff(handoff):
    fields(handoff, {"to", "approval_comment"})
    require(matches(OWNER, handoff["to"]), "invalid_owner")
    require(number(handoff["approval_comment"]), "missing_architect_confirmation")


def valid_release(release, progress):
    fields(release, {"review", "ci", "delivery", "site_sha", "owner_note"})
    for name, reference in (("review", "comment"), ("ci", "run"), ("delivery", "run")):
        proof = release[name]
        fields(proof, {"sha", reference, "result"})
        require(matches(SHA, proof["sha"]) and number(proof[reference]) and proof["result"] == "success",
                "release_proof_incomplete")
    require(progress is not None and progress["stage"] == "publication" and "pr" in progress, "publication_not_checkpointed")
    require(release["review"]["sha"] == release["ci"]["sha"] == progress.get("head_sha"), "review_or_ci_not_on_pr_head")
    require(release["delivery"]["sha"] == progress.get("merge_sha"), "delivery_not_on_integrated_sha")
    require(release["site_sha"] == release["delivery"]["sha"], "site_not_on_released_sha")
    note = release["owner_note"]
    require(public_line(note, 240) and note.startswith(OWNER_NOTE_PREFIX), "invalid_owner_note")
    section, _, change = note.removeprefix(OWNER_NOTE_PREFIX).partition(" — ")
    require(section in RELEASE_SECTIONS and public_line(change, 240), "invalid_owner_note")


def valid_receipt(receipt):
    fields(receipt, RECEIPT_FIELDS)
    require(type(receipt["version"]) is int and receipt["version"] == 1, "unknown_version")
    require(matches(KEY, receipt["key"]), "invalid_key")
    require(receipt["source"] in ("direct", "pm"), "invalid_source")
    require(matches(OWNER, receipt["owner"]) and matches(CLAIM, receipt["claim_id"]), "invalid_claim")
    require(receipt["issue"] is None or number(receipt["issue"]), "invalid_issue")
    if receipt["progress"] is not None:
        require(receipt["issue"] is not None, "issue_required")
        valid_progress(receipt["progress"])
    if receipt["handoff"] is not None:
        require(receipt["progress"] is not None and receipt["release"] is None, "checkpoint_required_for_handoff")
        valid_handoff(receipt["handoff"])
    if receipt["release"] is not None:
        valid_release(receipt["release"], receipt["progress"])


def claim(request, receipt):
    fields(request, {"key", "source", "owner", "claim_id"}, {"issue"})
    require(request["source"] in ("direct", "pm"), "invalid_source")
    if receipt is not None:
        require(all(receipt[name] == request[name] for name in ("key", "owner", "claim_id")), "already_claimed")
        require("issue" not in request or receipt["issue"] == request["issue"], "issue_already_bound")
        require(receipt["handoff"] is None and receipt["release"] is None, "claim_not_active")
        return receipt
    return {
        "version": 1, "key": request["key"], "source": request["source"], "owner": request["owner"],
        "claim_id": request["claim_id"], "issue": request.get("issue"), "progress": None, "handoff": None, "release": None,
    }


def checkpoint(request, receipt):
    fields(request, {"key", "claim_id", "progress"}, {"issue"})
    issue = request.get("issue", receipt["issue"])
    require(number(issue) and receipt["issue"] in (None, issue), "issue_already_bound_or_missing")
    previous = receipt["progress"] or {}
    fields(request["progress"], {"stage", "next"}, PROGRESS_FIELDS)
    progress = previous | request["progress"]
    for name in ("branch", "pr"):
        require(name not in previous or previous[name] == progress[name], "branch_or_pr_already_bound")
    return receipt | {"issue": issue, "progress": progress}


def transform(action, request, receipt=None):
    if receipt is not None:
        valid_receipt(receipt)
    if action == "claim":
        result = claim(request, receipt)
    else:
        require(receipt is not None and isinstance(request, dict) and request.get("key") == receipt["key"], "receipt_key_mismatch")
        require(request.get("claim_id") == receipt["claim_id"], "claim_changed")
        require(receipt["release"] is None, "already_released")
        if action == "accept":
            fields(request, {"key", "claim_id", "owner", "new_claim_id", "approval_comment"})
            approval = {"to": request["owner"], "approval_comment": request["approval_comment"]}
            require(receipt["handoff"] == approval, "handoff_not_confirmed")
            require(request["new_claim_id"] != receipt["claim_id"], "handoff_requires_new_claim")
            result = receipt | {"handoff": None, "owner": request["owner"], "claim_id": request["new_claim_id"]}
        else:
            require(receipt["handoff"] is None, "handoff_pending")
            if action == "checkpoint":
                result = checkpoint(request, receipt)
            elif action == "handoff":
                fields(request, {"key", "claim_id", "to", "approval_comment"})
                result = receipt | {"handoff": {"to": request["to"], "approval_comment": request["approval_comment"]}}
            else:
                require(action == "release", "invalid_action")
                fields(request, {"key", "claim_id", "release"})
                result = receipt | {"release": request["release"]}
    valid_receipt(result)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("claim", "checkpoint", "handoff", "accept", "release"))
    parser.add_argument("request", type=Path)
    parser.add_argument("receipt", type=Path, nargs="?")
    args = parser.parse_args()
    try:
        request = json.loads(args.request.read_text(encoding="utf-8"))
        receipt = json.loads(args.receipt.read_text(encoding="utf-8")) if args.receipt else None
    except (OSError, ValueError):
        parser.exit(1, "invalid_json_input\n")
    try:
        require(args.receipt is None or receipt is not None, "invalid_receipt")
        result = transform(args.action, request, receipt)
    except ValueError as error:
        parser.exit(1, f"{error}\n")
    print(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
