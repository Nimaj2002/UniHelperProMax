"""Backup and restore jobs, run in background threads (research R12; data-model "Backup job").

At most one job per account, two exports and one confirmed restore per server. Job state is in
memory: a restart drops exports (startup sweeps their files) and recovers restores through the
journal. `AccountLocks` marks an account whose data is being replaced; its other requests get
423 until the restore ends.
"""

from __future__ import annotations

import logging
import threading
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import uuid_utils
from sqlalchemy.orm import Session, sessionmaker

from unihelper.api.errors import ApiError, not_found
from unihelper.backup import errors, reader, restore
from unihelper.backup.errors import JobError
from unihelper.backup.writer import Account, Cancelled, write_backup
from unihelper.chat.runs import RunRegistry
from unihelper.config import Settings
from unihelper.storage import backup_fs
from unihelper.storage.storage_service import StorageService

log = logging.getLogger("unihelper.backup")

KEEP_FOR = timedelta(hours=1)
FORGET_AFTER = timedelta(hours=24)
MAX_EXPORTS = 2

TERMINAL = frozenset({"ready", "done", "rolled_back", "failed", "cancelled", "expired"})
CONFIRMED = frozenset({"safety_backup", "staging", "swapping", "cleanup"})


def _now() -> datetime:
    return datetime.now(UTC)


def _iso(dt: datetime | None) -> str | None:
    return dt.isoformat(timespec="seconds").replace("+00:00", "Z") if dt else None


@dataclass
class BackupJob:
    id: str
    user_id: str
    kind: str  # export | restore
    phase: str
    bytes_done: int = 0
    bytes_total: int | None = None
    error: JobError | None = None
    summary: dict[str, Any] | None = None
    file_name: str | None = None
    size: int | None = None
    expires_at: datetime | None = None
    ended_at: datetime | None = None
    path: Path | None = None  # the export zip, or the uploaded backup being restored
    cancel: threading.Event = field(default_factory=threading.Event)

    @property
    def running(self) -> bool:
        return self.phase not in TERMINAL and self.phase != "awaiting_confirmation"

    def view(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "id": self.id,
            "kind": self.kind,
            "phase": self.phase,
            "bytesDone": self.bytes_done,
            "bytesTotal": self.bytes_total,
            "expiresAt": _iso(self.expires_at),
        }
        if self.file_name is not None:
            out["fileName"] = self.file_name
            out["size"] = self.size
        if self.summary is not None:
            out["summary"] = self.summary
        if self.error is not None:
            out["error"] = self.error.as_dict()
        return out


class AccountLocks:
    def __init__(self) -> None:
        self._locked: dict[str, str] = {}
        self._mutex = threading.Lock()

    def lock(self, user_id: str, job_id: str) -> None:
        with self._mutex:
            self._locked[user_id] = job_id

    def unlock(self, user_id: str) -> None:
        with self._mutex:
            self._locked.pop(user_id, None)

    def locked_job(self, user_id: str) -> str | None:
        return self._locked.get(user_id)

    def locked_users(self) -> frozenset[str]:
        with self._mutex:
            return frozenset(self._locked)


