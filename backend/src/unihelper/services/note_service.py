"""Notes: Markdown files in a session's notes/ folder, indexed in SQLite (FR-014–FR-021).

The file is the content (Principle II). Saves are atomic and guarded twice: the client's
`If-Match` version (another window) and the file's hash on disk (edits outside the app), so text
is never silently overwritten (FR-020).
"""

from __future__ import annotations

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

MISSING = ""  # hash reported for a note whose file was deleted outside the app


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


def create_note(
    db: Session, storage: StorageService, user: User, key: str, name: str, content: str = ""
) -> dict[str, Any]:
    name = _clean_name(name)
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
    return {"version": note.version, "hash": digest, "size": size, "updated_at": note.updated_at}


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
    storage.delete_note_file(parts)  # last: only after the metadata change succeeded
