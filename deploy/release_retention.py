"""Post-publication retention of VibeOn images and read-only backup planning."""
import datetime
from dataclasses import dataclass
import hashlib
import json
import os
import re
import stat

from release_uploads_manifest import uploads_tree_sha256
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
KEEP_FULL_BACKUPS = 3
MAX_REMOVE = 3
TAG_PREFIX = "vibeon-retained:sha256-"
INSPECT = '{{json .Id}} {{json .RepoTags}} {{json .RepoDigests}} {{json .Config.Labels}}'


@dataclass(frozen=True)
class FullBackup:
    path: Path
    sha: str
    source: str
    image: str
    images: set[str]
    bytes: int
    timestamp: datetime.datetime


def load_json(path, *, directory_fd=None, expected_inode=None):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory_fd)
    with os.fdopen(fd, "rb") as handle:
        metadata = os.fstat(handle.fileno())
        if (not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1 or metadata.st_size > 1024**2
                or (expected_inode is not None and (metadata.st_dev, metadata.st_ino) != expected_inode)):
            raise ValueError("unsafe retention metadata")
        return json.load(handle)


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
            verified.append(FullBackup(entry, sha, source, record["image"], images, sum(sizes), timestamp))
        except (KeyError, TypeError) as error:
            raise ValueError("invalid verified backup") from error
    candidates = [item for item in verified[KEEP_FULL_BACKUPS:]
                  if item.sha not in PINS and item.source not in PINS and item.timestamp <= now]
    return verified, candidates, set().union(*(record.images for record in verified))


def backup_mounts():
    for line in Path("/proc/self/mountinfo").read_text().splitlines():
        yield Path(re.sub(r"\\([0-7]{3})", lambda match: chr(int(match[1], 8)), line.split()[4]))


def private_backup_files(entry, directory_fd):
    parent = entry.parent.lstat()
    directory = os.fstat(directory_fd)
    if (not stat.S_ISDIR(parent.st_mode) or directory.st_dev != parent.st_dev
            or directory.st_uid != parent.st_uid or directory.st_mode & 0o077
            or entry.resolve(strict=True) != entry
            or any(mount in (entry.parent, entry.parent.parent, entry) or entry in mount.parents
                   for mount in backup_mounts())):
        return {}
    files = {}
    for name in os.listdir(directory_fd):
        row = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
        if (name not in FULL_FILES or not stat.S_ISREG(row.st_mode)
                or row.st_uid != directory.st_uid or row.st_dev != directory.st_dev or row.st_nlink != 1):
            return {}
        files[name] = (row.st_dev, row.st_ino)
    if not {"database.dump", "uploads.tar.gz", "verified.json"}.issubset(files):
        return {}
    return files


def confirm_replacements(verified, count=KEEP_FULL_BACKUPS):
    if len(verified) < count:
        return False
    seen = set()
    for backup in verified[:count]:
        entry = backup.path
        directory_fd = os.open(entry, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            files = private_backup_files(entry, directory_fd)
            if not files or seen.intersection(files.values()):
                return False
            seen.update(files.values())
            marker = load_json("verified.json", directory_fd=directory_fd, expected_inode=files["verified.json"])
            for name, key in (("database.dump", "database_dump_sha256"),
                              ("uploads.tar.gz", "uploads_archive_sha256")):
                expected = marker.get(key)
                legacy_uploads = name == "uploads.tar.gz" and expected is None
                if legacy_uploads:
                    expected = marker.get("uploads_sha256")
                if not re.fullmatch(r"[0-9a-f]{64}", str(expected)):
                    return False
                fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory_fd)
                with os.fdopen(fd, "rb") as handle:
                    row = os.fstat(handle.fileno())
                    if (not stat.S_ISREG(row.st_mode) or row.st_nlink != 1
                            or (row.st_dev, row.st_ino) != files[name]):
                        raise ValueError("backup replacement failed integrity check")
                    digest = uploads_tree_sha256(handle) if legacy_uploads else hashlib.file_digest(handle, "sha256").hexdigest()
                    if digest != expected:
                        raise ValueError("backup replacement failed integrity check")
        finally:
            os.close(directory_fd)
    return True


