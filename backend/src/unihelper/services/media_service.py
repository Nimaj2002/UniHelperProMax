"""Media Editor (025): browse recordings by class and session, waveform peaks, and trim (save as a
new recording, or overwrite the source). The file work is in `domain/audio_edit.py`; every write
goes through staging so a failure never damages the original."""

from __future__ import annotations

import logging
from collections import OrderedDict
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from unihelper.api.deps import check_version
from unihelper.api.errors import ApiError, not_found, validation_error
from unihelper.db.engine import on_rollback
from unihelper.domain import audio_edit
from unihelper.domain.naming import name_key, normalize_display, safe_name, unique_sibling
from unihelper.models import Course, Recording, SessionFolder, User
from unihelper.models.base import now_iso
from unihelper.models.transcription import TranscriptionJob
from unihelper.services import recording_service as rs
from unihelper.services import transcription_service, trash_recording_service
from unihelper.storage.storage_service import StorageService

log = logging.getLogger(__name__)

_peaks_cache: OrderedDict[tuple[str, int, int], audio_edit.Peaks] = OrderedDict()
_PEAKS_CACHE_MAX = 16


def _has_transcript(db: Session, recording_id: str) -> bool:
    return (
        db.scalar(
            select(TranscriptionJob.id)
            .where(
                TranscriptionJob.recording_id == recording_id,
                TranscriptionJob.status == "completed",
            )
            .limit(1)
        )
        is not None
    )


def _media_view(db: Session, storage: StorageService, user: User, r: Recording) -> dict[str, Any]:
    v = rs.view(db, storage, user, r)
    return {
        "id": r.id,
        "name": r.name,
        "duration_ms": r.duration_ms,
        "version": r.version,
        "has_transcript": _has_transcript(db, r.id),
        "missing": v["missing"],
        "mime_type": r.mime_type,
    }


def browse(db: Session, storage: StorageService, user: User) -> list[dict[str, Any]]:
    """Every finished recording of the user, grouped class → session (events under "Events")."""
    rows = db.execute(
        select(Recording, SessionFolder)
        .join(SessionFolder, Recording.session_folder_id == SessionFolder.id)
        .where(
            Recording.user_id == user.id,
            Recording.status.in_(("complete", "interrupted")),
            SessionFolder.trash_entry_id.is_(None),
        )
        .order_by(SessionFolder.original_date.desc(), Recording.name)
    ).all()
    courses = {c.id: c for c in db.scalars(select(Course).where(Course.user_id == user.id))}
    groups: dict[str | None, dict[str, Any]] = {}
    for rec, folder in rows:
        if rs.is_active(rec):
            continue
        course = (
            courses.get(folder.course_id) if folder.kind == "class" and folder.course_id else None
        )
        gid = course.id if course else None
        if gid not in groups:
            context = ""
            if course is not None:
                from unihelper.services import hierarchy_service as hs

                semester, year = hs.course_parents(db, course)
                context = f"{year.name} · {semester.name}"
            groups[gid] = {
                "id": gid,
                "name": course.name if course else "Events",
                "context": context,
                "sessions": {},
            }
        sessions = groups[gid]["sessions"]
        if folder.id not in sessions:
            sessions[folder.id] = {
                "session_key": folder.session_key,
                "title": folder.title or folder.folder_name,
                "date": folder.original_date.isoformat(),
                "recordings": [],
            }
        sessions[folder.id]["recordings"].append(_media_view(db, storage, user, rec))
    out = []
    for g in sorted(
        groups.values(), key=lambda g: (g["id"] is None, g["name"].casefold(), g["context"])
    ):
        g["sessions"] = list(g["sessions"].values())
        out.append(g)
    return out


def _source(
    db: Session, storage: StorageService, user: User, recording_id: str
) -> tuple[Recording, list[str], Path]:
    r = rs._get(db, user, recording_id)
    parts, _ = rs._parts(db, user, r)
    path = storage.absolute_path(parts)
    if not path.is_file():
        raise ApiError(404, "audio_missing", "The audio file is missing.")
    return r, parts, path


def peaks(
    db: Session, storage: StorageService, user: User, recording_id: str, buckets: int
) -> audio_edit.Peaks:
    r, _parts, path = _source(db, storage, user, recording_id)
    key = (r.id, r.version, buckets)
    hit = _peaks_cache.get(key)
    if hit is not None:
        _peaks_cache.move_to_end(key)
        return hit
    try:
        result = audio_edit.compute_peaks(path, buckets)
    except audio_edit.AudioEditError as err:
        raise ApiError(422, "unreadable_audio", "This audio couldn't be read.") from err
    _peaks_cache[key] = result
    while len(_peaks_cache) > _PEAKS_CACHE_MAX:
        _peaks_cache.popitem(last=False)
    return result


def _ensure_editable(db: Session, r: Recording) -> None:
    if r.status == "recording" or rs.is_active(r):
        raise rs._in_progress()
    if transcription_service.has_active_job_for_recording(db, r.id):
        raise ApiError(
            409,
            "recording_transcribing",
            "This recording is being transcribed. Cancel or wait for the transcription first.",
        )


Ranges = list[tuple[int, int]]


def _checked(src: Path, ranges: Ranges) -> Ranges:
    try:
        return audio_edit.validate_ranges(ranges, audio_edit.duration_ms(src))
    except audio_edit.InvalidRange as err:
        raise validation_error("/ranges", "invalid_range", str(err)) from err
    except audio_edit.AudioEditError as err:
        raise ApiError(422, "unreadable_audio", "This audio couldn't be read.") from err


