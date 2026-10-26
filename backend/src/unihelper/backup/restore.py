"""Replace one account's data with a validated backup, all or nothing (research R7).

safety backup → scratch database at the backup's revision, upgraded to head → files extracted
next to the account folder → journal → folder swap by rename → one transaction replacing the
account's rows (commit point) → cleanup. Before the commit every failure puts things back;
startup recovery (recovery.py) does the same after a crash, using the journal.
"""

from __future__ import annotations

import json
import logging
import os
import sqlite3
import time
import zipfile
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from unihelper.backup import errors
from unihelper.backup import manifest as mf
from unihelper.backup import rows as rowcodec
from unihelper.backup.reader import open_backup, stream_entry
from unihelper.backup.tables import INCLUDED, account_where
from unihelper.backup.writer import Account, Progress, connect, tables_in, write_backup
from unihelper.chat.runs import RunRegistry
from unihelper.config import Settings
from unihelper.db.migrate import upgrade_to
from unihelper.models import Recording, TranscriptionJob
from unihelper.models.transcription import ACTIVE_STATUSES
from unihelper.services import recording_service
from unihelper.storage import backup_fs
from unihelper.storage.storage_service import StorageService

log = logging.getLogger("unihelper.backup")

INSERT_BATCH = 500


@dataclass(frozen=True)
class Context:
    settings: Settings
    maker: sessionmaker[Session]
    storage: StorageService


# ---- gate (FR-017) -------------------------------------------------------------------------


def check_gate(
    maker: sessionmaker[Session], uid: str, runs: RunRegistry, other_job: bool
) -> None:
    reasons: list[str] = []
    items: list[dict[str, str]] = []
    with maker() as db:
        for r in db.scalars(
            select(Recording).where(Recording.user_id == uid, Recording.status == "recording")
        ):
            if recording_service.is_active(r):
                items.append({"reason": "recording_in_progress", "name": r.name})
        active_jobs = db.scalar(
            select(func.count())
            .select_from(TranscriptionJob)
            .where(TranscriptionJob.user_id == uid, TranscriptionJob.status.in_(ACTIVE_STATUSES))
        )
    if any(i["reason"] == "recording_in_progress" for i in items):
        reasons.append("recording_in_progress")
    if active_jobs:
        reasons.append("transcription_running")
    if runs.active(uid):
        reasons.append("chat_answer_running")
    if other_job:
        reasons.append("job_running")
    if reasons:
        raise errors.restore_blocked(reasons, items)


# ---- paths ---------------------------------------------------------------------------------


@dataclass(frozen=True)
class Paths:
    account_dir: Path
    staging_dir: Path
    old_dir: Path
    scratch_db: Path
    journal: Path

    @staticmethod
    def of(ctx: Context, account: Account, job_id: str) -> Paths:
        root = ctx.storage.files_root
        return Paths(
            account_dir=ctx.storage.user_root(account.username),
            staging_dir=root / f"{backup_fs.RESTORE_PREFIX}{job_id}",
            old_dir=root / f"{backup_fs.RESTORE_PREFIX}{job_id}-old",
            scratch_db=ctx.settings.backups_dir / f"restore-{job_id}.sqlite3",
            journal=ctx.settings.journal_path(account.id),
        )


def _discard(paths: Paths) -> None:
    for d in (paths.staging_dir, paths.old_dir):
        if d.exists():
            backup_fs.remove_tree(d)
    for f in (paths.scratch_db, Path(f"{paths.scratch_db}-journal"), paths.journal):
        backup_fs.remove_file(f)


# ---- safety backup (FR-014) ----------------------------------------------------------------


def make_safety_backup(ctx: Context, account: Account, progress: Progress | None = None) -> Path:
    folder = ctx.settings.safety_dir / account.id
    older = sorted(folder.glob("safety-*.zip"))
    backup_fs.check_space(
        ctx.settings.backups_dir,
        backup_fs.tree_size(ctx.storage.user_root(account.username)),
        "backups",
    )
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    target = folder / f"safety-{stamp}.zip"
    write_backup(ctx.settings, ctx.maker, ctx.storage, account, target, progress)
    for old in older:  # only once the new one is complete
        if old != target:
            backup_fs.remove_file(old)
    return target


