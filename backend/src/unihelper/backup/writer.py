"""Build a backup zip of one account (research R5, R6).

The rows are read in one SQLite read transaction (a WAL snapshot: consistent, and nobody is
blocked), then the account folder is streamed in 1 MiB blocks. Each entry's size and SHA-256 go
into `manifest.json`, written last. The zip is written as `<out>.part` and renamed when done; a
failure or cancel deletes it.
"""

from __future__ import annotations

import hashlib
import os
import sqlite3
import threading
import time
import zipfile
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import UTC, datetime
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
from typing import IO, Any

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from unihelper.backup import manifest as mf
from unihelper.backup import rows as rowcodec
from unihelper.backup.tables import COLUMN_OVERRIDES, INCLUDED, ROW_FILTERS, account_where
from unihelper.config import Settings
from unihelper.models import Recording, User
from unihelper.services import recording_service
from unihelper.storage import backup_fs
from unihelper.storage.storage_service import StorageService
from unihelper.transcription.providers import all_specs

BLOCK = 1024 * 1024
PROGRESS_EVERY = 0.25  # seconds
# already compressed: storing them again with deflate only costs time
STORED_EXTENSIONS = frozenset(
    {
        ".webm",
        ".m4a",
        ".mp3",
        ".aac",
        ".wav",
        ".ogg",
        ".oga",
        ".opus",
        ".flac",
        ".mp4",
        ".pdf",
        ".png",
        ".jpg",
        ".jpeg",
        ".gif",
        ".webp",
        ".zip",
        ".gz",
    }
)

Progress = Callable[[int, int | None], None]


class Cancelled(Exception):
    """The student cancelled the backup."""


@dataclass(frozen=True)
class Account:
    id: str
    username: str
    timezone: str


@dataclass
class _Writer:
    zf: zipfile.ZipFile
    entries: list[mf.Entry] = field(default_factory=list)


def app_version(settings: Settings) -> str:
    if settings.app_version:
        return settings.app_version
    try:
        return version("unihelper")
    except PackageNotFoundError:  # pragma: no cover - running from an unpacked tree
        return "0.0.0"


def account_of(user: User) -> Account:
    return Account(user.id, user.username, user.timezone)


# ---- counts (shared with the restore summary) ----------------------------------------------

_COUNT_SQL = {
    "semesters": "SELECT COUNT(*) FROM semesters WHERE user_id = :uid",
    "courses": "SELECT COUNT(*) FROM courses WHERE user_id = :uid",
    "sessions": "SELECT COUNT(*) FROM session_folders WHERE user_id = :uid AND kind = 'class'",
    "events": "SELECT COUNT(*) FROM event_series WHERE user_id = :uid",
    "notes": "SELECT COUNT(*) FROM notes WHERE user_id = :uid",
    "recordings": "SELECT COUNT(*) FROM recordings WHERE user_id = :uid",
    "documents": "SELECT COUNT(*) FROM documents WHERE user_id = :uid",
    "chats": "SELECT COUNT(*) FROM chats WHERE user_id = :uid",
    "tasks": "SELECT COUNT(*) FROM tasks WHERE user_id = :uid",
    "themes": "SELECT COUNT(*) FROM themes WHERE user_id = :uid",
}


def row_counts(conn: sqlite3.Connection, uid: str) -> dict[str, int]:
    return {k: int(conn.execute(sql, {"uid": uid}).fetchone()[0]) for k, sql in _COUNT_SQL.items()}


def connect(db_path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path, timeout=30, isolation_level=None, check_same_thread=False)
    conn.execute("PRAGMA busy_timeout=30000")
    return conn


def tables_in(conn: sqlite3.Connection, schema: str = "main") -> set[str]:
    rows = conn.execute(f"SELECT name FROM {schema}.sqlite_master WHERE type = 'table'")
    return {r[0] for r in rows}


# ---- what to leave out ---------------------------------------------------------------------


@dataclass
class _Leftovers:
    recording_ids: list[str] = field(default_factory=list)
    files: set[Path] = field(default_factory=set)
    excluded: list[mf.Excluded] = field(default_factory=list)


