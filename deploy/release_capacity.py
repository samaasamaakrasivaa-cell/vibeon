#!/usr/bin/env python3
"""Read-only capacity probe and guarded Docker import for VibeOn CD."""
import argparse
import contextlib
import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import time

ROOT = Path("/opt/vibeon/deploy")
DIGEST = re.compile(r"sha256:[0-9a-f]{64}\Z")
FULL_PAIR_NAME = re.compile(r"[0-9]{8}T[0-9]{6}Z-([0-9a-f]{12})-[0-9a-f]{8}\Z")
HASH = re.compile(r"[0-9a-f]{64}\Z")
REVISION = re.compile(r"[0-9a-f]{40}\Z")
STAGE_RE = re.compile(r"vibeon-delivery\.[A-Za-z0-9]{8}\Z")
STAGE_MARKER = ".vibeon-stage-v1"
STAGE_OWNER_UID = 0
STAGE_FILES = {
    STAGE_MARKER, "release-preflight.sh", "release-apply.py", "release_capacity.py",
    "release_retention.py", "release_uploads_manifest.py", "vibeon.sh", "attach-proxy.sh",
}
MIN_RESERVE = 512 * 1024**2
MIN_INODES = 4096


class CapacityError(Exception):
    pass


def run(*args):
    return subprocess.check_output(args, stderr=subprocess.DEVNULL, timeout=40).decode().strip()


@contextlib.contextmanager
def release_lock(root, create=False):
    flags = os.O_NOFOLLOW | (os.O_RDWR | os.O_CREAT if create else os.O_RDONLY)
    try:
        fd = os.open(root / ".release.lock", flags, 0o600)
    except FileNotFoundError:
        if create:
            raise
        # A legacy server can be probed before apply first creates its lock.
        yield
        return
    try:
        if not stat.S_ISREG(os.fstat(fd).st_mode):
            raise CapacityError("capacity_inventory_unavailable")
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise CapacityError("release_already_running") from None
        yield
    finally:
        os.close(fd)


def uploads_size(path):
    def visit(directory):
        total = 0
        with os.scandir(directory) as entries:
            for entry in entries:
                metadata = entry.stat(follow_symlinks=False)
                if metadata.st_dev != device:
                    raise CapacityError("capacity_inventory_unavailable")
                if stat.S_ISREG(metadata.st_mode):
                    total += metadata.st_size
                elif stat.S_ISDIR(metadata.st_mode):
                    total += visit(entry.path)
                else:
                    raise CapacityError("capacity_inventory_unavailable")
        return total

    metadata = path.lstat()
    if not stat.S_ISDIR(metadata.st_mode):
        raise CapacityError("capacity_inventory_unavailable")
    device = metadata.st_dev
    return visit(path)


def inventory(root):
    docker_root = Path(run("docker", "info", "--format", "{{.DockerRootDir}}"))
    uploads = Path(run("docker", "volume", "inspect", "--format", "{{.Mountpoint}}", "vibeon_uploads"))
    if not docker_root.is_absolute() or not uploads.is_absolute() or not uploads.is_relative_to(docker_root):
        raise CapacityError("capacity_inventory_unavailable")
    db_bytes = run("docker", "exec", "-e", "PGOPTIONS=-c default_transaction_read_only=on",
                   "vibeon-db-1", "psql", "-XAt", "-v", "ON_ERROR_STOP=1", "-U", "vibeon",
                   "-d", "vibeon", "-c", "SELECT pg_database_size(current_database());")
    if not db_bytes.isascii() or not db_bytes.isdecimal():
        raise CapacityError("capacity_inventory_unavailable")

    # Docker managed containerd content lives below DockerRootDir. Account for a
    # separate system containerd path as well if that installation has one.
    stores = [docker_root]
    system_store = Path("/var/lib/containerd")
    if system_store.is_dir():
        stores.append(system_store)
    backups = root / "backups"
    releases = backups / "releases"
    destination = releases if releases.exists() else backups
    return int(db_bytes), uploads_size(uploads), destination, stores


def budget(db, uploads, backup_path, stores, archive, phases):
    snapshot = db + uploads
    restore = db + 2 * uploads
    # The late executor checks the complete backup/restore envelope on both
    # paths. Reserve earlier phases' full pairs before any transfer.
    backup_restore = snapshot + restore + MIN_RESERVE
    demands = [(backup_path, backup_restore, (phases - 1) * snapshot, 0)]
    demands.extend((store, backup_restore, 0, 3 * archive) for store in stores)
    # Docker may place its scratch archive on a separate device. Where this
    # path aliases Docker storage the 3x ingest allowance already covers it.
    demands.append((Path("/tmp"), MIN_RESERVE, 0, archive))
    by_device = {}
    for path, base, older_pairs, ingest in demands:
        device = path.stat().st_dev
        if device not in by_device:
            fs = os.statvfs(path)
            by_device[device] = [fs.f_bavail * fs.f_frsize, fs.f_favail, 0, 0, 0]
        row = by_device[device]
        row[2] = max(row[2], base)
        row[3] = max(row[3], older_pairs)
        row[4] = max(row[4], ingest)
    margins = [free - base - older_pairs - ingest
               for free, _, base, older_pairs, ingest in by_device.values()]
    report = {
        "archive_bytes": archive,
        "backup_restore_bytes": phases * snapshot + restore + MIN_RESERVE,
        "minimum_inode_margin": min(inodes - MIN_INODES for _, inodes, _, _, _ in by_device.values()),
        "minimum_space_margin_bytes": min(margins),
    }
    report["status"] = "ready" if min(margins) >= 0 and report["minimum_inode_margin"] >= 0 else "blocked"
    if report["status"] == "blocked":
        report["reason"] = "insufficient_pretransfer_space"
    return report


