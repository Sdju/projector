"""Read archive metadata only; never extract members or follow their links."""
import bz2
import datetime
import gzip
import json
import lzma
import os
import sys
import tarfile
import zipfile

try:
    import resource

    resource.setrlimit(resource.RLIMIT_AS, (256 * 1024 * 1024,) * 2)
except ImportError:  # Windows has no rlimit; MAX_BYTES and MAX_ENTRIES still bound the work.
    pass
MAX_ENTRIES = 5000
MAX_BYTES = 256 * 1024 * 1024


class LimitReached(Exception):
    pass


class BoundedReader:
    def __init__(self, source):
        self.source = source
        self.remaining = MAX_BYTES

    def read(self, size):
        if self.remaining <= 0:
            raise LimitReached()
        data = self.source.read(min(size, self.remaining))
        self.remaining -= len(data)
        return data


def timestamp(value):
    try:
        return datetime.datetime.fromtimestamp(value, datetime.timezone.utc).isoformat()
    except (ValueError, OverflowError, OSError):
        return None


def inspect(path, name):
    lower = name.lower()
    result = {"format": "TAR", "size": os.stat(path).st_size, "entries": [], "truncated": False}
    entries = result["entries"]
    if lower.endswith(".zip"):
        result["format"] = "ZIP"
        with zipfile.ZipFile(path) as archive:
            members = archive.infolist()
            result["truncated"] = len(members) > MAX_ENTRIES
            for item in members[:MAX_ENTRIES]:
                mode = (item.external_attr >> 16) & 0o170000
                kind = "directory" if item.is_dir() else "symlink" if mode == 0o120000 else "file"
                entries.append({"path": item.filename, "type": kind, "size": item.file_size,
                                "modified": datetime.datetime(*item.date_time).isoformat()})
        return result
    opener, compression = open, ""
    if lower.endswith((".gz", ".gzip", ".tgz")):
        opener, compression = gzip.open, "GZIP"
    elif lower.endswith((".bz2", ".tbz", ".tbz2")):
        opener, compression = bz2.open, "BZIP2"
    elif lower.endswith((".xz", ".txz")):
        opener, compression = lzma.open, "XZ"
    result["format"] = "TAR" + (" + " + compression if compression else "")
    try:
        with opener(path, "rb") as source:
            with tarfile.open(fileobj=BoundedReader(source), mode="r|") as archive:
                for item in archive:
                    if len(entries) == MAX_ENTRIES:
                        result["truncated"] = True
                        break
                    kind = ("directory" if item.isdir() else "symlink" if item.issym() else
                            "hardlink" if item.islnk() else "file" if item.isfile() else "other")
                    entries.append({"path": item.name, "type": kind, "size": item.size,
                                    "modified": timestamp(item.mtime), "link": item.linkname or None})
        return result
    except LimitReached:
        result["truncated"] = True
        return result
    except tarfile.ReadError:
        # A plain compressed stream is one file, not an archive of multiple members.
        if not compression or lower.endswith((".tgz", ".tbz", ".tbz2", ".txz", ".tar.gz", ".tar.bz2", ".tar.xz")):
            raise
    result["format"] = compression
    size = 0
    with opener(path, "rb") as source:
        while True:
            data = source.read(min(65536, MAX_BYTES + 1 - size))
            size += len(data)
            if size > MAX_BYTES:
                raise LimitReached()
            if not data:
                break
    entries.append({"path": name.rsplit("/", 1)[-1].rsplit(".", 1)[0], "type": "file", "size": size})
    return result


try:
    print(json.dumps(inspect(sys.argv[1], sys.argv[2]), ensure_ascii=True))
except LimitReached:
    print(json.dumps({"error": "Сжатый файл превышает лимит просмотра 256 МБ", "status": 413}))
except (OSError, EOFError, ValueError, tarfile.TarError, zipfile.BadZipFile, lzma.LZMAError):
    print(json.dumps({"error": "Архив повреждён или имеет неподдерживаемый формат", "status": 422}))
except MemoryError:
    print(json.dumps({"error": "Архив слишком большой для просмотра", "status": 413}))