def _active_recordings(
    maker: sessionmaker[Session], storage: StorageService, account: Account
) -> _Leftovers:
    """Recordings still being recorded: their rows and audio aren't part of a snapshot."""
    out = _Leftovers()
    with maker() as db:
        user = db.get(User, account.id)
        if user is None:
            return out
        rows = db.scalars(
            select(Recording).where(
                Recording.user_id == account.id, Recording.status == "recording"
            )
        ).all()
        for r in rows:
            if not recording_service.is_active(r):
                continue
            out.recording_ids.append(r.id)
            out.excluded.append(mf.Excluded(reason="recording_in_progress", name=r.name))
            try:
                parts, _folder = recording_service._parts(db, user, r)
                out.files.add(storage.path_for(parts))
            except Exception:  # pragma: no cover - a recording without a folder has no file
                pass
    return out


def _keys_left_out(conn: sqlite3.Connection, uid: str) -> list[mf.KeyLeftOut]:
    names = {s.id: s.name for s in all_specs()}
    out = [
        mf.KeyLeftOut(kind="transcription_provider", id=pid, name=names.get(pid, pid))
        for (pid,) in conn.execute(
            "SELECT provider_id FROM provider_configs WHERE user_id = :uid"
            " AND (secret_id IS NOT NULL OR secret IS NOT NULL) ORDER BY provider_id",
            {"uid": uid},
        )
    ]
    out += [
        mf.KeyLeftOut(kind="ai_endpoint", id=eid, name=name)
        for eid, name in conn.execute(
            "SELECT id, name FROM ai_endpoints WHERE user_id = :uid AND secret_id IS NOT NULL"
            " ORDER BY name",
            {"uid": uid},
        )
    ]
    # 021: the proxy password (secrets are never in a backup)
    out += [
        mf.KeyLeftOut(kind="proxy", id=uid, name="Proxy")
        for _ in conn.execute(
            "SELECT 1 FROM secrets WHERE user_id = :uid AND owner_kind = 'proxy'", {"uid": uid}
        )
    ]
    return out


def account_rows(
    conn: sqlite3.Connection, table: str, uid: str, leftovers: _Leftovers | None = None
) -> Iterator[dict[str, Any]]:
    where = [account_where(table)]
    params: dict[str, Any] = {"uid": uid}
    if table in ROW_FILTERS:
        where.append(ROW_FILTERS[table])
    ids = leftovers.recording_ids if leftovers else []
    if ids and table in ("recordings", "transcription_jobs"):
        col = "id" if table == "recordings" else "recording_id"
        marks = ", ".join(f":r{i}" for i in range(len(ids)))
        where.append(f"{col} NOT IN ({marks})")
        params.update({f"r{i}": v for i, v in enumerate(ids)})
    cur = conn.execute(f"SELECT * FROM {table} WHERE {' AND '.join(where)}", params)
    names = [d[0] for d in cur.description]
    overrides = COLUMN_OVERRIDES.get(table, {})
    for values in cur:
        row = dict(zip(names, values, strict=True))
        for k, v in overrides.items():
            if k in row:
                row[k] = v
        yield row


# ---- zip writing ---------------------------------------------------------------------------


def _zip_time(ts: float) -> tuple[int, int, int, int, int, int]:
    t = time.localtime(max(ts, 315532800))  # zip can't store times before 1980
    return (t.tm_year, t.tm_mon, t.tm_mday, t.tm_hour, t.tm_min, t.tm_sec)


@contextmanager
def _entry(w: _Writer, name: str, mtime: float, stored: bool) -> Iterator[IO[bytes]]:
    info = zipfile.ZipInfo(name, date_time=_zip_time(mtime))
    info.compress_type = zipfile.ZIP_STORED if stored else zipfile.ZIP_DEFLATED
    info.external_attr = 0o100644 << 16
    digest = hashlib.sha256()
    size = 0
    with w.zf.open(info, "w", force_zip64=True) as raw:

        class _Hashing:
            def write(self, data: bytes) -> int:
                nonlocal size
                digest.update(data)
                size += len(data)
                return raw.write(data)

        yield _Hashing()  # type: ignore[misc]
    w.entries.append(mf.Entry(path=name, size=size, sha256=digest.hexdigest()))