# ---- scratch database (R7 step 4, FR-019) --------------------------------------------------


def _columns(conn: sqlite3.Connection, table: str, schema: str = "main") -> list[str]:
    return [r[1] for r in conn.execute(f"PRAGMA {schema}.table_info({table})")]


def build_scratch_db(
    ctx: Context, account: Account, zf: zipfile.ZipFile, manifest: mf.Manifest, scratch: Path
) -> None:
    scratch.parent.mkdir(parents=True, exist_ok=True)
    backup_fs.remove_file(scratch)
    url = f"sqlite:///{scratch}"
    upgrade_to(url, manifest.schema_revision)
    main = connect(ctx.settings.db_path)
    try:
        user_row = main.execute("SELECT * FROM users WHERE id = ?", (account.id,))
        names = [d[0] for d in user_row.description]
        user_values = dict(zip(names, user_row.fetchone(), strict=True))
    finally:
        main.close()
    conn = sqlite3.connect(scratch, isolation_level=None)
    try:
        conn.execute("PRAGMA foreign_keys=OFF")
        conn.execute("BEGIN")
        cols = [c for c in _columns(conn, "users") if c in user_values]
        conn.execute(
            f"INSERT INTO users ({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))})",
            [user_values[c] for c in cols],
        )
        present = tables_in(conn)
        for entry in manifest.entries:
            if not entry.path.startswith(mf.DATA_PREFIX):
                continue
            table = entry.path[len(mf.DATA_PREFIX) : -len(".jsonl")]
            if table not in present:
                raise errors.backup_damaged(f"The backup has data for an unknown table: {table}")
            allowed = set(_columns(conn, table))
            with zf.open(entry.path) as fh:
                batch: list[dict[str, Any]] = []
                for row in rowcodec.iter_jsonl(fh):
                    if "user_id" in row:
                        row["user_id"] = account.id
                    if not set(row) <= allowed:
                        raise errors.backup_damaged(f"The backup has unknown columns in {table}.")
                    batch.append(row)
                    if len(batch) >= INSERT_BATCH:
                        _insert(conn, table, batch)
                        batch = []
                _insert(conn, table, batch)
        conn.execute("COMMIT")
    finally:
        conn.close()
    if manifest.schema_revision != mf.head_revision():
        log.info("restore: upgrading backup data from %s to %s", manifest.schema_revision,
                 mf.head_revision())
        upgrade_to(url, "head")
    conn = sqlite3.connect(scratch)
    try:
        if conn.execute("PRAGMA foreign_key_check").fetchone():
            raise errors.backup_damaged("The backup's data has broken references.")
    finally:
        conn.close()


def _insert(conn: sqlite3.Connection, table: str, rows: list[dict[str, Any]]) -> None:
    by_cols: dict[tuple[str, ...], list[list[Any]]] = {}
    for row in rows:
        key = tuple(row)
        by_cols.setdefault(key, []).append([row[c] for c in key])
    for cols, values in by_cols.items():
        conn.executemany(
            f"INSERT INTO {table} ({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))})",
            values,
        )


# ---- files (R7 step 5) ---------------------------------------------------------------------


def stage_files(
    ctx: Context,
    zf: zipfile.ZipFile,
    manifest: mf.Manifest,
    staging: Path,
    progress: Progress | None = None,
) -> None:
    files = [e for e in manifest.entries if e.path.startswith(mf.FILES_PREFIX)]
    total = sum(e.size for e in files)
    backup_fs.check_space(ctx.storage.files_root, total, "files")
    staging.mkdir(parents=True, exist_ok=False)
    done = 0
    for entry in files:
        rel = entry.path[len(mf.FILES_PREFIX) :]
        target = backup_fs.safe_extract_target(staging, rel)
        target.parent.mkdir(parents=True, exist_ok=True)
        with open(target, "xb") as out:
            stream_entry(zf, entry, out.write)
            out.flush()
            os.fsync(out.fileno())
        info = zf.getinfo(entry.path)
        try:
            mtime = time.mktime((*info.date_time, 0, 0, -1))
            os.utime(target, (mtime, mtime))
        except (OverflowError, ValueError, OSError):  # pragma: no cover - keep "now"
            pass
        done += entry.size
        if progress:
            progress(done, total)