def remove_stage(path, stages, cutoff):
    if path.parent != stages or not STAGE_RE.fullmatch(path.name):
        return False
    device = stages.stat().st_dev

    def private_file(metadata):
        return (stat.S_ISREG(metadata.st_mode) and metadata.st_uid == STAGE_OWNER_UID
                and metadata.st_dev == device and metadata.st_nlink == 1)

    try:
        directory = path.lstat()
        if (not stat.S_ISDIR(directory.st_mode) or directory.st_uid != STAGE_OWNER_UID
                or directory.st_mode & 0o077 or directory.st_dev != device):
            return False
        marker = path / STAGE_MARKER
        metadata = marker.lstat()
        if (not private_file(metadata) or metadata.st_size != len(b"vibeon-delivery-v1\n")
                or metadata.st_mtime > cutoff or marker.read_bytes() != b"vibeon-delivery-v1\n"):
            return False
        files = list(path.iterdir())
        if any(file.name not in STAGE_FILES or not private_file(file.lstat()) for file in files):
            return False
        for file in files:
            if file != marker:
                file.unlink()
        marker.unlink()
        path.rmdir()
        return True
    except OSError:
        return False


def sweep_stages(active, stages=Path("/tmp"), now=None):
    """Remove old marked copies of the fixed runner scripts, never other files."""
    now = time.time() if now is None else now
    return sum(remove_stage(path, stages, now - 24 * 3600)
               for path in stages.iterdir() if path != active)


def private_backup_file(metadata, device):
    return (stat.S_ISREG(metadata.st_mode) and metadata.st_uid == STAGE_OWNER_UID
            and metadata.st_nlink == 1 and metadata.st_dev == device
            and not metadata.st_mode & 0o077 and metadata.st_size > 0)


