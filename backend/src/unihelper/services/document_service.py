"""Session documents: PDFs in a session's documents/ folder (007 FR-001–FR-010, research R10).

A PDF is stored exactly as uploaded and never written again (Constitution II); its annotations
live in `<name>.annotations.json` next to it (annotation_service). Imports reuse 006's staging and
per-session lock, so concurrent uploads never clash on the session folder or on a name.

A document is stored in the session it was uploaded to but belongs to the whole course: every
session of the course, of any of its classes, lists it, and names are unique across the course.
009 (research R5): an event's documents are shared by the occurrences of that event series (its
lineage) the same way. Folders in the Trash are outside every scope.
"""

from __future__ import annotations

import json
import logging
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from sqlalchemy import Select, select
from sqlalchemy.orm import Session

from unihelper.api.errors import ApiError, not_found
from unihelper.api.uploads import StagedUpload
from unihelper.db.engine import on_rollback
from unihelper.domain.naming import name_key, normalize_display, safe_name, unique_sibling
from unihelper.domain.pdf_probe import probe_pdf
from unihelper.models import Document, DocumentPosition, SessionFolder, User
from unihelper.services import session_folder_service as sfs
from unihelper.services.recording_service import session_import_lock
from unihelper.storage.storage_service import StorageService

log = logging.getLogger("unihelper.documents")
MAX_NAME = 120
FALLBACK_NAME = "Document"


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds")


_locks: dict[str, threading.Lock] = {}
_locks_guard = threading.Lock()


@contextmanager
def document_file_lock(document_id: str) -> Iterator[None]:
    """Serialize writers of one document's files — annotation saves, rename, delete — from
    reading them until the request's rows are committed, so a save never writes a sidecar under a
    name a rename just moved. In-process only: the backend runs as a single process (plan.md),
    as for `note_file_lock`."""
    with _locks_guard:
        lock = _locks.setdefault(document_id, threading.Lock())
    with lock:
        yield


# ---- lookups -------------------------------------------------------------------------------


def get_owned(db: Session, user: User, document_id: str) -> Document:
    d = db.get(Document, document_id)
    if d is None or d.user_id != user.id:
        raise not_found("Document")
    return d


@dataclass(frozen=True)
class DocumentScope:
    """Session folders whose documents are listed together and share one name space: a
    course's (classes), or one event series' (009 events)."""

    lock_key: str
    folder_ids: Select[str]

    def documents(self, user: User) -> Select[Document]:
        return select(Document).where(
            Document.user_id == user.id, Document.session_folder_id.in_(self.folder_ids)
        )


def _scope(user: User, kind: str, course_id: str | None, lineage_id: str) -> DocumentScope:
    stmt = select(SessionFolder.id).where(
        SessionFolder.user_id == user.id, SessionFolder.trash_entry_id.is_(None)
    )
    if kind == "event":
        stmt = stmt.where(SessionFolder.kind == "event", SessionFolder.lineage_id == lineage_id)
        return DocumentScope(f"event:{lineage_id}", stmt)
    return DocumentScope(f"course:{course_id}", stmt.where(SessionFolder.course_id == course_id))


def scope_of(user: User, r: sfs.ResolvedSession) -> DocumentScope:
    return _scope(user, r.kind, r.course.id if r.course else None, r.lineage_id)


def scope_of_folder(user: User, folder: SessionFolder) -> DocumentScope:
    return _scope(user, folder.kind, folder.course_id, folder.lineage_id)


@contextmanager
def scope_import_lock(user_id: str, scope: DocumentScope) -> Iterator[None]:
    """Serialize choosing a document name across the scope's sessions until the row is
    committed: two sessions of one course uploading at once must not pick the same name."""
    with session_import_lock(user_id, scope.lock_key):
        yield


def pdf_parts(db: Session, user: User, d: Document) -> tuple[list[str], SessionFolder]:
    folder = db.get(SessionFolder, d.session_folder_id)
    assert folder is not None
    resolved = sfs.resolve(db, user, folder.session_key)
    return [*sfs.folder_parts(user, resolved, folder), "documents", d.file_name], folder


def annotation_count(storage: StorageService, parts: list[str]) -> int:
    """Number of annotations in the sidecar (0 when there is none or it can't be read)."""
    data = storage.read_bytes(storage.sidecar_parts(parts))
    if data is None:
        return 0
    try:
        model = json.loads(data)
        items = model.get("annotations", [])
        viewer = model.get("viewer") or {}
        viewer_items = viewer.get("items", []) if isinstance(viewer, dict) else []
    except (ValueError, AttributeError):
        return 0
    count = len(items) if isinstance(items, list) else 0
    return count + (len(viewer_items) if isinstance(viewer_items, list) else 0)


