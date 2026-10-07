"""Notes: Markdown files in a session's notes/ folder, indexed in SQLite (FR-014–FR-021).

The file is the content (Principle II). Saves are atomic and guarded twice: the client's
`If-Match` version (another window) and the file's hash on disk (edits outside the app), so text
is never silently overwritten (FR-020).
"""

from __future__ import annotations

import logging
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from unihelper.api.errors import ApiError, not_found, validation_error
from unihelper.db.engine import on_rollback
from unihelper.domain.naming import name_key, normalize_display, safe_name, unique_sibling
from unihelper.models import Note, SessionFolder, User
from unihelper.models.base import now_iso
from unihelper.services import session_folder_service as sfs
from unihelper.storage.storage_service import StorageService

log = logging.getLogger("unihelper.notes")
MISSING = ""  # hash reported for a note whose file was deleted outside the app

_note_locks: dict[str, threading.Lock] = {}
_note_locks_guard = threading.Lock()


@contextmanager
def note_file_lock(note_id: str) -> Iterator[None]:
    """Serialize writers of one note's file (004-D1): a save and a transcript append each hold
    it from reading the file until their note row is committed, so neither can write over what
    the other just wrote. Take it before flushing anything (SQLite's write lock comes second).

    The lock lives in this process only: the backend must run as a single process (plan.md)."""
    with _note_locks_guard:
        lock = _note_locks.setdefault(note_id, threading.Lock())
    with lock:
        yield


def _clean_name(name: str) -> str:
    cleaned = normalize_display(name)
    if not cleaned:
        raise validation_error("/name", "name_required", "Enter a name for the note.")
    if len(cleaned) > 120:
        raise validation_error("/name", "name_too_long", "Use at most 120 characters.")
    return cleaned


def _name_taken() -> ApiError:
    msg = "A note with this name already exists in this session."
    return ApiError(
        409, "name_taken", msg, errors=[{"field": "/name", "code": "name_taken", "message": msg}]
    )


def _file_name(name: str, siblings: list[str]) -> str:
    return unique_sibling(f"{safe_name(name)}.md", siblings)


def meta(note: Note, folder: SessionFolder) -> dict[str, Any]:
    return {
        "id": note.id,
        "session_key": folder.session_key,
        "name": note.name,
        "file_name": note.file_name,
        "version": note.version,
        "size": note.size,
        "created_at": note.created_at,
        "updated_at": note.updated_at,
    }


# ---- lookups -------------------------------------------------------------------------------


def _note_with_path(db: Session, user: User, note_id: str) -> tuple[Note, SessionFolder, list[str]]:
    note = db.get(Note, note_id)
    if note is None or note.user_id != user.id:
        raise not_found("Note")
    folder = db.get(SessionFolder, note.session_folder_id)
    assert folder is not None
    r = sfs.resolve(db, user, folder.session_key)
    parts = [*sfs.folder_parts(user, r, folder), "notes", note.file_name]
    return note, folder, parts


def list_notes(db: Session, user: User, key: str) -> list[dict[str, Any]]:
    r = sfs.resolve(db, user, key)
    if r.folder is None:
        return []
    notes = db.scalars(
        select(Note).where(Note.session_folder_id == r.folder.id).order_by(Note.created_at, Note.id)
    )
    return [meta(n, r.folder) for n in notes]


# ---- create / read / save --------------------------------------------------------------


def _check_text(content: str) -> None:
    """Notes are text: a NUL character means a binary file was imported (006 research I10)."""
    if "\x00" in content:
        raise validation_error(
            "/content",
            "content_not_text",
            "This text contains characters that aren't allowed in a note.",
        )