def daily_receipt(pair, match, now, fingerprints):
    try:
        metadata = pair.lstat()
        if (not stat.S_ISDIR(metadata.st_mode) or metadata.st_uid != STAGE_OWNER_UID
                or metadata.st_mode & 0o077 or metadata.st_dev != pair.parent.stat().st_dev):
            return False
        for name in ("database.dump", "uploads.tar.gz"):
            if not private_backup_file((pair / name).lstat(), metadata.st_dev):
                return False
        fd = os.open(pair / "verified.json", os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        with os.fdopen(fd, "rb") as stream:
            marker = os.fstat(stream.fileno())
            if not private_backup_file(marker, metadata.st_dev) or marker.st_size > 1024**2:
                return False
            receipt = json.load(stream)
        if not isinstance(receipt, dict) or receipt.get("schema_version") != 1 or receipt.get("kind") != "daily":
            return False
        revision = receipt.get("sha")
        if not isinstance(revision, str) or not REVISION.fullmatch(revision) or not revision.startswith(match[1]):
            return False
        for key in ("database_dump_sha256", "uploads_archive_sha256", "migration_fingerprint", "schema_sha256"):
            value = receipt.get(key)
            if not isinstance(value, str) or not HASH.fullmatch(value):
                return False
        captured = datetime.datetime.fromisoformat(receipt["captured_at"])
        verified = datetime.datetime.fromisoformat(receipt["verified_at"])
        utc = datetime.timedelta(0)
        if not (captured.utcoffset() == utc and verified.utcoffset() == utc
                and captured <= verified <= now <= captured + datetime.timedelta(hours=24)):
            return False
        if fingerprints != (receipt["migration_fingerprint"], receipt["schema_sha256"]):
            return False
        for name, key in (("database.dump", "database_dump_sha256"), ("uploads.tar.gz", "uploads_archive_sha256")):
            fd = os.open(pair / name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
            with os.fdopen(fd, "rb") as stream:
                if (not private_backup_file(os.fstat(stream.fileno()), metadata.st_dev)
                        or hashlib.file_digest(stream, "sha256").hexdigest() != receipt[key]):
                    return False
        return True
    except (OSError, ValueError, KeyError, TypeError):
        return False


def live_backup_fingerprints():
    query = """SELECT COALESCE(json_agg(json_build_object(
      'name', migration_name, 'checksum', checksum, 'finished', finished_at IS NOT NULL,
      'rolled_back', rolled_back_at IS NOT NULL)), '[]'::json) FROM "_prisma_migrations";"""
    rows = json.loads(run("docker", "exec", "-e", "PGOPTIONS=-c default_transaction_read_only=on",
                          "vibeon-db-1", "psql", "-XAt", "-v", "ON_ERROR_STOP=1", "-U", "vibeon",
                          "-d", "vibeon", "-c", query))
    migrations = {}
    for row in rows:
        name, checksum = row["name"], row["checksum"]
        if (not re.fullmatch(r"[0-9]{14}_[a-zA-Z0-9_]+", name) or not HASH.fullmatch(checksum)
                or name in migrations or row["finished"] is not True or row["rolled_back"] is not False):
            raise CapacityError("daily_backup_not_fresh")
        migrations[name] = checksum
    schema = run("docker", "exec", "vibeon-app-1", "node", "-e",
                 "console.log(require('crypto').createHash('sha256').update(require('fs').readFileSync('/app/prisma/schema.prisma')).digest('hex'))")
    if not migrations or not HASH.fullmatch(schema):
        raise CapacityError("daily_backup_not_fresh")
    return hashlib.sha256(json.dumps(migrations, sort_keys=True, separators=(",", ":")).encode()).hexdigest(), schema


def has_fresh_daily_backup(root, now=None):
    backups = root / "backups"
    releases = backups / "releases"
    if backups.is_symlink() or releases.is_symlink() or not releases.is_dir():
        return False
    now = now or datetime.datetime.now(datetime.timezone.utc)
    fingerprints = live_backup_fingerprints()
    return any(daily_receipt(pair, match, now, fingerprints) for pair in sorted(releases.iterdir(), reverse=True)
               if (match := FULL_PAIR_NAME.fullmatch(pair.name)))


def check_backup_journal(root):
    try:
        fd = os.open(root / "backup-state.json", os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    except FileNotFoundError:
        return  # First deployment of the daily protocol.
    except OSError:
        raise CapacityError("daily_backup_interrupted") from None
    try:
        with os.fdopen(fd, "rb") as stream:
            metadata = os.fstat(stream.fileno())
            if not private_backup_file(metadata, root.stat().st_dev) or metadata.st_size > 1024**2:
                raise ValueError()
            state = json.load(stream)
        if (not isinstance(state, dict) or state.get("schema_version") != 1
                or state.get("status") not in ("daily_backup_completed", "daily_backup_failed")):
            raise ValueError()
    except (OSError, ValueError, TypeError):
        raise CapacityError("daily_backup_interrupted") from None


def operation(args, root=ROOT):
    with release_lock(root, create=args.mode != "probe"):
        if args.mode in ("sweep", "cleanup"):
            stages = Path("/tmp")
            active = Path(args.stage)
            if active.parent != stages or not STAGE_RE.fullmatch(active.name):
                raise CapacityError("capacity_arguments_invalid")
            if args.mode == "sweep":
                removed = sweep_stages(active, stages)
            else:
                removed = int(remove_stage(active, stages, float("inf")))
            return {"status": "ready", "stages_removed": removed}
        check_backup_journal(root)
        if getattr(args, "fresh_daily", False) and not has_fresh_daily_backup(root):
            raise CapacityError("daily_backup_not_fresh")
        db, uploads, backup, stores = inventory(root)
        report = budget(db, uploads, backup, stores, args.archive, args.phases)
        if args.mode == "probe":
            existing = set(run("docker", "image", "ls", "-aq", "--no-trunc").splitlines())
            report["present_images"] = sorted(existing.intersection(args.images))
        elif report["status"] == "ready":
            subprocess.run(["docker", "load"], stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL, check=True, timeout=1100)
            for image in args.images:
                if run("docker", "image", "inspect", "--format", "{{.Id}}", image) != image:
                    raise CapacityError("image_transfer_failed")
        return report


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=("probe", "load", "sweep", "cleanup"))
    parser.add_argument("archive", type=int)
    parser.add_argument("phases", type=int)
    parser.add_argument("images", nargs="*")
    parser.add_argument("--stage")
    parser.add_argument("--fresh-daily", action="store_true")
    args = parser.parse_args()
    try:
        if (args.archive < 0 or args.phases not in (1, 2)
                or any(not DIGEST.fullmatch(image) for image in args.images)
                or (args.mode == "load" and (args.archive == 0 or not args.images))
                or (args.fresh_daily and args.mode not in ("probe", "load"))):
            raise CapacityError("capacity_arguments_invalid")
        report = operation(args)
    except CapacityError as error:
        report = {"status": "blocked", "reason": str(error)}
    except subprocess.CalledProcessError:
        report = {"status": "blocked", "reason": "image_transfer_failed" if args.mode == "load" else "capacity_inventory_unavailable"}
    except (OSError, ValueError, KeyError, TypeError, subprocess.TimeoutExpired):
        report = {"status": "blocked", "reason": "capacity_inventory_unavailable"}
    print(json.dumps(report, separators=(",", ":")), flush=True)


if __name__ == "__main__":
    sys.exit(main())
