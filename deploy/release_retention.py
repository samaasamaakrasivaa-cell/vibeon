"""Post-publication retention of VibeOn images and read-only backup planning."""
import datetime
import hashlib
import json
import re
import stat
from pathlib import Path

IMAGE = re.compile(r"sha256:[0-9a-f]{64}")
SHA = re.compile(r"[0-9a-f]{40}")
BACKUP = re.compile(r"[0-9]{8}T[0-9]{6}Z-([0-9a-f]{12})-[0-9a-f]{8}")
# Bootstrap, placement reader/writer, and compatible lesson data milestones.
PINS = frozenset({
    "765cc4ae9da861edbb7e8b0be01c504ac63a65ca",
    "01da92f1332056aaacc01ec6a6731f72e1bb45e0",
    "ea75dffb53749f832d4153857a718a7d0a98ae50",
    "c2996ff7ffb670449de1886738791cb18c279fab",
    "85e25701a0b89240f8f17984d8b42fb105a2fc73",
    "5d51fb5096e96a93d0aed906714c521691692470",
    "97fa7328aa833b02702a05dc63182148dafdab39",
    "81d7077b1ed3ae99c4d844c27171d0f2f4485ebb",
    "437986d954400f8b44ba456f02a68df18b5f0e31",
    "82473a1199a160651ae2bed2f8365b5e536d7c72",
})
FULL_FILES = frozenset({"database.dump", "uploads.tar.gz", "verified.json",
                        ".env", "docker-compose.prod.yml", "release-image.json"})
KEEP = 3
MAX_REMOVE = 3
TAG_PREFIX = "vibeon-retained:sha256-"
INSPECT = '{{json .Id}} {{json .RepoTags}} {{json .RepoDigests}} {{json .Config.Labels}}'


def load_json(path):
    if path.is_symlink() or not path.is_file():
        raise ValueError("unsafe retention metadata")
    return json.loads(path.read_text())


def full_backup_plan(root, now=None):
    path = root / "backups" / "releases"
    if (root / "backups").is_symlink() or path.is_symlink():
        raise ValueError("unsafe backup path")
    verified = []
    now = now or datetime.datetime.now(datetime.timezone.utc)
    if not path.exists():
        return verified, [], set()
    for entry in sorted(path.iterdir(), reverse=True):
        match = BACKUP.fullmatch(entry.name)
        if not match or entry.is_symlink() or not entry.is_dir():
            continue
        dump = entry / "database.dump"
        uploads = entry / "uploads.tar.gz"
        marker = entry / "verified.json"
        if not marker.exists() and not marker.is_symlink():
            continue
        if any(p.is_symlink() or not p.is_file() for p in (dump, uploads)):
            raise ValueError("incomplete verified backup")
        try:
            record = load_json(marker)
            if not isinstance(record, dict):
                raise ValueError("invalid verified backup")
            sha = record.get("sha", "")
            if (record.get("schema_version") != 1 or not isinstance(sha, str) or not SHA.fullmatch(sha)
                    or not sha.startswith(match[1])
                    or any(not IMAGE.fullmatch(str(record.get(key, ""))) for key in ("image", "rollback_image"))
                    or any(not re.fullmatch(r"[0-9a-f]{64}", str(record.get(key, "")))
                           for key in ("database_dump_sha256", "uploads_sha256"))):
                raise ValueError("invalid verified backup")
            sizes = (dump.stat().st_size, uploads.stat().st_size)
            if min(sizes) <= 0:
                raise ValueError("empty verified backup")
            images = {record["image"], record["rollback_image"]}
            previous = record.get("previous_image")
            if previous is not None:
                if not isinstance(previous, str) or not IMAGE.fullmatch(previous):
                    raise ValueError("invalid backup app image")
                images.add(previous)
            override = entry / "release-image.json"
            source = sha
            if override.exists() or override.is_symlink():
                app = load_json(override)["services"]["app"]
                previous, source = app["image"], app["environment"]["APP_VERSION"]
                if not isinstance(previous, str) or not IMAGE.fullmatch(previous) or not SHA.fullmatch(str(source)):
                    raise ValueError("invalid backup app override")
                images.add(previous)
            timestamp = datetime.datetime.strptime(entry.name[:16], "%Y%m%dT%H%M%SZ").replace(tzinfo=datetime.timezone.utc)
            verified.append((sha, sum(sizes), images, timestamp, entry, source))
        except (KeyError, TypeError) as error:
            raise ValueError("invalid verified backup") from error
    cutoff = now - datetime.timedelta(hours=48)
    candidates = [item for item in verified[KEEP:]
                  if item[0] not in PINS and item[5] not in PINS and item[3] < cutoff]
    return verified, candidates, set().union(*(record[2] for record in verified))


def confirm_replacements(verified):
    if len(verified) < KEEP:
        return False
    for _, _, _, _, entry, _ in verified[:KEEP]:
        marker = load_json(entry / "verified.json")
        # Legacy receipts lack a checksum for the compressed archive. Wait
        # for three new restore-tested receipts before any automatic expiry.
        for name, key in (("database.dump", "database_dump_sha256"),
                          ("uploads.tar.gz", "uploads_archive_sha256")):
            expected = marker.get(key, "")
            if not re.fullmatch(r"[0-9a-f]{64}", str(expected)):
                return False
            with (entry / name).open("rb") as handle:
                if hashlib.file_digest(handle, "sha256").hexdigest() != expected:
                    raise ValueError("backup replacement failed integrity check")
    return True


