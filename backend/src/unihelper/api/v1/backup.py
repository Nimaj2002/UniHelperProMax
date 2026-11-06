"""016: /api/v1/backup/* — full backup and restore of the signed-in account
(contracts/backup-api.md). Every operation acts on the caller's own account only."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Request, Response, status
from fastapi.responses import FileResponse

from unihelper.api.deps import CurrentUser, Storage
from unihelper.api.errors import ApiError, not_found
from unihelper.api.uploads import declared_length, receive_upload
from unihelper.backup import errors
from unihelper.backup.jobs import BackupJobs, file_name
from unihelper.backup.writer import account_of
from unihelper.schemas.backup import BackupJob, RestoreConfirm, SafetyBackup

router = APIRouter(prefix="/backup", tags=["backup"])

MAX_RESTORE_BYTES = 20 * 1024**3  # FR-023


def _jobs(request: Request) -> BackupJobs:
    jobs: BackupJobs = request.app.state.backup_jobs
    return jobs


def _zip(path: Any, name: str) -> FileResponse:
    return FileResponse(path, media_type="application/zip", filename=name)


# ---- backup --------------------------------------------------------------------------------


@router.post("/exports", status_code=status.HTTP_202_ACCEPTED, response_model=BackupJob)
def start_export(request: Request, user: CurrentUser) -> Any:
    return _jobs(request).start_export(account_of(user)).view()


@router.get("/jobs/{job_id}", response_model=BackupJob)
def get_job(job_id: str, request: Request, user: CurrentUser) -> Any:
    return _jobs(request).get(user.id, job_id).view()


@router.delete("/jobs/{job_id}", status_code=status.HTTP_204_NO_CONTENT)
def cancel_job(job_id: str, request: Request, user: CurrentUser) -> Response:
    _jobs(request).cancel(user.id, job_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get(
    "/exports/{job_id}/file",
    response_class=FileResponse,
    responses={200: {"content": {"application/zip": {}}}},
)
def download_export(job_id: str, request: Request, user: CurrentUser) -> FileResponse:
    job = _jobs(request).get(user.id, job_id)
    if job.kind != "export" or job.phase != "ready" or job.path is None or not job.path.is_file():
        raise not_found("Backup file")
    return _zip(job.path, job.file_name or file_name(user.timezone))


# ---- restore -------------------------------------------------------------------------------


@router.post("/restores", status_code=status.HTTP_202_ACCEPTED, response_model=BackupJob)
async def upload_restore(request: Request, user: CurrentUser, storage: Storage) -> Any:
    jobs = _jobs(request)
    busy = jobs.busy(user.id)
    if busy is not None:  # before receiving gigabytes that would be refused anyway
        raise errors.backup_busy(busy.id)
    length = declared_length(request, MAX_RESTORE_BYTES, "A backup")
    staged = await receive_upload(request, storage, length, MAX_RESTORE_BYTES, "A backup")
    return jobs.create_restore(account_of(user), staged.path).view()


@router.post(
    "/restores/{job_id}/confirm", status_code=status.HTTP_202_ACCEPTED, response_model=BackupJob
)
def confirm_restore(job_id: str, body: RestoreConfirm, request: Request, user: CurrentUser) -> Any:
    return _jobs(request).confirm_restore(account_of(user), job_id).view()


# ---- safety backup -------------------------------------------------------------------------


@router.get(
    "/safety",
    response_model=SafetyBackup,
    responses={204: {"description": "No safety backup yet"}},
)
def get_safety(request: Request, user: CurrentUser) -> Any:
    info = _jobs(request).safety(user.id)
    if info is None:
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    desktop = request.app.state.settings.desktop
    return {
        "createdAt": info["createdAt"],
        "size": info["size"],
        "path": str(info["file"]) if desktop else None,
    }


@router.get(
    "/safety/file",
    response_class=FileResponse,
    responses={200: {"content": {"application/zip": {}}}},
)
def download_safety(request: Request, user: CurrentUser) -> FileResponse:
    info = _jobs(request).safety(user.id)
    if info is None:
        raise ApiError(404, "not_found", "There is no safety backup yet.")
    day = str(info["createdAt"])[:10]
    return _zip(info["file"], f"UniHelperProMax-safety-backup-{day}.zip")
