"""Reconstruct the release executor's legacy uploads tree hash without extraction."""
import gzip
import hashlib
import tarfile


MAX_METADATA_READ = 1024**2
MAX_ENTRIES = 100_000
# GNU and BusyBox tar pad the last record. Limit the amount of unused padding.
MAX_PADDING = 1024**2


class BoundedArchive:
    """Prevent tarfile extensions from requesting arbitrarily large buffers."""

    def __init__(self, file):
        self.file = file

    def read(self, size):
        if not 0 <= size <= MAX_METADATA_READ:
            raise ValueError("unsupported archive metadata")
        return self.file.read(size)

    def seek(self, position, whence=0):
        return self.file.seek(position, whence)

    def tell(self):
        return self.file.tell()


def entry_path(name):
    # The original backup command archived '.' from a fixed mount. Be liberal
    # about the './' prefix, while rejecting all ambiguous tree components.
    if name in (".", "./"):
        return ()
    if name.startswith("./"):
        name = name[2:]
    parts = tuple(name.split("/"))
    if not all(part and part not in (".", "..") and "\0" not in part for part in parts):
        raise ValueError("unsupported archive path")
    if len(name.encode("utf-8")) > 4096 or any(len(part.encode("utf-8")) > 255 for part in parts):
        raise ValueError("unsupported archive path")
    return parts


def check_padding(inflated, offset):
    inflated.seek(offset)
    padding = 0
    for chunk in iter(lambda: inflated.read(64 * 1024), b""):
        padding += len(chunk)
        if padding > MAX_PADDING or chunk.strip(b"\0"):
            raise ValueError("unexpected archive trailer")
    if padding < 2 * tarfile.BLOCKSIZE or padding % tarfile.BLOCKSIZE:
        raise ValueError("archive lacks standard end markers")


def read_entries(compressed):
    entries = {}
    with gzip.GzipFile(fileobj=compressed, mode="rb") as inflated:
        with tarfile.open(fileobj=BoundedArchive(inflated), mode="r:") as archive:
            for member in archive:
                path = entry_path(member.name)
                if len(entries) >= MAX_ENTRIES or path in entries:
                    raise ValueError("archive repeats entries or has too many entries")
                if member.type == tarfile.DIRTYPE and member.size == 0:
                    entries[path] = None
                elif (path and member.type in (tarfile.REGTYPE, tarfile.AREGTYPE)
                      and member.size >= 0 and member.sparse is None):
                    with archive.extractfile(member) as content:
                        entries[path] = hashlib.file_digest(content, "sha256").hexdigest()
                else:
                    raise ValueError("unsupported archive entry")
            check_padding(inflated, archive.offset)
    return entries


def uploads_tree_sha256(compressed):
    """Return the historical FILES_JS digest for an already opened gzip archive."""
    try:
        entries = read_entries(compressed)
        if () not in entries or entries[()] is not None:
            raise ValueError("archive has no root directory")
        children = {}
        for path in entries:
            if not path:
                continue
            parent = path[:-1]
            if parent not in entries or entries[parent] is not None:
                raise ValueError("archive has no matching parent directory")
            children.setdefault(parent, []).append(path)
        for group in children.values():
            # JavaScript Array.sort compares unsigned UTF-16 code units.
            group.sort(key=lambda path: path[-1].encode("utf-16-be"), reverse=True)

        digest = hashlib.sha256()
        pending = list(children.get((), ()))
        while pending:
            path = pending.pop()
            relative = "/" + "/".join(path)
            content_sha = entries[path]
            if content_sha is None:
                digest.update(("D\0" + relative + "\0").encode("utf-8"))
                pending.extend(children.get(path, ()))
            else:
                digest.update(("F\0" + relative + "\0" + content_sha + "\0").encode("utf-8"))
        return digest.hexdigest()
    except (EOFError, OSError, ValueError, tarfile.TarError):
        raise ValueError("uploads archive proof unavailable") from None