def create_note(
    db: Session, storage: StorageService, user: User, key: str, name: str, content: str = ""
) -> dict[str, Any]:
    name = _clean_name(name)
    _check_text(content)
    r = sfs.resolve(db, user, key)
    folder = sfs.get_or_create_folder(db, storage, user, r)
    if (
        db.scalar(
            select(Note).where(Note.session_folder_id == folder.id, Note.name_key == name_key(name))
        )
        is not None
    ):
        raise _name_taken()
    siblings = list(db.scalars(select(Note.file_name).where(Note.session_folder_id == folder.id)))
    file_name = _file_name(name, siblings)
    parts = [*sfs.folder_parts(user, r, folder), "notes", file_name]
    # never clobber a file that already exists on disk under that name
    while storage.read_bytes(parts) is not None:
        siblings.append(file_name)
        file_name = _file_name(name, siblings)
        parts[-1] = file_name
    digest, size = storage.write_text_atomic(parts, content)
    # a failed commit (e.g. a racing create with the same name) must not leave the file behind
    on_rollback(db, lambda: storage.delete_content_file(parts))
    note = Note(
        user_id=user.id,
        session_folder_id=folder.id,
        name=name,
        name_key=name_key(name),
        file_name=file_name,
        file_key=file_name.casefold(),
        content_hash=digest,
        size=size,
    )
    db.add(note)
    db.flush()
    return {**meta(note, folder), "content": content, "hash": digest, "missing": False}


def _decode(data: bytes) -> str:
    return data.decode("utf-8", errors="replace")


def get_note(db: Session, storage: StorageService, user: User, note_id: str) -> dict[str, Any]:
    note, folder, parts = _note_with_path(db, user, note_id)
    data = storage.read_bytes(parts)
    if data is None:
        # empty hash = "file is missing"; saving with it means "recreate the file" (Use mine)
        return {**meta(note, folder), "content": "", "hash": MISSING, "missing": True}
    digest = storage.hash_bytes(data)
    if digest != note.content_hash:  # edited outside the app: the file is the truth (N5)
        note.content_hash = digest
        note.size = len(data)
        note.updated_at = now_iso()
        db.flush()  # bumps version
    return {**meta(note, folder), "content": _decode(data), "hash": digest, "missing": False}


def _conflict(status: int, code: str, title: str, note: Note, content: str | None) -> ApiError:
    return ApiError(
        status,
        code,
        title,
        extra={"current": {"version": note.version, "hash": note.content_hash, "content": content}},
    )


def save_content(
    db: Session,
    storage: StorageService,
    user: User,
    note_id: str,
    version: int,
    base_hash: str,
    content: str,
) -> dict[str, Any]:
    with note_file_lock(note_id):
        note, _folder, parts = _note_with_path(db, user, note_id)
        data = storage.read_bytes(parts)
        disk_hash = None if data is None else storage.hash_bytes(data)
        if version != note.version:
            raise _conflict(
                412,
                "version_conflict",
                "This note was saved from another window.",
                note,
                None if data is None else _decode(data),
            )
        if data is None and base_hash != MISSING:
            raise ApiError(
                409,
                "file_missing",
                "The note's file was deleted outside the app.",
                extra={"current": {"version": note.version, "hash": MISSING, "content": None}},
            )
        if data is not None and disk_hash != note.content_hash:
            # adopt the external version so the client can choose (it must re-send with it)
            note.content_hash = disk_hash  # type: ignore[assignment]
            note.size = len(data)
            db.flush()
            db.commit()
            raise _conflict(
                409,
                "file_changed_on_disk",
                "This note was changed outside the app.",
                note,
                _decode(data),
            )
        if data is not None and base_hash != note.content_hash:
            raise _conflict(
                409,
                "file_changed_on_disk",
                "This note was changed outside the app.",
                note,
                _decode(data),
            )
        digest, size = storage.write_text_atomic(parts, content)
        note.content_hash = digest
        note.size = size
        note.updated_at = now_iso()
        db.flush()
        db.commit()  # visible before the lock is released (004-D1)
        return {
            "version": note.version,
            "hash": digest,
            "size": size,
            "updated_at": note.updated_at,
        }


# ---- append (004 transcription) ----------------------------------------------------------


