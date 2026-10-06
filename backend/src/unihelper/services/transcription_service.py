"""Transcription jobs (004): start/retry/cancel/list for the API, and the steps the background
worker runs (research B4–B8).

Principle I: the only write to a note is `note_service.append_to_note` (append-only), done once
per job — the section is stored and the status set to `appending` before the file is touched,
and recovery checks the file's tail before appending again.
"""

from __future__ import annotations

import json
import logging
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from unihelper.api.errors import ApiError, not_found
from unihelper.db.engine import on_commit
from unihelper.domain import transcript, webm
from unihelper.domain.naming import name_key
from unihelper.models import Note, Recording, SessionFolder, TranscriptionJob, User
from unihelper.models.base import now_iso
from unihelper.models.transcription import ACTIVE_STATUSES
from unihelper.schemas.transcription import TranscriptionStart
from unihelper.services import note_service
from unihelper.services import recording_service as recs
from unihelper.storage.storage_service import StorageService
from unihelper.transcription import config as provider_config
from unihelper.transcription.base import AudioPart, ProviderError
from unihelper.transcription.providers import SPECS

log = logging.getLogger("unihelper.transcription")
FINISHED = ("completed", "failed", "cancelled")
PART_FILL = 0.9  # parts target 90 % of the provider's per-file limit


class JobCancelled(Exception):
    pass


def _conflict(code: str, title: str) -> ApiError:
    return ApiError(409, code, title)


def _in_progress() -> ApiError:
    return _conflict("transcription_in_progress", "A transcription is already running.")


def _not_configured() -> ApiError:
    return _conflict(
        "provider_not_configured",
        "Set up a transcription provider in Settings → Transcription first.",
    )


# ---- views ---------------------------------------------------------------------------------


def _job(db: Session, user: User, job_id: str) -> TranscriptionJob:
    job = db.get(TranscriptionJob, job_id)
    if job is None or job.user_id != user.id:
        raise not_found("Transcription")
    return job


def view(db: Session, job: TranscriptionJob) -> dict[str, Any]:
    rec = db.get(Recording, job.recording_id)
    assert rec is not None
    folder = db.get(SessionFolder, rec.session_folder_id)
    assert folder is not None
    note = db.get(Note, job.note_id) if job.note_id else None
    spec = SPECS.get(job.provider_id)
    appended = None
    # previous_hash is unknown after crash recovery: then clients simply reload the note
    if job.status == "completed" and job.previous_hash is not None and job.appended_text:
        appended = {
            "text": job.appended_text,
            "previous_hash": job.previous_hash,
            "hash": job.result_hash or "",
            "version": job.result_version or 0,
        }
    return {
        "id": job.id,
        "recording_id": rec.id,
        "recording_name": rec.name,
        "session_key": folder.session_key,
        "course_id": folder.course_id,
        "note_id": note.id if note else None,
        "note_name": note.name if note else job.note_name,
        "language": job.language,
        "provider_id": job.provider_id,
        "provider_name": spec.name if spec else job.provider_id,
        "status": job.status,
        "part_index": job.part_index,
        "part_count": job.part_count,
        "progress": job.progress,
        "stage_started_at": job.stage_started_at,
        "error_category": job.error_category,
        "error_message": job.error_message,
        "settings_related": job.settings_related,
        "cancel_requested": job.cancel_requested,
        "fallback_note_created": job.fallback_note_created,
        "attempts": job.attempts,
        "seen": job.seen,
        "appended": appended,
        "created_at": job.created_at,
        "started_at": job.started_at,
        "finished_at": job.finished_at,
    }


def _active_job(db: Session, user_id: str) -> TranscriptionJob | None:
    return db.scalar(
        select(TranscriptionJob).where(
            TranscriptionJob.user_id == user_id, TranscriptionJob.status.in_(ACTIVE_STATUSES)
        )
    )


def get_job(db: Session, user: User, job_id: str) -> dict[str, Any]:
    return view(db, _job(db, user, job_id))


def active_job(db: Session, user: User) -> dict[str, Any] | None:
    job = _active_job(db, user.id)
    return view(db, job) if job else None


def unseen_jobs(db: Session, user: User) -> list[dict[str, Any]]:
    jobs = db.scalars(
        select(TranscriptionJob)
        .where(
            TranscriptionJob.user_id == user.id,
            TranscriptionJob.status.in_(("completed", "failed")),
            TranscriptionJob.seen.is_(False),
        )
        .order_by(TranscriptionJob.finished_at, TranscriptionJob.id)
    )
    return [view(db, j) for j in jobs]