class _Ticker:
    def __init__(self, progress: Progress | None, total: int, cancel: threading.Event | None):
        self.progress, self.total, self.cancel = progress, total, cancel
        self.done = 0
        self._last = 0.0

    def add(self, n: int) -> None:
        self.done += n
        if self.cancel is not None and self.cancel.is_set():
            raise Cancelled()
        now = time.monotonic()
        if self.progress and now - self._last >= PROGRESS_EVERY:
            self._last = now
            self.progress(self.done, self.total)

    def finish(self) -> None:
        if self.progress:
            self.progress(self.total, self.total)


def write_backup(
    settings: Settings,
    maker: sessionmaker[Session],
    storage: StorageService,
    account: Account,
    out_path: Path,
    progress: Progress | None = None,
    cancel: threading.Event | None = None,
) -> mf.Manifest:
    """Write the account's backup to `out_path` (atomically) and return its manifest."""
    leftovers = _active_recordings(maker, storage, account)
    user_root = storage.user_root(account.username)
    files = list(backup_fs.walk_account(user_root, frozenset(leftovers.files)))
    total = sum(size for _rel, _p, size in files)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    part = out_path.with_name(out_path.name + ".part")
    created = datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")
    ticker = _Ticker(progress, total, cancel)
    try:
        with zipfile.ZipFile(part, "w", allowZip64=True) as zf:
            w = _Writer(zf)
            now = time.time()
            conn = connect(settings.db_path)
            try:
                conn.execute("BEGIN")  # the snapshot starts with the first read below
                timezone_row = conn.execute(
                    "SELECT timezone FROM users WHERE id = ?", (account.id,)
                ).fetchone()
                counts = row_counts(conn, account.id)
                keys = _keys_left_out(conn, account.id)
                present = tables_in(conn)
                for table in INCLUDED:
                    if table not in present:
                        continue
                    with _entry(w, f"{mf.DATA_PREFIX}{table}.jsonl", now, stored=False) as fh:
                        for row in account_rows(conn, table, account.id, leftovers):
                            fh.write(rowcodec.dumps_row(row))
                        ticker.add(0)
                conn.execute("COMMIT")
            finally:
                conn.close()
            for rel, path, _size in files:
                try:
                    src = open(path, "rb")  # noqa: SIM115 - closed below
                    mtime = os.fstat(src.fileno()).st_mtime
                except FileNotFoundError:  # deleted since the walk: it isn't part of the backup
                    continue
                with src:
                    stored = Path(rel).suffix.lower() in STORED_EXTENSIONS
                    with _entry(w, f"{mf.FILES_PREFIX}{rel}", mtime, stored) as fh:
                        while block := src.read(BLOCK):
                            fh.write(block)
                            ticker.add(len(block))
            counts["files"] = sum(1 for e in w.entries if e.path.startswith(mf.FILES_PREFIX))
            counts["bytes"] = sum(e.size for e in w.entries if e.path.startswith(mf.FILES_PREFIX))
            manifest = mf.Manifest(
                kind="unihelper-backup",
                format_version=mf.FORMAT_VERSION,
                app_version=app_version(settings),
                schema_revision=mf.head_revision(),
                created_at=created,
                source="desktop" if settings.desktop else "web",
                account=mf.Account(timezone=timezone_row[0] if timezone_row else account.timezone),
                counts=counts,
                keys_left_out=keys,
                excluded=leftovers.excluded,
                entries=sorted(w.entries, key=lambda e: e.path),
            )
            readme = zipfile.ZipInfo(mf.README, date_time=_zip_time(now))
            readme.compress_type = zipfile.ZIP_DEFLATED
            zf.writestr(readme, mf.README_TEXT.encode())
            info = zipfile.ZipInfo(mf.MANIFEST, date_time=_zip_time(now))
            info.compress_type = zipfile.ZIP_DEFLATED
            zf.writestr(info, manifest.to_json())
        with open(part, "rb") as fh:
            os.fsync(fh.fileno())
        os.replace(part, out_path)
        ticker.finish()
        return manifest
    except BaseException:
        backup_fs.remove_file(part)
        raise