def append_to_note(
    db: Session, storage: StorageService, user: User, note_id: str, section_text: str
) -> dict[str, Any]:
    """Append a transcript section after the file's current last character (Principle I).

    Only bytes after the old end are written (append mode + fsync); the separator is chosen
    from the current file so the existing last character is never touched. A file deleted
    outside the app is recreated with just the section. Returns what was written plus the hash
    before/after and the new note version (the open editor merges with these, 004 B10).

    Commits the note row (and anything else pending in `db`) under the note's file lock; a
    crash before the caller commits the job is handled by the tail check in `append_result`."""
    from unihelper.domain.transcript import separator_for

    with note_file_lock(note_id):
        note, _folder, parts = _note_with_path(db, user, note_id)
        db.refresh(note)  # the caller may have loaded it before a save committed
        data = storage.read_bytes(parts)
        existing = data or b""
        previous_hash = MISSING if data is None else storage.hash_bytes(data)
        text = separator_for(existing) + section_text
        size = storage.append_bytes(parts, text.encode("utf-8"))
        new_hash = storage.file_hash(parts) or MISSING
        note.content_hash = new_hash
        note.size = size
        note.updated_at = now_iso()
        db.flush()  # bumps version, like a save
        db.commit()  # visible before the lock is released (004-D1)
        return {
            "text": text,
            "previous_hash": previous_hash,
            "hash": new_hash,
            "version": note.version,
        }


# ---- replace by import (006 US5) ---------------------------------------------------------


def import_replace(
    db: Session, storage: StorageService, user: User, note_id: str, version: int, content: str
) -> dict[str, Any]:
    """Replace a note's whole content with an imported file's text, after the user confirmed
    it (006 FR-020, research I11). Refused — leaving the note untouched — when the note changed
    since the user saw it, a transcript is about to be appended to it, or its file was edited
    outside the app. Holds the note's file lock like saves and appends (004-D1)."""
    from unihelper.models import TranscriptionJob
    from unihelper.models.transcription import ACTIVE_STATUSES

    _check_text(content)
    with note_file_lock(note_id):
        note, folder, parts = _note_with_path(db, user, note_id)
        db.refresh(note)
        data = storage.read_bytes(parts)
        if version != note.version:
            raise _conflict(
                412,
                "version_conflict",
                "This note changed since you chose Replace. Nothing was replaced.",
                note,
                None if data is None else _decode(data),
            )
        busy = db.scalar(
            select(TranscriptionJob.id).where(
                TranscriptionJob.note_id == note.id,
                TranscriptionJob.status.in_(ACTIVE_STATUSES),
            )
        )
        if busy is not None:
            raise ApiError(409, "note_transcribing", "A transcription is being added to this note.")
        if data is not None and storage.hash_bytes(data) != note.content_hash:
            raise _conflict(
                409,
                "file_changed_on_disk",
                "This note was changed outside the app. Nothing was replaced.",
                note,
                _decode(data),
            )
        digest, size = storage.write_text_atomic(parts, content)  # recreates a missing file
        note.content_hash = digest
        note.size = size
        note.updated_at = now_iso()
        db.flush()  # bumps version
        db.commit()  # visible before the lock is released (004-D1)
        log.info("note %s replaced by import", note.id)
        return {**meta(note, folder), "content": content, "hash": digest, "missing": False}


# ---- rename / delete (US4) ----------------------------------------------------------------


def rename_note(
    db: Session, storage: StorageService, user: User, note_id: str, version: int, name: str
) -> dict[str, Any]:
    from unihelper.api.deps import check_version

    note, folder, parts = _note_with_path(db, user, note_id)
    check_version(version, note.version)
    name = _clean_name(name)
    clash = db.scalar(
        select(Note).where(
            Note.session_folder_id == folder.id, Note.name_key == name_key(name), Note.id != note.id
        )
    )
    if clash is not None:
        raise _name_taken()
    siblings = [
        f
        for f in db.scalars(
            select(Note.file_name).where(Note.session_folder_id == folder.id, Note.id != note.id)
        )
    ]
    new_file = _file_name(name, siblings)
    if new_file != note.file_name:
        undo = storage.rename_file(parts, [*parts[:-1], new_file])
        on_rollback(db, undo)
        note.file_name = new_file
        note.file_key = new_file.casefold()
    note.name = name
    note.name_key = name_key(name)
    db.flush()
    return meta(note, folder)


def delete_note(
    db: Session, storage: StorageService, user: User, note_id: str, version: int
) -> None:
    from unihelper.api.deps import check_version

    note, _folder, parts = _note_with_path(db, user, note_id)
    check_version(version, note.version)
    db.delete(note)
    db.flush()
    storage.delete_content_file(parts)  # last: only after the metadata change succeeded