def _stage_trim(storage: StorageService, src: Path, ranges: Ranges, ext: str) -> tuple[Path, int]:
    """Write the kept windows, joined, to a staging file; it is removed on any failure."""
    staged, fh = storage.open_upload()
    fh.close()
    try:
        new_duration = audio_edit.trim_copy_ranges(src, staged, ranges, ext)
    except audio_edit.AudioEditError as err:
        storage.discard_upload(staged)
        raise ApiError(422, "unreadable_audio", "This audio couldn't be trimmed.") from err
    except BaseException:
        storage.discard_upload(staged)
        raise
    return staged, new_duration


def _name_taken() -> ApiError:
    msg = "A recording with this name already exists in this session."
    return ApiError(
        409, "name_taken", msg, errors=[{"field": "/name", "code": "name_taken", "message": msg}]
    )


def trim_new(
    db: Session,
    storage: StorageService,
    user: User,
    recording_id: str,
    ranges: Ranges,
    name: str | None,
    combine: str = "merge",
) -> list[dict[str, Any]]:
    """Save the windows as new recordings: one merged recording, or one per window named
    "<name> 1", "<name> 2", … (FR-006c). All or nothing."""
    r, parts, src = _source(db, storage, user, recording_id)
    _ensure_editable(db, r)
    display = normalize_display(name or "")
    if not display:
        raise validation_error("/name", "name_required", "Enter a name.")
    ordered = _checked(src, ranges)
    ext = rs._ext(r)
    outputs: list[tuple[str, Ranges]]
    if combine == "separate" and len(ordered) > 1:
        outputs = [(f"{display[: 120 - 4]} {i}", [w]) for i, w in enumerate(ordered, 1)]
    else:
        outputs = [(display, ordered)]
    staged: list[tuple[Path, int]] = []
    try:
        for _name, windows in outputs:
            staged.append(_stage_trim(storage, src, windows, ext))
        created: list[Recording] = []
        with rs.session_import_lock(user.id, _folder(db, r).session_key):
            folder = _folder(db, r)
            taken = set(
                db.scalars(
                    select(Recording.name_key).where(Recording.session_folder_id == folder.id)
                )
            )
            files = list(
                db.scalars(
                    select(Recording.file_name).where(Recording.session_folder_id == folder.id)
                )
            )
            folder_parts = parts[:-1]
            for (out_name, _w), (path, duration) in zip(outputs, staged, strict=True):
                if name_key(out_name) in taken:
                    raise _name_taken()
                taken.add(name_key(out_name))
                file_name = unique_sibling(safe_name(out_name) + ext, files)
                while storage.absolute_path([*folder_parts, file_name]).exists():
                    files.append(file_name)
                    file_name = unique_sibling(safe_name(out_name) + ext, files)
                files.append(file_name)
                on_rollback(db, storage.commit_upload(path, [*folder_parts, file_name]))
                new = Recording(
                    user_id=user.id,
                    session_folder_id=folder.id,
                    name=out_name,
                    name_key=name_key(out_name),
                    file_name=file_name,
                    file_key=file_name.casefold(),
                    mime_type=r.mime_type,
                    status="complete",
                    started_at=rs._now().isoformat(timespec="milliseconds"),
                    duration_ms=duration,
                    size=storage.absolute_path([*folder_parts, file_name]).stat().st_size,
                    next_seq=0,
                    origin="imported",
                    original_file_name=r.file_name[:255],
                )
                db.add(new)
                created.append(new)
            db.flush()
            db.commit()
    except BaseException:
        for path, _d in staged:
            storage.discard_upload(path)  # no-op once moved into the session
        raise
    log.info("trimmed recording %s into %d new recording(s)", r.id, len(created))
    return [_media_view(db, storage, user, c) for c in created]


def trim_overwrite(
    db: Session,
    storage: StorageService,
    user: User,
    recording_id: str,
    ranges: Ranges,
    version: int,
) -> tuple[dict[str, Any], bool]:
    """Keep the range in place of the audio; the old audio goes to the Trash first (FR-008a)."""
    r, parts, src = _source(db, storage, user, recording_id)
    check_version(version, r.version)
    _ensure_editable(db, r)
    stale = _has_transcript(db, r.id)
    staged, duration = _stage_trim(storage, src, _checked(src, ranges), rs._ext(r))
    try:
        with rs.session_import_lock(user.id, _folder(db, r).session_key):
            folder = _folder(db, r)
            entry, keep = trash_recording_service.new_entry(db, user, r, folder, parts[:-2])
            finalize, undo = storage.swap_in_upload(staged, parts, keep_parts=keep)
            try:
                db.add(entry)
                r.duration_ms = duration
                r.size = src.stat().st_size
                r.updated_at = now_iso()
                db.flush()
                db.commit()
            except BaseException:
                db.rollback()
                undo()
                raise
            finalize()
    except BaseException:
        storage.discard_upload(staged)
        raise
    _peaks_cache.clear()
    log.info("overwrote recording %s with its trimmed range; old audio is in the Trash", r.id)
    return _media_view(db, storage, user, r), stale


def _folder(db: Session, r: Recording) -> SessionFolder:
    folder = db.get(SessionFolder, r.session_folder_id)
    if folder is None:
        raise not_found("Session")
    return folder
