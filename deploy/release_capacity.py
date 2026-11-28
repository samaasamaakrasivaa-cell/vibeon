#!/usr/bin/env python3
"""Read-only capacity probe and guarded Docker import for VibeOn CD."""
import argparse
import contextlib
import fcntl
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
STAGE_RE = re.compile(r"vibeon-delivery\.[A-Za-z0-9]{8}\Z")
STAGE_MARKER = ".vibeon-stage-v1"
STAGE_OWNER_UID = 0
STAGE_FILES = {
    STAGE_MARKER, "release-preflight.sh", "release-apply.py", "release_capacity.py",
    "release_retention.py", "vibeon.sh", "attach-proxy.sh",
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
    args = parser.parse_args()
    try:
        if (args.archive < 0 or args.phases not in (1, 2)
                or any(not DIGEST.fullmatch(image) for image in args.images)
                or (args.mode == "load" and (args.archive == 0 or not args.images))):
            raise CapacityError("capacity_arguments_invalid")
        report = operation(args)
    except CapacityError as error:
        report = {"status": "blocked", "reason": str(error)}
    except subprocess.CalledProcessError:
        report = {"status": "blocked", "reason": "image_transfer_failed" if args.mode == "load" else "capacity_inventory_unavailable"}
    except (OSError, ValueError, subprocess.TimeoutExpired):
        report = {"status": "blocked", "reason": "capacity_inventory_unavailable"}
    print(json.dumps(report, separators=(",", ":")), flush=True)


if __name__ == "__main__":
    sys.exit(main())