def view(db: Session, storage: StorageService, user: User, d: Document) -> dict[str, Any]:
    parts, folder = pdf_parts(db, user, d)
    return {
        "id": d.id,
        "session_key": folder.session_key,
        "name": d.name,
        "file_name": d.file_name,
        "original_file_name": d.original_file_name,
        "size": d.size,
        "encrypted": d.encrypted,
        "page_count": d.page_count,
        "uploaded_at": d.uploaded_at,
        "annotation_count": annotation_count(storage, parts),
        "missing": not storage.absolute_path(parts).exists(),
        "version": d.version,
    }


def list_documents(
    db: Session, storage: StorageService, user: User, key: str
) -> list[dict[str, Any]]:
    """The documents of the session's course (or event series), whichever of its sessions they
    were uploaded to."""
    resolved = sfs.resolve(db, user, key)
    rows = db.scalars(
        scope_of(user, resolved)
        .documents(user)
        .order_by(Document.uploaded_at.desc(), Document.id.desc())
    )
    return [view(db, storage, user, d) for d in rows]


def get_document(
    db: Session, storage: StorageService, user: User, document_id: str
) -> dict[str, Any]:
    return view(db, storage, user, get_owned(db, user, document_id))


def file_path(
    db: Session, storage: StorageService, user: User, document_id: str
) -> tuple[Path, Document]:
    d = get_owned(db, user, document_id)
    parts, _ = pdf_parts(db, user, d)
    path = storage.absolute_path(parts)
    if not path.is_file():
        raise ApiError(
            404, "file_missing", "The PDF is missing from the session's documents folder."
        )
    return path, d


# ---- reading position (FR-019, research R12) ------------------------------------------------


def get_position(db: Session, user: User, document_id: str) -> dict[str, Any]:
    d = get_owned(db, user, document_id)
    pos = db.get(DocumentPosition, (user.id, d.id))
    return {"page": pos.page if pos else None}


def put_position(db: Session, user: User, document_id: str, page: int) -> dict[str, Any]:
    """Remember the last page (upsert). Not versioned: the latest page wins."""
    d = get_owned(db, user, document_id)
    pos = db.get(DocumentPosition, (user.id, d.id))
    if pos is None:
        db.add(DocumentPosition(user_id=user.id, document_id=d.id, page=page))
    else:
        pos.page = page
    db.flush()
    return {"page": page}


# ---- import --------------------------------------------------------------------------------


def _unique_name(base: str, taken: set[str]) -> str:
    name, n = base, 2
    while name_key(name) in taken:
        suffix = f" ({n})"
        name, n = base[: MAX_NAME - len(suffix)].rstrip() + suffix, n + 1
    return name


def _document_name(original_file_name: str) -> str:
    stem = original_file_name[: original_file_name.rfind(".")]  # the route checked `.pdf`
    return normalize_display(stem)[:MAX_NAME].strip() or FALLBACK_NAME


def _free_file_name(
    storage: StorageService, folder_parts: list[str], name: str, taken: list[str]
) -> str:
    """A `.pdf` name no row uses and no file on disk has — neither the PDF nor its sidecar."""
    file_name = unique_sibling(safe_name(name) + ".pdf", taken)
    while True:
        pdf = [*folder_parts, "documents", file_name]
        if (
            not storage.absolute_path(pdf).exists()
            and not storage.absolute_path(storage.sidecar_parts(pdf)).exists()
        ):
            return file_name
        taken.append(file_name)
        file_name = unique_sibling(safe_name(name) + ".pdf", taken)


def import_document(
    db: Session,
    storage: StorageService,
    user: User,
    key: str,
    staged: StagedUpload,
    original_file_name: str,
) -> dict[str, Any]:
    """Turn a fully received staging file into a Document (FR-005–FR-008). Refused (and the
    staging file discarded) unless it looks like a PDF; never touches existing documents."""
    probe = probe_pdf(staged.path)
    if probe is None:
        storage.discard_upload(staged.path)
        raise ApiError(422, "unreadable_pdf", f"{original_file_name} couldn't be read as a PDF.")
    with session_import_lock(user.id, key):
        resolved = sfs.resolve(db, user, key)
        folder = sfs.get_or_create_folder(db, storage, user, resolved)
        scope = scope_of(user, resolved)
        with scope_import_lock(user.id, scope):
            rows = list(db.scalars(select(Document).where(Document.session_folder_id == folder.id)))
            course_names = set(
                db.scalars(scope.documents(user).with_only_columns(Document.name_key))
            )
            name = _unique_name(_document_name(original_file_name), course_names)
            folder_parts = sfs.folder_parts(user, resolved, folder)
            file_name = _free_file_name(storage, folder_parts, name, [r.file_name for r in rows])
            on_rollback(
                db, storage.commit_upload(staged.path, [*folder_parts, "documents", file_name])
            )
            d = Document(
                user_id=user.id,
                session_folder_id=folder.id,
                name=name,
                name_key=name_key(name),
                file_name=file_name,
                file_key=file_name.casefold(),
                original_file_name=original_file_name[:255],
                size=staged.size,
                sha256=staged.sha256,
                encrypted=probe.encrypted,
                uploaded_at=_now(),
            )
            db.add(d)
            db.flush()
            db.commit()  # visible before the locks are released
    log.info("document %s added to session folder %s", d.id, folder.id)
    return view(db, storage, user, d)


