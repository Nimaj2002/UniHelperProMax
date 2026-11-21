"""Trash entries for audio replaced by a Media Editor overwrite (025 FR-008a/b).

The old file moves to `<session>/audios/.trash/<entry id>-<file name>`; the entry keeps what is
needed to bring it back as a new recording of that session. Restoring never replaces the trimmed
audio that took its place."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from unihelper.api.errors import ApiError
from unihelper.db.engine import on_rollback
from unihelper.domain.naming import name_key, safe_name, unique_sibling
from unihelper.models import Recording, SessionFolder, TrashEntry, User
from unihelper.models.base import new_id, now_iso
from unihelper.services import recording_service as rs
from unihelper.services import session_folder_service as sfs
from unihelper.storage.storage_service import StoragePathError, StorageService

TRASH_DIR = ".trash"


def trash_file_parts(folder_parts: list[str], entry_id: str, file_name: str) -> list[str]:
    return [*folder_parts, "audios", TRASH_DIR, f"{entry_id}-{file_name}"]


def new_entry(
    db: Session, user: User, r: Recording, folder: SessionFolder, folder_parts: list[str]
) -> tuple[TrashEntry, list[str]]:
    """The Trash entry (not yet added) for the recording's current audio, and its file's path."""
    resolved = sfs.resolve(db, user, folder.session_key)
    entry_id = new_id()
    keep = trash_file_parts(folder_parts, entry_id, r.file_name)
    payload = {
        "version": 1,
        "session_folder_id": folder.id,
        "trash_file": keep[-1],
        "recording": {
            "name": r.name,
            "file_name": r.file_name,
            "mime_type": r.mime_type,
            "started_at": r.started_at,
            "duration_ms": r.duration_ms,
            "size": r.size,
            "origin": r.origin,
            "original_file_name": r.original_file_name,
        },
    }
    entry = TrashEntry(
        id=entry_id,
        user_id=user.id,
        kind="recording",
        lineage_id=r.id,  # not the session's lineage: a calendar re-import must not see this entry
        label=r.name,
        year_name=resolved.year.name,
        semester_name=resolved.semester.name,
        course_name=resolved.course.name if resolved.course else None,
        first_date=resolved.day,
        last_date=resolved.day,
        occurrence_count=1,
        note_count=0,
        recording_count=1,
        document_count=0,
        reason="overwrite",
        payload_json=json.dumps(payload),
        deleted_at=now_iso(),
    )
    return entry, keep


def _payload(entry: TrashEntry) -> dict[str, Any]:
    return json.loads(entry.payload_json)  # type: ignore[no-any-return]


def _folder_parts(
    db: Session, user: User, payload: dict[str, Any]
) -> tuple[SessionFolder | None, list[str] | None]:
    from unihelper.services import trash_service

    folder = db.get(SessionFolder, payload["session_folder_id"])
    if folder is None:
        return None, None
    return folder, trash_service.folder_parts(db, user, folder)


def entry_out(
    db: Session, storage: StorageService, user: User, entry: TrashEntry
) -> dict[str, Any]:
    p = _payload(entry)
    _folder, parts = _folder_parts(db, user, p)
    missing = 0
    try:
        if parts is None or not storage.exists([*parts, "audios", TRASH_DIR, p["trash_file"]]):
            missing = 1
    except StoragePathError:
        missing = 1
    return {
        "id": entry.id,
        "kind": "recording",
        "label": entry.label,
        "year_name": entry.year_name,
        "semester_name": entry.semester_name,
        "course_name": entry.course_name,
        "first_date": entry.first_date,
        "last_date": entry.last_date,
        "start_time": None,
        "end_time": None,
        "occurrence_count": 1,
        "note_count": 0,
        "recording_count": 1,
        "document_count": 0,
        "chat_count": 0,
        "deleted_at": entry.deleted_at,
        "purge_error": entry.purge_error,
        "missing_files": missing,
        "version": entry.version,
        "task_count": 0,
    }


def restore(db: Session, storage: StorageService, user: User, entry: TrashEntry) -> dict[str, Any]:
    p = _payload(entry)
    folder, parts = _folder_parts(db, user, p)
    if folder is None or parts is None or folder.trash_entry_id is not None:
        raise ApiError(
            409,
            "session_unavailable",
            "This audio's session is in the Trash or gone. Restore the session first.",
        )
    old = [*parts, "audios", TRASH_DIR, p["trash_file"]]
    if not storage.exists(old):
        raise ApiError(409, "file_missing", "The audio file is no longer on disk.")
    rec = p["recording"]
    with rs.session_import_lock(user.id, folder.session_key):
        names = list(
            db.scalars(select(Recording.name).where(Recording.session_folder_id == folder.id))
        )
        files = list(
            db.scalars(select(Recording.file_name).where(Recording.session_folder_id == folder.id))
        )
        name = rs._unique_name(rec["name"], names)
        ext = rec["file_name"][rec["file_name"].rfind(".") :]
        file_name = unique_sibling(safe_name(name) + ext, files)
        while storage.exists([*parts, "audios", file_name]):
            files.append(file_name)
            file_name = unique_sibling(safe_name(name) + ext, files)
        on_rollback(db, storage.rename_file(old, [*parts, "audios", file_name]))
        db.add(
            Recording(
                user_id=user.id,
                session_folder_id=folder.id,
                name=name,
                name_key=name_key(name),
                file_name=file_name,
                file_key=file_name.casefold(),
                mime_type=rec["mime_type"],
                status="complete",
                started_at=rec["started_at"]
                or datetime.now(UTC).isoformat(timespec="milliseconds"),
                duration_ms=rec["duration_ms"],
                size=rec["size"],
                next_seq=0,
                origin=rec["origin"],
                original_file_name=rec["original_file_name"],
            )
        )
        db.delete(entry)
        db.flush()
        db.commit()
    return {
        "kind": "recording",
        "lineage_id": folder.lineage_id,
        "first_session_key": folder.session_key,
        "recreated": {"year": False, "semester": False, "course": False},
        "moved_folders": 0,
    }


def purge(db: Session, storage: StorageService, user: User, entry: TrashEntry) -> None:
    p = _payload(entry)
    _folder, parts = _folder_parts(db, user, p)
    if parts is not None:
        try:
            storage.delete_trashed_audio([*parts, "audios", TRASH_DIR, p["trash_file"]])
        except (StoragePathError, OSError) as err:
            entry.purge_error = "The audio file could not be removed."
            db.flush()
            db.commit()
            raise ApiError(
                500,
                "purge_failed",
                "The file could not be removed. Close any program using it and try again.",
            ) from err
    db.delete(entry)
    db.flush()
