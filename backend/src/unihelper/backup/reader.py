"""Validate a backup zip before anything changes (research R3, R8, R9).

Order: is it our zip and a version we know → are all names safe and exactly the manifest's →
does every entry stream to its manifest size and SHA-256 → do the data rows parse → would any
row id clash with another account on this server. Then build the summary the student confirms.
"""

from __future__ import annotations

import hashlib
import json
import re
import stat
import zipfile
from collections import defaultdict
from collections.abc import Callable
from datetime import datetime
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from unihelper.api.errors import ApiError
from unihelper.backup import errors
from unihelper.backup import manifest as mf
from unihelper.backup import rows as rowcodec
from unihelper.backup.tables import INCLUDED, account_where, single_pk
from unihelper.backup.writer import Account, connect, row_counts
from unihelper.config import Settings
from unihelper.storage import backup_fs
from unihelper.storage.storage_service import StorageService

BLOCK = 1024 * 1024
MAX_MANIFEST = 64 * 1024 * 1024
_DATA_NAME = re.compile(r"^data/([a-z_]+)\.jsonl$")

Progress = Callable[[int, int | None], None]


def open_backup(path: Path) -> tuple[zipfile.ZipFile, mf.Manifest]:
    """Open the zip and read its manifest; `not_a_backup` / `backup_too_new` otherwise."""
    try:
        zf = zipfile.ZipFile(path)
    except (zipfile.BadZipFile, OSError) as exc:
        raise errors.not_a_backup() from exc
    try:
        info = zf.getinfo(mf.MANIFEST)
        if info.file_size > MAX_MANIFEST:
            raise errors.not_a_backup()
        raw = json.loads(zf.read(info))
        if not isinstance(raw, dict) or raw.get("kind") != mf.KIND:
            raise errors.not_a_backup()
        fmt = raw.get("formatVersion")
        rev = raw.get("schemaRevision")
        app = str(raw.get("appVersion", "?"))
        if isinstance(fmt, int) and fmt > mf.FORMAT_VERSION:
            raise errors.backup_too_new(app)
        if isinstance(rev, str) and rev not in mf.known_revisions():
            raise errors.backup_too_new(app)
        manifest = mf.Manifest.model_validate(raw)
    except ApiError:
        zf.close()
        raise
    except (KeyError, ValueError, ValidationError, zipfile.BadZipFile) as exc:
        zf.close()
        raise errors.not_a_backup() from exc
    return zf, manifest


def check_names(zf: zipfile.ZipFile, manifest: mf.Manifest, windows: bool | None = None) -> None:
    infos = zf.infolist()
    names = [i.filename for i in infos]
    unsafe: list[str] = []
    seen: dict[str, str] = {}
    for info in infos:
        name = info.filename
        mode = (info.external_attr >> 16) & 0o170000
        if backup_fs.unsafe_reason(name) or mode == stat.S_IFLNK:
            unsafe.append(name)
            continue
        folded = name.casefold()
        if folded in seen:  # an exact duplicate, or a name only a case apart (Windows, macOS)
            unsafe.append(name)
        seen[folded] = name
    if unsafe:
        raise errors.backup_unsafe(unsafe)
    expected = {e.path for e in manifest.entries} | {mf.MANIFEST, mf.README}
    if set(names) != expected or len(manifest.entries) != len(expected) - 2:
        raise errors.backup_damaged("Files were added to or removed from the backup.")
    for name in names:
        if name in (mf.MANIFEST, mf.README) or name.startswith(mf.FILES_PREFIX):
            continue
        m = _DATA_NAME.match(name)
        if m is None or m.group(1) not in INCLUDED:
            raise errors.backup_damaged(f"The backup has an unexpected file: {name}")
    rels = [n[len(mf.FILES_PREFIX) :] for n in names if n.startswith(mf.FILES_PREFIX)]
    invalid = [rel for rel in rels if backup_fs.invalid_here(rel, windows)]
    if invalid:
        raise errors.backup_names_invalid(invalid)


def stream_entry(zf: zipfile.ZipFile, entry: mf.Entry, sink: Callable[[bytes], Any]) -> None:
    """Read one entry, refusing more bytes than the manifest says (compression bombs) and any
    size or hash difference."""
    digest = hashlib.sha256()
    size = 0
    try:
        with zf.open(entry.path) as fh:
            while block := fh.read(min(BLOCK, entry.size - size + 1)):
                size += len(block)
                if size > entry.size:
                    raise errors.backup_damaged(f"{entry.path} is larger than expected.")
                digest.update(block)
                sink(block)
    except zipfile.BadZipFile as exc:  # CRC mismatch, truncated data
        raise errors.backup_damaged(f"{entry.path} is damaged.") from exc
    if size != entry.size or digest.hexdigest() != entry.sha256:
        raise errors.backup_damaged(f"{entry.path} doesn't match the backup's checksum.")


