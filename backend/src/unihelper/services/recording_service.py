"""Recordings: audio written progressively in 5 s chunks to the session's audios/ folder
(FR-001–FR-016, research A2–A7)."""

from __future__ import annotations

import logging
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from unihelper.api.errors import ApiError, not_found, validation_error
from unihelper.db.engine import on_rollback
from unihelper.domain import audio_probe, webm
from unihelper.domain.naming import name_key, normalize_display, safe_name, unique_sibling
from unihelper.models import Recording, SessionFolder, User
from unihelper.models.base import now_iso
from unihelper.services import session_folder_service as sfs
from unihelper.storage.storage_service import StorageService

log = logging.getLogger("unihelper.recordings")
STALE = timedelta(seconds=30)
MAX_CHUNK = 10 * 1024 * 1024
EXT = {"audio/webm": ".webm", "audio/mp4": ".m4a"}
MAX_NAME = 120


def _now() -> datetime:
    return datetime.now(UTC)


def _last_activity(r: Recording) -> datetime:
    return datetime.fromisoformat(r.last_chunk_at or r.started_at)


def _ext(r: Recording) -> str:
    """The row's own extension: recordings are .webm/.m4a, imports keep theirs (006)."""
    return Path(r.file_name).suffix.lower() or EXT.get(r.mime_type, "")


def is_active(r: Recording, now: datetime | None = None) -> bool:
    return r.status == "recording" and (now or _now()) - _last_activity(r) < STALE


def _parts(db: Session, user: User, r: Recording) -> tuple[list[str], SessionFolder]:
    folder = db.get(SessionFolder, r.session_folder_id)
    assert folder is not None
    resolved = sfs.resolve(db, user, folder.session_key)
    return [*sfs.folder_parts(user, resolved, folder), "audios", r.file_name], folder


def view(db: Session, storage: StorageService, user: User, r: Recording) -> dict[str, Any]:
    parts, folder = _parts(db, user, r)
    return {
        "id": r.id,
        "session_key": folder.session_key,
        "name": r.name,
        "file_name": r.file_name,
        "mime_type": r.mime_type,
        "status": r.status,
        "started_at": r.started_at,
        "duration_ms": r.duration_ms,
        "size": r.size,
        "next_seq": r.next_seq,
        "active": is_active(r),
        "missing": not storage.absolute_path(parts).exists(),
        "version": r.version,
        "origin": r.origin,
        "original_file_name": r.original_file_name,
    }


def _get(db: Session, user: User, recording_id: str) -> Recording:
    r = db.get(Recording, recording_id)
    if r is None or r.user_id != user.id:
        raise not_found("Recording")
    return r


def _in_progress() -> ApiError:
    return ApiError(409, "recording_in_progress", "A recording is in progress. Stop it first.")


# ---- finalize -----------------------------------------------------------------------------


def _finalize(
    db: Session,
    storage: StorageService,
    user: User,
    r: Recording,
    status: str,
    client_duration: int | None = None,
) -> None:
    parts, _ = _parts(db, user, r)
    data = storage.read_bytes(parts)
    duration = client_duration or 0
    if data and r.mime_type == "audio/webm":
        try:
            fixed, duration = webm.finalize(data)
            storage.replace_bytes_atomic(parts, fixed)
            r.size = len(fixed)
        except webm.WebmError as err:  # keep the original bytes: still the user's audio
            log.warning("could not finalize %s: %s", r.id, err)
            r.size = len(data)
    elif data is not None:
        r.size = len(data)
    r.duration_ms = duration
    r.status = status
    db.flush()


def _expire_stale(
    db: Session, storage: StorageService, user: User, recordings: list[Recording]
) -> None:
    now = _now()
    for r in recordings:
        if r.status == "recording" and now - _last_activity(r) >= STALE:
            _finalize(db, storage, user, r, "interrupted")


# ---- reads --------------------------------------------------------------------------------


def list_recordings(
    db: Session, storage: StorageService, user: User, key: str
) -> list[dict[str, Any]]:
    resolved = sfs.resolve(db, user, key)
    if resolved.folder is None:
        return []
    rows = list(
        db.scalars(
            select(Recording)
            .where(Recording.session_folder_id == resolved.folder.id)
            .order_by(Recording.started_at.desc(), Recording.id.desc())
        )
    )
    _expire_stale(db, storage, user, rows)
    return [view(db, storage, user, r) for r in rows]


def get_recording(
    db: Session, storage: StorageService, user: User, recording_id: str
) -> dict[str, Any]:
    r = _get(db, user, recording_id)
    _expire_stale(db, storage, user, [r])
    return view(db, storage, user, r)