def retire_backup(entry):
    device = entry.parent.stat().st_dev
    directory = entry.lstat()
    if (not stat.S_ISDIR(directory.st_mode) or directory.st_dev != device
            or directory.st_uid != entry.parent.stat().st_uid or directory.st_mode & 0o077):
        return False
    # A same-device bind mount must not masquerade as a project-owned file.
    for line in Path("/proc/self/mountinfo").read_text().splitlines():
        mount = Path(re.sub(r"\\([0-7]{3})", lambda match: chr(int(match[1], 8)), line.split()[4]))
        if mount == entry or entry in mount.parents:
            return False
    files = list(entry.iterdir())
    for path in files:
        row = path.lstat()
        if (path.name not in FULL_FILES or not stat.S_ISREG(row.st_mode)
                or row.st_uid != directory.st_uid or row.st_dev != device or row.st_nlink != 1):
            return False
    if not {"database.dump", "uploads.tar.gz", "verified.json"}.issubset({path.name for path in files}):
        return False
    # Leave the receipt until last. An interrupted deletion of an old pair
    # stops future rotation for review, while the replacements stay intact.
    for path in sorted(files, key=lambda path: path.name == "verified.json"):
        path.unlink()
    entry.rmdir()
    return True


def inspect_image(docker, tag):
    # Only fields used by the guard reach this helper. No inspect output is logged.
    raw = docker("image", "inspect", "--format", INSPECT, tag)
    decoder = json.JSONDecoder()
    values = []
    for _ in range(4):
        item, end = decoder.raw_decode(raw)
        values.append(item)
        raw = raw[end:].lstrip()
    if raw:
        raise ValueError("invalid image metadata")
    return values


def rotate(root, image, sha, protected, *, docker, write_json):
    verified, backup_candidates, recovery_images = full_backup_plan(root)
    report = {
        "status": "ok", "images_removed": 0, "verified_full_backups": len(verified),
        "full_backup_candidates": len(backup_candidates),
        "full_backup_candidate_bytes": sum(item[1] for item in backup_candidates),
        "full_backups_removed": 0, "full_backups_removed_bytes": 0,
    }
    if backup_candidates and confirm_replacements(verified):
        for item in reversed(backup_candidates):
            try:
                if retire_backup(item[4]):
                    report["full_backups_removed"] += 1
                    report["full_backups_removed_bytes"] += item[1]
                    if report["full_backups_removed"] == MAX_REMOVE:
                        break
                else:
                    report["status"] = "attention"
            except OSError:
                report["status"] = "attention"
                break
        # Keep the pre-sweep recovery images for this release. The next
        # successful release can reconsider references to retired pairs.
    history_path = root / "release-image-retention.json"
    history = load_json(history_path) if history_path.exists() or history_path.is_symlink() else []
    if (not isinstance(history, list) or any(
            not isinstance(row, dict) or set(row) != {"image", "sha"}
            or not IMAGE.fullmatch(str(row["image"])) or not SHA.fullmatch(str(row["sha"]))
            for row in history)):
        raise ValueError("invalid retention history")
    # Only releases recorded after successful public health enter the automatic
    # allowlist. Historical manual tags and incomplete releases are left alone.
    if len({row["image"] for row in history}) != len(history):
        raise ValueError("duplicate retention history")
    history = [row for row in history if row["image"] != image]
    history.append({"image": image, "sha": sha})
    write_json(history_path, history)
    protected = set(protected) | recovery_images | {row["image"] for row in history[-KEEP:]}
    present = set(docker("image", "ls", "--filter", "reference=vibeon-retained:*",
                         "--format", "{{.Repository}}:{{.Tag}}").splitlines())
    removed = set()
    try:
        for row in history[:-KEEP]:
            digest, revision = row["image"], row["sha"]
            if digest in protected or revision in PINS:
                continue
            tag = TAG_PREFIX + digest.removeprefix("sha256:")
            if tag not in present:
                continue
            identifier, tags, digests, labels = inspect_image(docker, tag)
            if (identifier != digest or tags != [tag]
                    or digests not in (None, [], ["vibeon-retained@" + digest])
                    or not isinstance(labels, dict)
                    or labels.get("org.opencontainers.image.revision") != revision
                    or not SHA.fullmatch(str(labels.get("io.vibeon.recipe-revision", "")))
                    or docker("ps", "--all", "--quiet", "--filter", "ancestor=" + digest)):
                continue
            docker("image", "rm", "--no-prune", tag)
            removed.add(digest)
            report["images_removed"] += 1
            if report["images_removed"] == MAX_REMOVE:
                break
    except Exception:
        # A partially completed sweep is observable without reclassifying a
        # published release or exposing Docker or backup data in the report.
        report["status"] = "attention"
    if removed:
        try:
            write_json(history_path, [row for row in history if row["image"] not in removed])
        except OSError:
            report["status"] = "attention"
    return report