class BackupJobs:
    def __init__(
        self,
        settings: Settings,
        maker: sessionmaker[Session],
        storage: StorageService,
        runs: RunRegistry,
        locks: AccountLocks,
    ) -> None:
        self.settings = settings
        self.maker = maker
        self.storage = storage
        self.runs = runs
        self.locks = locks
        self.sync = False  # tests run jobs inline
        self.windows_names: bool | None = None  # tests check Windows file-name rules
        self._jobs: dict[str, BackupJob] = {}
        self._mutex = threading.Lock()

    @property
    def ctx(self) -> restore.Context:
        return restore.Context(self.settings, self.maker, self.storage)

    # ---- bookkeeping ----------------------------------------------------------------------

    def _run(self, fn: Callable[[BackupJob], None], job: BackupJob) -> None:
        if self.sync:
            fn(job)
        else:
            threading.Thread(target=fn, args=(job,), name=f"backup-{job.id}", daemon=True).start()

    def _end(self, job: BackupJob, phase: str, error: JobError | None = None) -> None:
        job.phase = phase
        job.error = error
        job.ended_at = _now()
        log.info(
            "backup job %s (%s) ended: %s%s",
            job.id,
            job.kind,
            phase,
            f" [{error.code}]" if error else "",
        )

    def _progress(self, job: BackupJob) -> Callable[[int, int | None], None]:
        def update(done: int, total: int | None) -> None:
            job.bytes_done, job.bytes_total = done, total

        return update

    def _set_phase(self, job: BackupJob) -> Callable[[str], None]:
        def update(phase: str) -> None:
            log.info("backup job %s (%s): %s", job.id, job.kind, phase)
            job.phase = phase
            job.bytes_done, job.bytes_total = 0, None

        return update

    def _discard_files(self, job: BackupJob) -> None:
        if job.path is None:
            return
        if job.kind == "export":
            backup_fs.remove_file(job.path)
        else:
            self.storage.discard_upload(job.path)
        job.path = None

    def expire(self) -> None:
        now = _now()
        with self._mutex:
            for job in list(self._jobs.values()):
                waiting = job.phase in ("ready", "awaiting_confirmation")
                if waiting and job.expires_at and job.expires_at <= now:
                    self._discard_files(job)
                    self._end(job, "expired")
                if job.phase in TERMINAL and job.ended_at and now - job.ended_at > FORGET_AFTER:
                    del self._jobs[job.id]

    def get(self, user_id: str, job_id: str) -> BackupJob:
        self.expire()
        job = self._jobs.get(job_id)
        if job is None or job.user_id != user_id:
            raise not_found("Backup job")
        return job

    def busy(self, user_id: str) -> BackupJob | None:
        return next((j for j in self._jobs.values() if j.user_id == user_id and j.running), None)

    def other_running(self, user_id: str, job_id: str) -> bool:
        return any(
            j.user_id == user_id and j.running and j.id != job_id for j in self._jobs.values()
        )

    def _new(self, user_id: str, kind: str, phase: str) -> BackupJob:
        job = BackupJob(id=str(uuid_utils.uuid7()), user_id=user_id, kind=kind, phase=phase)
        self._jobs[job.id] = job
        return job

    # ---- export ---------------------------------------------------------------------------

    def start_export(self, account: Account) -> BackupJob:
        self.expire()
        user_root = self.storage.user_root(account.username)
        backup_fs.check_space(self.settings.exports_dir, backup_fs.tree_size(user_root))
        with self._mutex:
            busy = self.busy(account.id)
            if busy is not None:
                raise errors.backup_busy(busy.id)
            if sum(1 for j in self._jobs.values() if j.kind == "export" and j.running) >= (
                MAX_EXPORTS
            ):
                raise errors.backup_capacity()
            for old in self._jobs.values():  # one finished backup per account at a time
                if old.user_id == account.id and old.kind == "export" and old.phase == "ready":
                    self._discard_files(old)
                    self._end(old, "expired")
            job = self._new(account.id, "export", "preparing")
        self._run(lambda j: self._export(j, account), job)
        return job

    def _export(self, job: BackupJob, account: Account) -> None:
        target = self.settings.exports_dir / account.id / f"{job.id}.zip"
        try:
            job.phase = "writing"
            write_backup(
                self.settings,
                self.maker,
                self.storage,
                account,
                target,
                self._progress(job),
                job.cancel,
            )
        except Cancelled:
            self._end(job, "cancelled")
            return
        except ApiError as err:
            self._end(job, "failed", errors.job_error(err))
            return
        except Exception:
            log.exception("backup job %s failed", job.id)
            self._end(job, "failed", JobError("backup_failed", "The backup couldn't be made."))
            return
        job.path = target
        job.size = target.stat().st_size
        job.file_name = file_name(account.timezone)
        job.expires_at = _now() + KEEP_FOR
        self._end(job, "ready")

    # ---- restore --------------------------------------------------------------------------

    def create_restore(self, account: Account, upload: Path) -> BackupJob:
        self.expire()
        with self._mutex:
            busy = self.busy(account.id)
            if busy is not None:
                self.storage.discard_upload(upload)
                raise errors.backup_busy(busy.id)
            job = self._new(account.id, "restore", "validating")
            job.path = upload
        self._run(lambda j: self._validate(j, account), job)
        return job

    def _validate(self, job: BackupJob, account: Account) -> None:
        try:
            _manifest, summary = reader.validate_backup(
                job.path,  # type: ignore[arg-type]
                self.settings,
                self.storage,
                account,
                self._progress(job),
                self.windows_names,
            )
        except ApiError as err:
            self._discard_files(job)
            self._end(job, "failed", errors.job_error(err))
            return
        except Exception:
            log.exception("restore job %s: validation failed", job.id)
            self._discard_files(job)
            self._end(job, "failed", errors.job_error(errors.backup_damaged()))
            return
        if job.cancel.is_set():
            self._discard_files(job)
            self._end(job, "cancelled")
            return
        job.summary = summary
        job.expires_at = _now() + KEEP_FOR
        job.phase = "awaiting_confirmation"

    def confirm_restore(self, account: Account, job_id: str) -> BackupJob:
        job = self.get(account.id, job_id)
        with self._mutex:
            if job.kind != "restore" or job.phase != "awaiting_confirmation":
                raise errors.not_awaiting_confirmation()
            restore.check_gate(
                self.maker, account.id, self.runs, self.other_running(account.id, job.id)
            )
            if any(j.kind == "restore" and j.phase in CONFIRMED for j in self._jobs.values()):
                raise errors.restore_capacity()
            # space for the safety backup and for the restored files, before anything changes
            current = backup_fs.tree_size(self.storage.user_root(account.username))
            backup_fs.check_space(self.settings.backups_dir, current, "backups")
            incoming = int((job.summary or {}).get("counts", {}).get("bytes", 0))
            backup_fs.check_space(self.storage.files_root, incoming, "files")
            self.locks.lock(account.id, job.id)
            job.phase = "safety_backup"
            job.expires_at = None
        self._run(lambda j: self._restore(j, account), job)
        return job

    def _restore(self, job: BackupJob, account: Account) -> None:
        upload = job.path
        assert upload is not None
        phase, error = "done", None
        try:
            restore.run_restore(
                self.ctx, account, job.id, upload, self._set_phase(job), self._progress(job)
            )
        except ApiError as err:
            phase, error = "rolled_back", errors.job_error(err)
        except Exception:
            log.exception("restore job %s failed", job.id)
            phase, error = "rolled_back", errors.job_error(errors.restore_failed())
        finally:
            self._discard_files(job)
            # unlock before the phase says so: a client reloads as soon as it sees "done"
            self.locks.unlock(account.id)
        self._end(job, phase, error)

    # ---- cancel ---------------------------------------------------------------------------

    def cancel(self, user_id: str, job_id: str) -> None:
        job = self.get(user_id, job_id)
        with self._mutex:
            if job.kind == "restore" and job.phase in CONFIRMED:
                raise errors.restore_running()
            if job.phase in TERMINAL and job.phase != "ready":
                return
            job.cancel.set()
            if job.phase in ("ready", "awaiting_confirmation"):
                self._discard_files(job)
                self._end(job, "cancelled")

    # ---- safety backup --------------------------------------------------------------------

    def safety(self, user_id: str) -> dict[str, Any] | None:
        return reader.safety_info(self.settings, user_id)


def file_name(timezone: str, prefix: str = "UniHelperProMax-backup") -> str:
    try:
        local = _now().astimezone(ZoneInfo(timezone))
    except Exception:  # an unknown zone: use UTC rather than fail the backup
        local = _now()
    return f"{prefix}-{local:%Y-%m-%d-%H%M}.zip"