def session_jobs(db: Session, user: User, key: str) -> list[dict[str, Any]]:
    from unihelper.services import session_folder_service as sfs

    r = sfs.resolve(db, user, key)
    if r.folder is None:
        return []
    jobs = db.scalars(
        select(TranscriptionJob)
        .join(Recording, Recording.id == TranscriptionJob.recording_id)
        .where(TranscriptionJob.user_id == user.id, Recording.session_folder_id == r.folder.id)
        .order_by(TranscriptionJob.created_at.desc(), TranscriptionJob.id.desc())
    )
    return [view(db, j) for j in jobs]


def mark_seen(db: Session, user: User, job_id: str) -> None:
    _job(db, user, job_id).seen = True
    db.flush()


def has_active_job_for_recording(db: Session, recording_id: str) -> bool:
    return (
        db.scalar(
            select(TranscriptionJob.id).where(
                TranscriptionJob.recording_id == recording_id,
                TranscriptionJob.status.in_(ACTIVE_STATUSES),
            )
        )
        is not None
    )


# ---- start / retry / cancel ----------------------------------------------------------------


def _check_recording(db: Session, storage: StorageService, user: User, rec: Recording) -> None:
    if rec.status == "recording":
        raise _conflict("recording_not_finished", "Stop the recording before transcribing it.")
    parts, _ = recs._parts(db, user, rec)
    if storage.read_bytes(parts) is None:
        raise _conflict("file_missing", "The audio file is missing from the session folder.")


def _snapshot_provider(db: Session, user: User, job: TranscriptionJob) -> None:
    active = provider_config.active_provider(db, user)
    if active is None or not active.configured:
        raise _not_configured()
    job.provider_id = active.spec.id
    job.provider_values_json = json.dumps(active.values)


def _queue(db: Session, job: TranscriptionJob, wake: Callable[[], None]) -> None:
    try:
        db.flush()
    except IntegrityError:  # partial unique index: another window started one meanwhile
        db.rollback()
        raise _in_progress() from None
    on_commit(db, wake)


def start(
    db: Session,
    storage: StorageService,
    user: User,
    recording_id: str,
    body: TranscriptionStart,
    wake: Callable[[], None],
) -> dict[str, Any]:
    rec = recs._get(db, user, recording_id)
    _check_recording(db, storage, user, rec)
    folder = db.get(SessionFolder, rec.session_folder_id)
    assert folder is not None
    job = TranscriptionJob(user_id=user.id, recording_id=rec.id, status="queued")
    _snapshot_provider(db, user, job)
    if _active_job(db, user.id) is not None:
        raise _in_progress()
    if body.note_id is not None:
        note = db.get(Note, body.note_id)
        if note is None or note.user_id != user.id or note.session_folder_id != folder.id:
            raise not_found("Note")
        job.note_id, job.note_name = note.id, note.name
    else:
        created = note_service.create_note(
            db, storage, user, folder.session_key, body.new_note_name or ""
        )
        job.note_id, job.note_name = created["id"], created["name"]
    job.language = body.language or provider_config.default_language(db, user)
    db.add(job)
    _queue(db, job, wake)
    return view(db, job)


def retry(
    db: Session, storage: StorageService, user: User, job_id: str, wake: Callable[[], None]
) -> dict[str, Any]:
    job = _job(db, user, job_id)
    if job.status not in ("failed", "cancelled"):
        raise _conflict(
            "job_not_retryable", "Only failed or cancelled transcriptions can be retried."
        )
    if _active_job(db, user.id) is not None:
        raise _in_progress()
    rec = db.get(Recording, job.recording_id)
    assert rec is not None
    _check_recording(db, storage, user, rec)
    _snapshot_provider(db, user, job)
    job.status = "queued"
    job.attempts += 1
    job.error_category = job.error_message = None
    job.settings_related = job.cancel_requested = job.seen = False
    job.progress = None
    job.stage_started_at = job.finished_at = None
    _queue(db, job, wake)
    return view(db, job)


def cancel(
    db: Session, user: User, job_id: str, interrupt: Callable[[str], None]
) -> dict[str, Any]:
    job = _job(db, user, job_id)
    if job.status in FINISHED:
        raise _conflict("job_finished", "This transcription has already finished.")
    if job.status == "queued":
        job.status = "cancelled"
        job.finished_at = now_iso()
        job.seen = True
    elif job.status != "appending":  # appending wins: the job completes (B8)
        job.cancel_requested = True
        on_commit(db, lambda: interrupt(job_id))
    db.flush()
    return view(db, job)


