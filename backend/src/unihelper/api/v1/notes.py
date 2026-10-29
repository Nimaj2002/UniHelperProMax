from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Query, Response, status

from unihelper.api.deps import CurrentUser, DbSession, IfMatch, Storage
from unihelper.schemas.chat import NoteSearchHit
from unihelper.schemas.notes import (
    ContentSave,
    Note,
    NoteCreate,
    NoteImportReplace,
    NoteMeta,
    NoteRename,
    SaveResult,
)
from unihelper.services import note_search_service, note_service

router = APIRouter(tags=["notes"])


@router.get("/sessions/{session_key}/notes", response_model=list[NoteMeta])
def list_notes(session_key: str, user: CurrentUser, db: DbSession) -> Any:
    return note_service.list_notes(db, user, session_key)


@router.post(
    "/sessions/{session_key}/notes", response_model=Note, status_code=status.HTTP_201_CREATED
)
def create_note(
    session_key: str, body: NoteCreate, user: CurrentUser, db: DbSession, storage: Storage
) -> Any:
    return note_service.create_note(db, storage, user, session_key, body.name, body.content)


@router.get("/general-notes", response_model=list[NoteMeta])
def list_general_notes(user: CurrentUser, db: DbSession, storage: Storage) -> Any:
    return note_service.list_general_notes(db, storage, user)


@router.post("/general-notes", response_model=Note, status_code=status.HTTP_201_CREATED)
def create_general_note(
    body: NoteCreate, user: CurrentUser, db: DbSession, storage: Storage
) -> Any:
    return note_service.create_general_note(db, storage, user, body.name, body.content)


@router.get("/notes/search", response_model=list[NoteSearchHit])
def search_notes(
    user: CurrentUser,
    db: DbSession,
    q: Annotated[str | None, Query(max_length=200)] = None,
    course_id: Annotated[str | None, Query(alias="courseId")] = None,
    session_key: Annotated[str | None, Query(alias="sessionKey")] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> Any:
    """014: notes across sessions and courses for the chat's attach picker."""
    return note_search_service.search(db, user, q, course_id, session_key, limit)


@router.get("/notes/{note_id}", response_model=Note)
def get_note(note_id: str, user: CurrentUser, db: DbSession, storage: Storage) -> Any:
    return note_service.get_note(db, storage, user, note_id)


@router.put("/notes/{note_id}/content", response_model=SaveResult)
def save_content(
    note_id: str,
    body: ContentSave,
    version: IfMatch,
    user: CurrentUser,
    db: DbSession,
    storage: Storage,
) -> Any:
    return note_service.save_content(
        db, storage, user, note_id, version, body.base_hash, body.content
    )


@router.put("/notes/{note_id}/import-replace", response_model=Note)
def import_replace(
    note_id: str,
    body: NoteImportReplace,
    version: IfMatch,
    user: CurrentUser,
    db: DbSession,
    storage: Storage,
) -> Any:
    """Replace a note's content with an imported file's text (006 FR-020, user-confirmed)."""
    return note_service.import_replace(db, storage, user, note_id, version, body.content)


@router.patch("/notes/{note_id}", response_model=NoteMeta)
def rename_note(
    note_id: str,
    body: NoteRename,
    version: IfMatch,
    user: CurrentUser,
    db: DbSession,
    storage: Storage,
) -> Any:
    return note_service.rename_note(db, storage, user, note_id, version, body.name)


@router.delete("/notes/{note_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_note(
    note_id: str, version: IfMatch, user: CurrentUser, db: DbSession, storage: Storage
) -> Response:
    note_service.delete_note(db, storage, user, note_id, version)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