# ---- swap + commit (R7 steps 7–8) ----------------------------------------------------------


def _write_journal(paths: Paths, data: dict[str, Any]) -> None:
    backup_fs.write_json_atomic(paths.journal, json.dumps(data).encode())


def current_epoch(settings: Settings, uid: str) -> int:
    conn = connect(settings.db_path)
    try:
        row = conn.execute("SELECT data_epoch FROM users WHERE id = ?", (uid,)).fetchone()
        return int(row[0]) if row else 0
    finally:
        conn.close()


def replace_rows(settings: Settings, account: Account, scratch: Path, timezone: str) -> None:
    """One transaction: delete the account's rows (and its keys), insert the restored rows."""
    conn = connect(settings.db_path)
    try:
        conn.execute("PRAGMA foreign_keys=ON")
        conn.execute("ATTACH DATABASE ? AS s", (str(scratch),))
        conn.execute("BEGIN IMMEDIATE")
        try:
            conn.execute("PRAGMA defer_foreign_keys=ON")
            present = tables_in(conn, "s")
            for table in reversed(INCLUDED):
                conn.execute(f"DELETE FROM main.{table} WHERE {account_where(table)}",
                             {"uid": account.id})
            conn.execute("DELETE FROM main.secrets WHERE user_id = ?", (account.id,))
            for table in INCLUDED:
                if table not in present:
                    continue
                cols = ", ".join(_columns(conn, table))
                conn.execute(f"INSERT INTO main.{table} ({cols}) SELECT {cols} FROM s.{table}")
            conn.execute(
                "UPDATE main.users SET timezone = ?, data_epoch = data_epoch + 1 WHERE id = ?",
                (timezone, account.id),
            )
            if conn.execute("PRAGMA main.foreign_key_check").fetchone():
                raise errors.restore_failed("The restored data has broken references.")
            conn.execute("COMMIT")
        except BaseException:
            conn.execute("ROLLBACK")
            raise
    finally:
        conn.close()


# ---- the whole run -------------------------------------------------------------------------


def run_restore(
    ctx: Context,
    account: Account,
    job_id: str,
    upload: Path,
    set_phase: Callable[[str], None],
    progress: Progress,
) -> None:
    """Raises on failure, after putting the account's data back as it was."""
    paths = Paths.of(ctx, account, job_id)
    set_phase("safety_backup")
    make_safety_backup(ctx, account, progress)
    zf, manifest = open_backup(upload)
    with zf:
        committed = False
        swapped = False
        try:
            set_phase("staging")
            build_scratch_db(ctx, account, zf, manifest, paths.scratch_db)
            stage_files(ctx, zf, manifest, paths.staging_dir, progress)
            set_phase("swapping")
            epoch = current_epoch(ctx.settings, account.id)
            _write_journal(paths, {
                "jobId": job_id,
                "userId": account.id,
                "username": account.username,
                "phase": "swapping",
                "epochBefore": epoch,
                "accountDir": str(paths.account_dir),
                "stagingDir": str(paths.staging_dir),
                "oldDir": str(paths.old_dir),
                "scratchDb": str(paths.scratch_db),
            })
            swapped = True
            backup_fs.swap_dirs(paths.account_dir, paths.staging_dir, paths.old_dir)
            replace_rows(ctx.settings, account, paths.scratch_db, manifest.account.timezone)
            committed = True
        except BaseException:
            if not committed:
                if swapped:
                    try:
                        backup_fs.unswap_dirs(paths.account_dir, paths.staging_dir, paths.old_dir)
                    except Exception:  # leave the journal: startup recovery finishes the undo
                        log.exception("restore %s: could not put the folder back", job_id)
                        raise
                _discard(paths)
            raise
    set_phase("cleanup")
    _write_journal(paths, {"jobId": job_id, "userId": account.id, "phase": "cleanup"})
    _discard(paths)