# ---- worker steps (each opens its own short session; called via asyncio.to_thread) --------


Maker = sessionmaker[Session]


@dataclass
class Plan:
    job_id: str
    user_id: str
    provider_id: str
    values: dict[str, str]
    language: str
    parts: list[AudioPart]
    done: list[str]


def recover(maker: Maker) -> list[str]:
    """After a restart: running jobs go back to the queue; returns ids of jobs caught while
    appending (finished by `append_result`, which checks the file first)."""
    with maker() as db:
        db.execute(
            update(TranscriptionJob)
            .where(TranscriptionJob.status.in_(("uploading", "transcribing")))
            .values(status="queued", progress=None, stage_started_at=None)
        )
        appending = list(
            db.scalars(select(TranscriptionJob.id).where(TranscriptionJob.status == "appending"))
        )
        db.commit()
        return appending


def queued_ids(maker: Maker) -> list[str]:
    with maker() as db:
        return list(
            db.scalars(
                select(TranscriptionJob.id)
                .where(TranscriptionJob.status == "queued")
                .order_by(TranscriptionJob.created_at, TranscriptionJob.id)
            )
        )


def claim(maker: Maker, job_id: str) -> bool:
    with maker() as db:
        now = now_iso()
        result = db.execute(
            update(TranscriptionJob)
            .where(TranscriptionJob.id == job_id, TranscriptionJob.status == "queued")
            .values(status="uploading", started_at=now, stage_started_at=now, progress=0.0)
        )
        db.commit()
        return int(getattr(result, "rowcount", 0)) == 1


def prepare(maker: Maker, storage: StorageService, job_id: str) -> Plan:
    """Read the recording and cut it into parts that fit the provider (B5)."""
    with maker() as db:
        job = db.get(TranscriptionJob, job_id)
        assert job is not None
        user = db.get(User, job.user_id)
        rec = db.get(Recording, job.recording_id)
        assert user is not None and rec is not None
        parts_path, _ = recs._parts(db, user, rec)
        data = storage.read_bytes(parts_path)
        if data is None:
            raise ProviderError(
                "file_rejected", "The audio file is missing from the session folder."
            )
        spec = SPECS.get(job.provider_id)
        if spec is None:
            raise ProviderError("not_configured", settings_related=True)
        limit = spec.max_upload_bytes
        stem = rec.file_name.rsplit(".", 1)[0]
        ext = rec.file_name.rsplit(".", 1)[-1]
        if rec.mime_type == "audio/webm":
            try:
                pieces = webm.split(data, int(limit * PART_FILL) if limit else None)
            except webm.WebmError:
                if limit and len(data) > limit:
                    raise ProviderError(
                        "file_rejected", f"This recording is too long for {spec.name}."
                    ) from None
                pieces = [(data, rec.duration_ms)]
        else:
            if limit and len(data) > limit:
                raise ProviderError("file_rejected", f"This recording is too long for {spec.name}.")
            pieces = [(data, rec.duration_ms)]
        audio = [
            AudioPart(
                piece,
                rec.file_name if len(pieces) == 1 else f"{stem}.part{i + 1}.{ext}",
                rec.mime_type,
                duration,
            )
            for i, (piece, duration) in enumerate(pieces)
        ]
        done: list[str] = json.loads(job.part_texts_json or "[]")
        if job.source_size != len(data) or job.part_count != len(audio):
            done = []  # the recording changed since: start over
        job.source_size = len(data)
        job.part_count = len(audio)
        job.part_index = len(done)
        job.part_texts_json = json.dumps(done)
        db.commit()
        return Plan(
            job.id,
            job.user_id,
            job.provider_id,
            json.loads(job.provider_values_json or "{}"),
            job.language,
            audio,
            done,
        )


def check_cancel(maker: Maker, job_id: str) -> None:
    with maker() as db:
        job = db.get(TranscriptionJob, job_id)
        if job is None or job.cancel_requested:
            raise JobCancelled


def set_stage(
    maker: Maker, job_id: str, status: str, part_index: int, progress: float | None
) -> None:
    with maker() as db:
        job = db.get(TranscriptionJob, job_id)
        if job is None:
            return
        if job.status != status or job.part_index != part_index:
            job.stage_started_at = now_iso()
        job.status, job.part_index, job.progress = status, part_index, progress
        db.commit()