def fresh_daily_backup(root, migration_fingerprint, schema_sha256, now=None):
    now = now or datetime.datetime.now(datetime.timezone.utc)
    verified, _, _ = full_backup_plan(root, now)
    for backup in verified:
        marker = load_json(backup.path / "verified.json")
        if (marker.get("kind") != "daily" or marker.get("migration_fingerprint") != migration_fingerprint
                or marker.get("schema_sha256") != schema_sha256):
            continue
        try:
            captured = datetime.datetime.fromisoformat(marker["captured_at"])
            completed = datetime.datetime.fromisoformat(marker["verified_at"])
        except (KeyError, TypeError, ValueError):
            continue
        if (captured.utcoffset() != datetime.timedelta(0) or completed.utcoffset() != datetime.timedelta(0)
                or not now - datetime.timedelta(hours=24) <= captured <= completed <= now):
            continue
        if confirm_replacements([backup], count=1):
            return captured
    return None


def retire_backup(entry):
    directory_fd = os.open(entry, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        files = private_backup_files(entry, directory_fd)
        if not files:
            return False
        # Leave the receipt until last. An interrupted deletion of an old pair
        # stops future rotation for review, while the replacements stay intact.
        for name in sorted(files, key=lambda name: name == "verified.json"):
            row = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
            if (row.st_dev, row.st_ino) != files[name] or row.st_nlink != 1:
                raise OSError("backup entry changed")
            os.unlink(name, dir_fd=directory_fd)
        if entry.lstat().st_ino != os.fstat(directory_fd).st_ino:
            raise OSError("backup directory changed")
        entry.rmdir()
        return True
    finally:
        os.close(directory_fd)


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
    now = datetime.datetime.now(datetime.timezone.utc)
    verified, backup_candidates, recovery_images = full_backup_plan(root, now)
    if any(backup.timestamp > now for backup in verified):
        raise ValueError("future backup timestamp")
    report = {
        "status": "ok", "images_removed": 0, "verified_full_backups": len(verified),
        "full_backup_candidates": len(backup_candidates),
        "full_backup_candidate_bytes": sum(item.bytes for item in backup_candidates),
        "full_backups_removed": 0, "full_backups_removed_bytes": 0,
    }
    history_path = root / "release-image-retention.json"
    history = load_json(history_path) if history_path.exists() or history_path.is_symlink() else []
    if (not isinstance(history, list) or any(
            not isinstance(row, dict) or set(row) != {"image", "sha"}
            or not IMAGE.fullmatch(str(row["image"])) or not SHA.fullmatch(str(row["sha"]))
            for row in history)):
        raise ValueError("invalid retention history")
    indexed = {row["image"]: row["sha"] for row in history}
    if len(indexed) != len(history):
        raise ValueError("duplicate retention history")
    # Admit only the current successful release and images recorded in private
    # full-backup receipts. Persist their ownership before expiring a receipt.
    for backup in reversed(verified):
        directory_fd = os.open(backup.path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            if private_backup_files(backup.path, directory_fd):
                if indexed.setdefault(backup.image, backup.sha) != backup.sha:
                    raise ValueError("conflicting recorded image revision")
        finally:
            os.close(directory_fd)
    if indexed.setdefault(image, sha) != sha:
        raise ValueError("conflicting current image revision")
    history = [{"image": digest, "sha": source} for digest, source in indexed.items()]
    write_json(history_path, history)
    if backup_candidates and confirm_replacements(verified):
        for item in reversed(backup_candidates):
            try:
                if retire_backup(item.path):
                    report["full_backups_removed"] += 1
                    report["full_backups_removed_bytes"] += item.bytes
                    if report["full_backups_removed"] == MAX_REMOVE:
                        break
                else:
                    report["status"] = "attention"
            except OSError:
                report["status"] = "attention"
                break
        if report["full_backups_removed"] and report["status"] == "ok":
            _, _, recovery_images = full_backup_plan(root)
    protected = set(protected) | recovery_images | {image}
    present = set(docker("image", "ls", "--filter", "reference=vibeon-retained:*",
                         "--format", "{{.Repository}}:{{.Tag}}").splitlines())
    removed = set()
    try:
        for row in history:
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