def active_recording(db: Session, storage: StorageService, user: User) -> dict[str, Any] | None:
    rows = list(
        db.scalars(
            select(Recording).where(Recording.user_id == user.id, Recording.status == "recording")
        )
    )
    _expire_stale(db, storage, user, rows)
    live = [r for r in rows if is_active(r)]
    return view(db, storage, user, live[0]) if live else None


def audio_file(
    db: Session, storage: StorageService, user: User, recording_id: str
) -> tuple[Any, str, str]:
    r = _get(db, user, recording_id)
    parts, _ = _parts(db, user, r)
    path = storage.absolute_path(parts)
    if not path.exists():
        raise ApiError(404, "file_missing", "The audio file is missing from the session folder.")
    return path, r.mime_type, r.file_name


# ---- writes -------------------------------------------------------------------------------


def _unique_name(base: str, taken: list[str]) -> str:
    """`base`, or `base (2)`, `base (3)`… — the first one no other item uses (case-insensitive)."""
    keys = {name_key(t) for t in taken}
    name, n = base, 2
    while name_key(name) in keys:
        suffix = f" ({n})"
        name, n = base[: MAX_NAME - len(suffix)].rstrip() + suffix, n + 1
    return name


def _default_name(user: User, started: datetime, taken: list[str]) -> str:
    local = started.astimezone(ZoneInfo(user.timezone))
    return _unique_name(f"Recording {local.strftime('%H:%M')}", taken)


def start_recording(
    db: Session, storage: StorageService, user: User, key: str, mime_type: str
) -> dict[str, Any]:
    if active_recording(db, storage, user) is not None:
        raise _in_progress()
    resolved = sfs.resolve(db, user, key)
    folder = sfs.get_or_create_folder(db, storage, user, resolved)
    started = _now()
    names = list(db.scalars(select(Recording.name).where(Recording.session_folder_id == folder.id)))
    name = _default_name(user, started, names)
    files = list(
        db.scalars(select(Recording.file_name).where(Recording.session_folder_id == folder.id))
    )
    file_name = unique_sibling(safe_name(name) + EXT[mime_type], files)
    r = Recording(
        user_id=user.id,
        session_folder_id=folder.id,
        name=name,
        name_key=name_key(name),
        file_name=file_name,
        file_key=file_name.casefold(),
        mime_type=mime_type,
        status="recording",
        started_at=started.isoformat(timespec="milliseconds"),
    )
    db.add(r)
    db.flush()
    parts = [*sfs.folder_parts(user, resolved, folder), "audios", file_name]
    storage.ensure_dir(parts[:-1])
    storage.append_bytes(parts, b"")  # the file exists from the first second
    return view(db, storage, user, r)


def append_chunk(
    db: Session, storage: StorageService, user: User, recording_id: str, seq: int, data: bytes
) -> dict[str, int]:
    r = _get(db, user, recording_id)
    if len(data) > MAX_CHUNK:
        raise ApiError(413, "chunk_too_large", "Audio chunks must be at most 10 MB.")
    if r.status == "complete":
        raise ApiError(409, "recording_finished", "This recording has already been stopped.")
    if seq < r.next_seq:
        return {"next_seq": r.next_seq, "size": r.size}  # already stored (retry)
    if seq > r.next_seq:
        raise ApiError(
            409, "chunk_gap", "A previous chunk is missing.", extra={"nextSeq": r.next_seq}
        )
    parts, _ = _parts(db, user, r)
    r.size = storage.append_bytes(parts, data)
    r.next_seq += 1
    r.last_chunk_at = _now().isoformat(timespec="milliseconds")
    if r.status == "interrupted":  # a live recorder came back after a network gap
        r.status = "recording"
    db.flush()
    return {"next_seq": r.next_seq, "size": r.size}


def stop_recording(
    db: Session,
    storage: StorageService,
    user: User,
    recording_id: str,
    interrupted: bool,
    duration_ms: int | None,
) -> dict[str, Any]:
    r = _get(db, user, recording_id)
    status = "interrupted" if interrupted else "complete"
    if r.status == "complete" and not interrupted:
        return view(db, storage, user, r)
    _finalize(db, storage, user, r, status, duration_ms)
    return view(db, storage, user, r)


