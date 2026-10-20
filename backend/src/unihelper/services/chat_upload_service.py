"""Pictures, PDFs and audio from the device for chats (014 US8, FR-052).

The type comes from the file's first bytes, never from its name; uploads go to the session's
`chats/.uploads/` and move into the chat's `<stem>.files/` folder when first sent. Uploads that
no chat and no draft refers to are removed after 24 h."""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from unihelper.api.errors import ApiError, not_found
from unihelper.api.uploads import StagedUpload
from unihelper.chat import files
from unihelper.db.engine import on_rollback
from unihelper.domain.naming import safe_name
from unihelper.models import ChatDraft, ChatUpload, User
from unihelper.models.base import new_id
from unihelper.services import session_folder_service as sfs
from unihelper.storage.storage_service import StorageService

STALE_AFTER = timedelta(hours=24)


def sniff(head: bytes) -> tuple[str, str] | None:
    """(kind, MIME type) from the first bytes of a file."""
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image", "image/png"
    if head.startswith(b"\xff\xd8\xff"):
        return "image", "image/jpeg"
    if head[:6] in (b"GIF87a", b"GIF89a"):
        return "image", "image/gif"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image", "image/webp"
    if head.startswith(b"%PDF-"):
        return "pdf", "application/pdf"
    if head[:4] == b"RIFF" and head[8:12] == b"WAVE":
        return "audio", "audio/wav"
    if head.startswith(b"ID3") or head[:2] in (b"\xff\xfb", b"\xff\xf3", b"\xff\xf2"):
        return "audio", "audio/mpeg"
    if head.startswith(b"OggS"):
        return "audio", "audio/ogg"
    if head.startswith(b"fLaC"):
        return "audio", "audio/flac"
    if head[4:8] == b"ftyp":
        return "audio", "audio/mp4"
    if head[:2] in (b"\xff\xf1", b"\xff\xf9"):
        return "audio", "audio/aac"
    if head.startswith(b"\x1a\x45\xdf\xa3"):
        return "audio", "audio/webm"
    return None


def store(
    db: Session,
    storage: StorageService,
    user: User,
    session_key: str,
    staged: StagedUpload,
    file_name: str,
) -> dict[str, Any]:
    with open(staged.path, "rb") as fh:
        found = sniff(fh.read(16))
    if found is None:
        raise ApiError(
            415, "unsupported_type", "Attach a PNG, JPEG, WebP or GIF picture, a PDF, or audio."
        )
    kind, mime = found
    r = sfs.resolve(db, user, session_key)
    folder_row = sfs.get_or_create_folder(db, storage, user, r)
    folder = sfs.folder_parts(user, r, folder_row)
    upload_id = new_id()
    name = safe_name(Path(file_name).name)
    target = [*files.uploads_parts(folder), f"{upload_id}-{name}"]
    undo = storage.commit_upload(staged.path, target)
    on_rollback(db, undo)
    row = ChatUpload(
        id=upload_id,
        user_id=user.id,
        session_folder_id=folder_row.id,
        kind=kind,
        mime=mime,
        size=staged.size,
        original_name=Path(file_name).name[:255],
        sha256=staged.sha256,
        rel_path=f"{files.CHATS}/{files.UPLOADS}/{upload_id}-{name}",
    )
    db.add(row)
    db.flush()
    return out(row)


def out(row: ChatUpload) -> dict[str, Any]:
    return {
        "id": row.id,
        "kind": row.kind,
        "mime": row.mime,
        "size": row.size,
        "name": row.original_name,
    }


def file_of(
    db: Session, storage: StorageService, user: User, upload_id: str
) -> tuple[ChatUpload, Path]:
    from unihelper.chat.attachments import _folder_parts

    row = db.get(ChatUpload, upload_id)
    if row is None or row.user_id != user.id:
        raise not_found("File")
    path = storage.path_for(
        [*_folder_parts(db, user, row.session_folder_id), *row.rel_path.split("/")]
    )
    if not path.is_file():
        raise not_found("File")
    return row, path


def sweep_stale(db: Session, storage: StorageService) -> int:
    """Staged uploads (never sent) that no draft refers to, older than 24 h."""
    from unihelper.chat.attachments import _folder_parts

    cutoff = (datetime.now(UTC) - STALE_AFTER).isoformat(timespec="seconds")
    referenced: set[str] = set()
    for draft in db.scalars(select(ChatDraft)):
        for item in json.loads(draft.attachments_json or "[]"):
            if item.get("kind") == "upload":
                referenced.add(item.get("ref", ""))
    count = 0
    for row in db.scalars(
        select(ChatUpload).where(ChatUpload.chat_id.is_(None), ChatUpload.created_at < cutoff)
    ):
        if row.id in referenced or not row.rel_path.startswith(f"{files.CHATS}/{files.UPLOADS}/"):
            continue
        user = db.get(User, row.user_id)
        if user is None:
            continue
        try:
            storage.path_for(
                [*_folder_parts(db, user, row.session_folder_id), *row.rel_path.split("/")]
            ).unlink(missing_ok=True)
        except OSError:
            continue
        db.delete(row)
        count += 1
    db.commit()
    return count