def verify_entries(
    zf: zipfile.ZipFile, manifest: mf.Manifest, progress: Progress | None = None
) -> None:
    total = sum(e.size for e in manifest.entries)
    done = 0
    for entry in manifest.entries:
        stream_entry(zf, entry, lambda _b: None)
        done += entry.size
        if progress:
            progress(done, total)


def data_ids(zf: zipfile.ZipFile, manifest: mf.Manifest) -> dict[str, set[Any]]:
    """Primary keys per table; parsing every line also proves the data files are readable."""
    ids: dict[str, set[Any]] = defaultdict(set)
    for entry in manifest.entries:
        m = _DATA_NAME.match(entry.path)
        if m is None:
            continue
        table = m.group(1)
        pk = single_pk(table)
        with zf.open(entry.path) as fh:
            for row in rowcodec.iter_jsonl(fh):
                if pk is not None and pk in row:
                    ids[table].add(row[pk])
    return ids


def check_ids(settings: Settings, uid: str, ids: dict[str, set[Any]]) -> None:
    """Restored rows keep their ids; an id another account already uses can't be restored."""
    conn = connect(settings.db_path)
    try:
        for table, values in ids.items():
            pk = single_pk(table)
            if pk is None or not values:
                continue
            batch = list(values)
            for start in range(0, len(batch), 500):
                chunk = batch[start : start + 500]
                marks = ", ".join("?" * len(chunk))
                sql = (
                    f"SELECT 1 FROM {table} WHERE {pk} IN ({marks})"
                    f" AND NOT ({account_where(table).replace(':uid', '?')}) LIMIT 1"
                )
                if conn.execute(sql, [*chunk, uid]).fetchone():
                    raise errors.backup_ids_in_use()
    finally:
        conn.close()


def safety_info(settings: Settings, uid: str) -> dict[str, Any] | None:
    files = sorted((settings.safety_dir / uid).glob("safety-*.zip"))
    if not files:
        return None
    latest = files[-1]
    st = latest.stat()
    stamp = latest.stem.removeprefix("safety-")
    return {"createdAt": _stamp_iso(stamp), "size": st.st_size, "file": latest}


def _stamp_iso(stamp: str) -> str:
    """`YYYYMMDDTHHMMSSZ` (safety-<stamp>.zip) as ISO-8601."""
    try:
        return datetime.strptime(stamp, "%Y%m%dT%H%M%SZ").strftime("%Y-%m-%dT%H:%M:%SZ")
    except ValueError:  # pragma: no cover - only our own names are read
        return stamp


def summarize(
    settings: Settings, storage: StorageService, account: Account, manifest: mf.Manifest
) -> dict[str, Any]:
    conn = connect(settings.db_path)
    try:
        current = row_counts(conn, account.id)
    finally:
        conn.close()
    root = storage.user_root(account.username)
    in_backup = {
        e.path[len(mf.FILES_PREFIX) :]
        for e in manifest.entries
        if e.path.startswith(mf.FILES_PREFIX)
    }
    current_files = list(backup_fs.walk_account(root))
    current["files"] = len(current_files)
    current["bytes"] = sum(size for _r, _p, size in current_files)
    safety = safety_info(settings, account.id)
    return {
        "createdAt": manifest.created_at,
        "appVersion": manifest.app_version,
        "source": manifest.source,
        "willUpgrade": manifest.schema_revision != mf.head_revision(),
        "counts": {k: manifest.counts.get(k, 0) for k in mf.COUNT_KEYS},
        "keysLeftOut": [k.model_dump(by_alias=True) for k in manifest.keys_left_out],
        "excluded": [x.model_dump(by_alias=True) for x in manifest.excluded],
        "current": {"counts": {k: current.get(k, 0) for k in mf.COUNT_KEYS}},
        "filesNotInBackup": sum(1 for rel, _p, _s in current_files if rel not in in_backup),
        "safetyBackup": {
            "replaces": (
                {"createdAt": safety["createdAt"], "size": safety["size"]} if safety else None
            )
        },
    }


def validate_backup(
    path: Path,
    settings: Settings,
    storage: StorageService,
    account: Account,
    progress: Progress | None = None,
    windows: bool | None = None,
) -> tuple[mf.Manifest, dict[str, Any]]:
    zf, manifest = open_backup(path)
    with zf:
        check_names(zf, manifest, windows)
        verify_entries(zf, manifest, progress)
        check_ids(settings, account.id, data_ids(zf, manifest))
    return manifest, summarize(settings, storage, account, manifest)