def rename_recording(
    db: Session, storage: StorageService, user: User, recording_id: str, version: int, name: str
) -> dict[str, Any]:
    from unihelper.api.deps import check_version

    r = _get(db, user, recording_id)
    check_version(version, r.version)
    if is_active(r):
        raise _in_progress()
    name = normalize_display(name)
    if not name:
        raise validation_error("/name", "name_required", "Enter a name.")
    clash = db.scalar(
        select(Recording).where(
            Recording.session_folder_id == r.session_folder_id,
            Recording.name_key == name_key(name),
            Recording.id != r.id,
        )
    )
    if clash is not None:
        msg = "A recording with this name already exists in this session."
        raise ApiError(
            409,
            "name_taken",
            msg,
            errors=[{"field": "/name", "code": "name_taken", "message": msg}],
        )
    parts, _ = _parts(db, user, r)
    files = list(
        db.scalars(
            select(Recording.file_name).where(
                Recording.session_folder_id == r.session_folder_id, Recording.id != r.id
            )
        )
    )
    new_file = unique_sibling(safe_name(name) + _ext(r), files)
    if new_file != r.file_name:
        on_rollback(db, storage.rename_file(parts, [*parts[:-1], new_file]))
        r.file_name = new_file
        r.file_key = new_file.casefold()
    r.name = name
    r.name_key = name_key(name)
    r.updated_at = now_iso()
    db.flush()
    return view(db, storage, user, r)


def delete_recording(
    db: Session, storage: StorageService, user: User, recording_id: str, version: int
) -> None:
    from unihelper.api.deps import check_version

    r = _get(db, user, recording_id)
    check_version(version, r.version)
    if is_active(r):
        raise _in_progress()
    from unihelper.services.transcription_service import has_active_job_for_recording

    if has_active_job_for_recording(db, r.id):
        raise ApiError(
            409,
            "recording_transcribing",
            "This recording is being transcribed. Cancel or wait for the transcription first.",
        )
    parts, _ = _parts(db, user, r)
    db.delete(r)
    db.flush()
    storage.delete_content_file(parts)


# ---- import (feature 006) -----------------------------------------------------------------

_session_locks: dict[str, threading.Lock] = {}
_session_locks_guard = threading.Lock()


@contextmanager
def session_import_lock(user_id: str, session_key: str) -> Iterator[None]:
    """Serialize imports into one session from creating its folder and choosing a name until
    the row is committed: two concurrent uploads must neither both create the session folder
    nor pick the same "Name (2)" (006 research I6). In-process only: the backend runs as a
    single process."""
    with _session_locks_guard:
        lock = _session_locks.setdefault(f"{user_id}:{session_key}", threading.Lock())
    with lock:
        yield


def _import_name(original_file_name: str) -> str:
    stem = original_file_name[: original_file_name.rfind(".")]  # callers checked the extension
    return normalize_display(stem)[:MAX_NAME].strip() or "Imported audio"


def import_audio(
    db: Session,
    storage: StorageService,
    user: User,
    key: str,
    staged: Path,
    original_file_name: str,
    client_duration_ms: int | None,
) -> dict[str, Any]:
    """Turn a fully received staging file into an imported Recording (FR-007–FR-010).

    The file is checked first; it is moved into the session's audios/ folder only under a
    name and file name no other item or on-disk file uses, and the move is undone if the
    transaction doesn't commit — so a failure leaves the session exactly as it was (FR-024)."""
    mime = audio_probe.mime_for(original_file_name)
    result = audio_probe.probe(staged, mime) if mime else None
    if mime is None or result is None:
        storage.discard_upload(staged)
        raise ApiError(
            422,
            "unreadable_audio",
            f"{original_file_name} couldn't be read as audio.",
        )
    ext = Path(original_file_name).suffix.lower()
    size = staged.stat().st_size
    with session_import_lock(user.id, key):
        resolved = sfs.resolve(db, user, key)
        folder = sfs.get_or_create_folder(db, storage, user, resolved)
        names = list(
            db.scalars(select(Recording.name).where(Recording.session_folder_id == folder.id))
        )
        name = _unique_name(_import_name(original_file_name), names)
        files = list(
            db.scalars(select(Recording.file_name).where(Recording.session_folder_id == folder.id))
        )
        file_name = unique_sibling(safe_name(name) + ext, files)
        folder_parts = sfs.folder_parts(user, resolved, folder)
        # never take the name of a file that is already on disk (copied in by hand)
        while storage.absolute_path([*folder_parts, "audios", file_name]).exists():
            files.append(file_name)
            file_name = unique_sibling(safe_name(name) + ext, files)
        parts = [*folder_parts, "audios", file_name]
        on_rollback(db, storage.commit_upload(staged, parts))
        r = Recording(
            user_id=user.id,
            session_folder_id=folder.id,
            name=name,
            name_key=name_key(name),
            file_name=file_name,
            file_key=file_name.casefold(),
            mime_type=mime,
            status="complete",
            started_at=_now().isoformat(timespec="milliseconds"),
            duration_ms=result.duration_ms or client_duration_ms or 0,
            size=size,
            next_seq=0,
            origin="imported",
            original_file_name=original_file_name[:255],
        )
        db.add(r)
        db.flush()
        db.commit()  # visible before the lock is released
    log.info("imported audio %s into session folder %s", r.id, folder.id)
    return view(db, storage, user, r)
