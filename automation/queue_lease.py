"""Pure proposals for the permanent coordination branch, never for main.

Read the control file at an exact GitHub head, compute a proposal, then commit it
with compare-and-swap against that head. A returned proposal is NOT a granted
lease. Only the winning CAS caller may work, and it must retain its token.
"""
import copy
from datetime import datetime, timedelta, timezone
import json
import re
import uuid

TTL = timedelta(hours=3)
READY = "[VIBEON-AUTO: READY]"
MANUAL = [2, 7, 8, 16, 18]
KEYS = {"schema_version", "mode", "authorized_author", "readiness_marker",
        "manual_issue_numbers", "lease", "checkpoint", "last_probe"}
UNCHANGED = object()


class LeaseError(ValueError):
    """Fixed failure code; do not include task bodies, secrets or remote errors."""


def _time(value):
    try:
        if isinstance(value, str):
            if not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z", value):
                raise ValueError()
            value = datetime.fromisoformat(value[:-1] + "+00:00")
        if not isinstance(value, datetime) or value.tzinfo is None:
            raise ValueError()
        return value.astimezone(timezone.utc)
    except (ValueError, OverflowError):
        raise LeaseError("invalid_time") from None


def _stamp(value):
    return value.isoformat(timespec="microseconds").replace("+00:00", "Z")


def _metadata(value):
    try:
        if value is not None and not isinstance(value, dict):
            raise ValueError()
        if len(json.dumps(value, ensure_ascii=False, allow_nan=False).encode()) > 2048:
            raise ValueError()
        return copy.deepcopy(value)
    except (TypeError, ValueError, RecursionError):
        raise LeaseError("invalid_checkpoint_metadata") from None


def validate(state):
    """Validate and copy the small JSON state; never mutate the caller's value."""
    if not isinstance(state, dict) or set(state) != KEYS or type(state["schema_version"]) is not int or state["schema_version"] != 1:
        raise LeaseError("invalid_state_schema")
    if state["mode"] not in {"probe", "enabled", "paused"} or state["readiness_marker"] != READY:
        raise LeaseError("invalid_state_policy")
    author = state["authorized_author"]
    if not isinstance(author, str) or not re.fullmatch(r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?", author):
        raise LeaseError("invalid_author")
    manual = state["manual_issue_numbers"]
    if not isinstance(manual, list) or any(type(n) is not int or n <= 0 for n in manual) or len(manual) != len(set(manual)) or not set(MANUAL).issubset(manual):
        raise LeaseError("invalid_manual_exclusions")
    lease = state["lease"]
    if lease is not None:
        if not isinstance(lease, dict) or set(lease) != {"token", "started_at", "expires_at"} or not isinstance(lease["token"], str) or not re.fullmatch(r"[0-9a-f]{32}", lease["token"]):
            raise LeaseError("invalid_lease")
        if _time(lease["expires_at"]) <= _time(lease["started_at"]):
            raise LeaseError("invalid_lease_interval")
    _metadata(state["checkpoint"])
    _metadata(state["last_probe"])
    return copy.deepcopy(state)


def new_state(author, mode="probe"):
    return validate({"schema_version": 1, "mode": mode, "authorized_author": author,
                     "readiness_marker": READY, "manual_issue_numbers": list(MANUAL),
                     "lease": None, "checkpoint": None, "last_probe": None})


def _ready_line(body):
    fence = None
    for line in body.splitlines():
        text = line.strip()
        match = re.match(r"^(`{3,}|~{3,})", text)
        if fence:
            if re.fullmatch(re.escape(fence[0]) + "{" + str(fence[1]) + r",}\s*", text):
                fence = None
            continue
        if match:
            fence = (match[1][0], len(match[1]))
        elif not line.startswith(("    ", "\t", ">")) and text == READY:
            return True
    return False


def eligible(issue, state):
    """Use GitHub metadata, not author/permission claims written in Markdown."""
    policy = validate(state)
    if not isinstance(issue, dict) or policy["mode"] != "enabled":
        return False
    number, author, body = issue.get("number"), issue.get("user"), issue.get("body")
    return (issue.get("state") == "open" and "pull_request" not in issue
            and type(number) is int and number > 0 and number not in policy["manual_issue_numbers"]
            and isinstance(author, dict) and isinstance(author.get("login"), str)
            and author["login"].lower() == policy["authorized_author"].lower()
            and isinstance(body, str) and _ready_line(body))


def claim(state, now, *, reconciled=False):
    proposal, instant = validate(state), _time(now)
    if proposal["mode"] == "paused":
        raise LeaseError("worker_paused")
    prior = proposal["lease"]
    if prior is not None:
        if instant < _time(prior["expires_at"]):
            raise LeaseError("lease_busy")
        if reconciled is not True:
            raise LeaseError("expired_lease_requires_reconciliation")
    token = uuid.uuid4().hex
    if prior is not None and token == prior["token"]:
        raise LeaseError("token_collision")
    proposal["lease"] = {"token": token, "started_at": _stamp(instant), "expires_at": _stamp(instant + TTL)}
    return proposal


def _owned(state, token, now):
    proposal, instant = validate(state), _time(now)
    lease = proposal["lease"]
    if lease is None or token != lease["token"]:
        raise LeaseError("stale_token")
    if instant < _time(lease["started_at"]) or instant >= _time(lease["expires_at"]):
        raise LeaseError("lease_not_current")
    return proposal, instant


def renew(state, token, now, *, checkpoint=UNCHANGED):
    proposal, instant = _owned(state, token, now)
    proposal["lease"]["expires_at"] = _stamp(instant + TTL)
    if checkpoint is not UNCHANGED:
        proposal["checkpoint"] = _metadata(checkpoint)
    return proposal


def release(state, token, now, *, checkpoint=UNCHANGED, last_probe=UNCHANGED):
    proposal, _ = _owned(state, token, now)
    proposal["lease"] = None
    if checkpoint is not UNCHANGED:
        proposal["checkpoint"] = _metadata(checkpoint)
    if last_probe is not UNCHANGED:
        proposal["last_probe"] = _metadata(last_probe)
    return proposal
