"""Stable error codes of /api/v1/backup/* (contracts/backup-api.md).

Errors found while a job runs in the background are recorded on the job as a `JobError` instead
of being raised to a client; `job_error()` turns an `ApiError` into one.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from unihelper.api.errors import ApiError

MAX_PATHS = 20


@dataclass(frozen=True)
class JobError:
    code: str
    title: str
    detail: str | None = None
    extra: dict[str, Any] | None = None

    def as_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {"code": self.code, "title": self.title}
        if self.detail:
            out["detail"] = self.detail
        if self.extra:
            out.update(self.extra)
        return out


def job_error(err: ApiError) -> JobError:
    return JobError(err.code, err.title, err.detail, err.extra)


def _gb(n: int) -> str:
    return f"{n / 1024**3:.1f} GB" if n >= 1024**3 else f"{max(n, 1) / 1024**2:.0f} MB"


def backup_busy(job_id: str) -> ApiError:
    return ApiError(
        409,
        "backup_busy",
        "A backup or restore is already running.",
        "Wait for it to finish, or cancel it.",
        extra={"jobId": job_id},
    )


def backup_capacity() -> ApiError:
    return ApiError(503, "backup_capacity", "Too many backups are being made right now.",
                    "Try again in a few minutes.")


def restore_capacity() -> ApiError:
    return ApiError(503, "restore_capacity", "Another restore is running on this server.",
                    "Try again in a few minutes.")


def insufficient_storage(needed: int, free: int, where: str | None = None) -> ApiError:
    extra: dict[str, Any] = {"neededBytes": needed, "freeBytes": free}
    if where:
        extra["where"] = where
    return ApiError(
        507,
        "insufficient_storage",
        "There isn't enough free disk space.",
        f"About {_gb(needed)} is needed; {_gb(free)} is free.",
        extra=extra,
    )


def not_a_backup() -> ApiError:
    return ApiError(422, "not_a_backup", "This file isn't a UniHelperProMax backup.")


def backup_damaged(detail: str | None = None) -> ApiError:
    return ApiError(
        422, "backup_damaged", "This backup is damaged or was modified.",
        detail or "Use another copy of the backup.",
    )


def backup_unsafe(paths: list[str]) -> ApiError:
    return ApiError(
        422, "backup_unsafe", "This backup contains unsafe file names, so it can't be restored.",
        extra={"paths": paths[:MAX_PATHS]},
    )


def backup_names_invalid(paths: list[str]) -> ApiError:
    return ApiError(
        422, "backup_names_invalid",
        "Some file names in this backup aren't allowed on this computer.",
        extra={"paths": paths[:MAX_PATHS]},
    )


def backup_too_new(app_version: str) -> ApiError:
    return ApiError(
        422, "backup_too_new",
        f"This backup was made with a newer version ({app_version}).",
        "Update UniHelperProMax first.",
        extra={"appVersion": app_version},
    )


def backup_ids_in_use() -> ApiError:
    return ApiError(
        409, "backup_ids_in_use",
        "This backup belongs to another account on this server.",
        "Sign in to that account to restore it.",
    )


def not_awaiting_confirmation() -> ApiError:
    return ApiError(409, "not_awaiting_confirmation", "This restore can't be confirmed now.")


def restore_blocked(reasons: list[str], items: list[dict[str, str]]) -> ApiError:
    return ApiError(
        409, "restore_blocked", "Your data can't be restored right now.",
        extra={"reasons": reasons, "items": items},
    )


def restore_running() -> ApiError:
    return ApiError(409, "restore_running", "The restore is already running and can't be stopped.",
                    "It finishes, or puts your data back as it was.")


def restore_in_progress(job_id: str) -> ApiError:
    return ApiError(423, "restore_in_progress", "Your data is being restored.",
                    "Wait until the restore has finished.", extra={"jobId": job_id})


def files_in_use(path: str) -> ApiError:
    return ApiError(409, "files_in_use", "A file is open in another program.",
                    "Close it and try again.", extra={"path": path})


def restore_failed(detail: str | None = None) -> ApiError:
    return ApiError(500, "restore_failed", "The restore couldn't be completed.", detail)