# ---- update ----------------------------------------------------------------------------------


def set_page_count(
    db: Session, storage: StorageService, user: User, document_id: str, version: int, pages: int
) -> dict[str, Any]:
    """The reader reports the page count on first open (it is in the PDF, not worth parsing
    on upload). Doesn't bump the version: it changes nothing the user did."""
    from unihelper.api.deps import check_version

    d = get_owned(db, user, document_id)
    check_version(version, d.version)
    if d.page_count != pages:
        db.query(Document).filter(Document.id == d.id).update(
            {Document.page_count: pages}, synchronize_session="fetch"
        )
        db.refresh(d)
    return view(db, storage, user, d)


def _name_taken(scope: DocumentScope) -> ApiError:
    where = "event" if scope.lock_key.startswith("event:") else "course"
    msg = f"A document with this name already exists in this {where}."
    return ApiError(
        409, "name_taken", msg, errors=[{"field": "/name", "code": "name_taken", "message": msg}]
    )


def rename_document(
    db: Session, storage: StorageService, user: User, document_id: str, version: int, name: str
) -> dict[str, Any]:
    """Rename the document; its PDF and annotation sidecar are renamed together (FR-009)."""
    from unihelper.api.deps import check_version
    from unihelper.api.errors import validation_error

    d = get_owned(db, user, document_id)
    check_version(version, d.version)
    name = normalize_display(name)
    if not name:
        raise validation_error("/name", "name_required", "Enter a name.")
    if len(name) > MAX_NAME:
        raise validation_error("/name", "name_too_long", "Use at most 120 characters.")
    with document_file_lock(d.id):
        parts, folder = pdf_parts(db, user, d)
        # names are unique across the course (or event series): its sessions all list it
        scope = scope_of_folder(user, folder)
        with scope_import_lock(user.id, scope):
            clash = db.scalar(
                scope.documents(user).where(
                    Document.name_key == name_key(name), Document.id != d.id
                )
            )
            if clash is not None:
                raise _name_taken(scope)
            folder_parts = parts[:-2]
            others = list(
                db.scalars(
                    select(Document.file_name).where(
                        Document.session_folder_id == d.session_folder_id, Document.id != d.id
                    )
                )
            )
            new_file = unique_sibling(safe_name(name) + ".pdf", others)
            if new_file.casefold() != d.file_name.casefold():
                new_file = _free_file_name(storage, folder_parts, name, others)
            if new_file != d.file_name:
                on_rollback(db, storage.rename_pair(parts, [*parts[:-1], new_file]))
                _retarget_sidecar(storage, [*parts[:-1], new_file])
                d.file_name = new_file
                d.file_key = new_file.casefold()
            d.name = name
            d.name_key = name_key(name)
            db.flush()
            db.commit()  # visible before an annotation save waiting on the lock reads the name
    return view(db, storage, user, d)


def delete_document(
    db: Session, storage: StorageService, user: User, document_id: str, version: int
) -> None:
    """Delete the document: its row, then its PDF and annotation sidecar (FR-010, user-confirmed).
    The files go only after the row's deletion committed; a file that can't be removed then stays
    on disk (the user's data is never lost the other way round)."""
    from unihelper.api.deps import check_version

    d = get_owned(db, user, document_id)
    check_version(version, d.version)
    with document_file_lock(d.id):
        parts, _ = pdf_parts(db, user, d)
        db.delete(d)
        db.flush()
        db.commit()
        for file in (parts, storage.sidecar_parts(parts)):
            try:
                storage.delete_content_file(file)
            except OSError:
                log.exception("could not remove %s of deleted document %s", file[-1], document_id)
    log.info("document %s deleted", document_id)


def _retarget_sidecar(storage: StorageService, pdf: list[str]) -> None:
    """Keep the sidecar's `document.fileName` pointing at the renamed PDF (cosmetic: the
    sidecar is found by its own name)."""
    sidecar = storage.sidecar_parts(pdf)
    data = storage.read_bytes(sidecar)
    if data is None:
        return
    try:
        model = json.loads(data)
        model.setdefault("document", {})["fileName"] = pdf[-1]
    except (ValueError, AttributeError, TypeError):
        return  # unreadable: annotation_service moves it aside on the next save
    storage.write_text_atomic(sidecar, json.dumps(model, ensure_ascii=False, indent=2))