def set_progress(maker: Maker, job_id: str, progress: float) -> None:
    with maker() as db:
        db.execute(
            update(TranscriptionJob).where(TranscriptionJob.id == job_id).values(progress=progress)
        )
        db.commit()


def save_part(maker: Maker, job_id: str, index: int, text: str, count: int) -> None:
    with maker() as db:
        job = db.get(TranscriptionJob, job_id)
        assert job is not None
        done: list[str] = json.loads(job.part_texts_json or "[]")[:index]
        done.append(text)
        job.part_texts_json = json.dumps(done)
        job.part_index = min(index + 1, count - 1)
        job.progress = (index + 1) / count
        db.commit()


def _finish(job: TranscriptionJob, status: str) -> None:
    job.status = status
    job.finished_at = now_iso()
    job.stage_started_at = None


def fail(maker: Maker, job_id: str, err: ProviderError) -> None:
    with maker() as db:
        job = db.get(TranscriptionJob, job_id)
        if job is None or job.status in FINISHED:
            return
        _finish(job, "failed")
        job.error_category = err.category
        job.error_message = err.message
        job.settings_related = err.settings_related
        db.commit()
    log.info("transcription failed job=%s category=%s", job_id, err.category)


def mark_cancelled(maker: Maker, job_id: str) -> None:
    with maker() as db:
        job = db.get(TranscriptionJob, job_id)
        if job is None or job.status in FINISHED or job.status == "appending":
            return
        _finish(job, "cancelled")
        job.seen = True  # the user asked for it: no notification
        db.commit()


def _local_start(rec: Recording, user: User) -> datetime:
    started = datetime.fromisoformat(rec.started_at)
    return started.astimezone(ZoneInfo(user.timezone))


def _fallback_note(db: Session, storage: StorageService, user: User, rec: Recording) -> Note:
    folder = db.get(SessionFolder, rec.session_folder_id)
    assert folder is not None
    base = f"Transcript – {rec.name}"
    taken = set(db.scalars(select(Note.name_key).where(Note.session_folder_id == folder.id)))
    name, n = base, 2
    while name_key(name) in taken:
        name, n = f"{base} ({n})", n + 1
    created = note_service.create_note(db, storage, user, folder.session_key, name[:120])
    note = db.get(Note, created["id"])
    assert note is not None
    return note


def append_result(maker: Maker, storage: StorageService, job_id: str) -> None:
    """Append the transcript exactly once (B7/B8). Safe to call again after a crash."""
    with maker() as db:
        job = db.get(TranscriptionJob, job_id)
        if job is None or job.status in FINISHED:
            return
        user = db.get(User, job.user_id)
        rec = db.get(Recording, job.recording_id)
        assert user is not None and rec is not None
        recovering = job.status == "appending" and bool(job.appended_text)
        if not recovering:
            if job.cancel_requested:
                _finish(job, "cancelled")
                job.seen = True
                db.commit()
                return
            texts: list[str] = json.loads(job.part_texts_json or "[]")
            head = transcript.heading(rec.name, _local_start(rec, user), rec.duration_ms)
            job.appended_text = transcript.section(head, texts)
            job.status = "appending"
            job.stage_started_at = now_iso()
            job.progress = 1.0
            db.commit()
        section = job.appended_text or ""
        note = db.get(Note, job.note_id) if job.note_id else None
        if note is None:  # target deleted meanwhile: the transcript still lands somewhere (FR-011)
            note = _fallback_note(db, storage, user, rec)
            job.note_id, job.note_name = note.id, note.name
            job.fallback_note_created = True
        if recovering:
            _n, _f, parts = note_service._note_with_path(db, user, note.id)
            current = storage.read_bytes(parts) or b""
            if current.endswith(section.encode("utf-8")):
                job.result_hash = storage.hash_bytes(current)
                job.result_version = note.version
                job.previous_hash = None  # unknown: clients just reload the note
                _finish(job, "completed")
                db.commit()
                return
        from unihelper.services.transcription_settings_service import mark_connected

        mark_connected(db, job.user_id, job.provider_id, json.loads(job.provider_values_json))
        result = note_service.append_to_note(db, storage, user, note.id, section)
        job.appended_text = result["text"]
        job.previous_hash = result["previous_hash"]
        job.result_hash = result["hash"]
        job.result_version = result["version"]
        _finish(job, "completed")
        db.commit()
    log.info("transcription completed job=%s", job_id)
