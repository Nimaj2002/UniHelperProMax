"""Attachments of chats (014 US8/US9, research R9/R10, data-model.md "ContextItem").

- Availability of referenced items: a deleted note, PDF or recording shows as "no longer
  available" (FR-057); a renamed note shows its new title.
- Evaluation of the context for a model: what each style and model accepts, the per-file and
  per-message limits (checked after base64 encoding, where providers count), the PDF text
  fallback (FR-053), audio formats (WebM recordings are remuxed to Ogg for Gemini, FR-054), and
  a size estimate against the model's context limit (FR-056). Nothing is truncated or dropped
  silently: anything not accepted is refused with a reason.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from unihelper.ai.base import Audio, Image, NoteText, Part, Pdf, PdfText
from unihelper.ai.limits import LIMITS, base64_size, human
from unihelper.api.errors import ApiError
from unihelper.chat import files
from unihelper.domain import pdf_text
from unihelper.domain.ogg_opus import RemuxUnsupported, remux_webm_opus
from unihelper.models import AiEndpoint, AiModel, Chat, ChatUpload, Document, Note, Recording, User
from unihelper.storage.storage_service import StorageService

MODELS: dict[str, Any] = {
    "note": Note,
    "document": Document,
    "recording": Recording,
    "upload": ChatUpload,
}
TITLE_FIELD = {"note": "name", "document": "name", "recording": "name", "upload": "original_name"}
IMAGE_TOKENS = 1600
PDF_PAGE_TOKENS = {"anthropic": 1500, "gemini": 258}
AUDIO_TOKENS_PER_SECOND = 32
OPENAI_AUDIO = {"audio/wav": "wav", "audio/mpeg": "mp3"}
GEMINI_AUDIO = {"audio/wav", "audio/mpeg", "audio/aiff", "audio/aac", "audio/ogg", "audio/flac"}

REASONS = {
    "no_images": "This model doesn't accept pictures.",
    "no_pdf": "This model doesn't accept PDF documents. You can send the PDF's text instead.",
    "no_audio": "This model doesn't accept audio — use Transcribe on the recording.",
    "format": "This model doesn't accept this file format.",
    "audio_format": "This model accepts WAV or MP3 audio. Use Transcribe for this recording.",
    "missing": "This item is no longer available.",
    "no_text": "This PDF has no text (for example a scan), so its text can't be sent instead.",
    "encrypted": "This PDF is password-protected and can't be sent.",
}


def availability(
    db: Session, user: User, doc: dict[str, Any]
) -> dict[tuple[str, str], tuple[bool, str]]:
    """(kind, ref) → (still available, current title)."""
    out: dict[tuple[str, str], tuple[bool, str]] = {}
    items = list(doc.get("context", []))
    for turn in doc.get("turns", []):
        for version in turn.get("versions", []):
            items += version.get("attachments", [])
    for item in items:
        key = (item.get("kind", ""), item.get("ref", ""))
        if key in out or key[0] not in MODELS:
            continue
        row = db.get(MODELS[key[0]], key[1])
        if row is None or row.user_id != user.id:
            out[key] = (False, item.get("title") or key[1])
        else:
            out[key] = (True, getattr(row, TITLE_FIELD[key[0]]))
    return out


# ───────────────────────────── reading the items ─────────────────────────────


@dataclass
class Item:
    kind: str
    ref: str
    title: str
    category: str  # note, image, pdf, audio
    mime: str | None = None
    size: int | None = None
    pdf_mode: str | None = None
    available: bool = True
    accepted: bool = True
    reason_code: str | None = None
    reason: str | None = None
    text_fallback: bool = False
    pdf_has_text: bool | None = None
    tokens: int = 0
    pages: int | None = None
    duration_ms: int | None = None
    parts_: list[Part] = field(default_factory=list, repr=False)

    def refuse(self, code: str, reason_key: str | None = None) -> None:
        self.accepted = False
        self.reason_code = code
        self.reason = REASONS[reason_key or code]


def _folder_parts(db: Session, user: User, folder_id: str) -> list[str]:
    from unihelper.chat.runs import folder_parts_of
    from unihelper.models import SessionFolder

    folder = db.get(SessionFolder, folder_id)
    assert folder is not None
    return folder_parts_of(db, user, folder)


def _bytes_of(
    db: Session, storage: StorageService, user: User, item: dict[str, Any]
) -> tuple[Any, bytes | None]:
    kind, ref = item.get("kind"), item.get("ref", "")
    row = db.get(MODELS[kind], ref) if kind in MODELS else None
    if row is None or row.user_id != user.id:
        return None, None
    if kind == "upload":
        parts = [*_folder_parts(db, user, row.session_folder_id), *row.rel_path.split("/")]
    elif kind == "document":
        parts = [*_folder_parts(db, user, row.session_folder_id), "documents", row.file_name]
    elif kind == "recording":
        parts = [*_folder_parts(db, user, row.session_folder_id), "audios", row.file_name]
    else:
        return row, None
    return row, storage.read_bytes(parts)


def _audio_part(style: str, mime: str, data: bytes, item: Item) -> Audio | None:
    if style == "openai":
        fmt = OPENAI_AUDIO.get(mime)
        if fmt is None:
            item.refuse("format", "audio_format")
            return None
        return Audio(mime, fmt, data)
    if mime == "audio/webm":
        try:
            return Audio("audio/ogg", "ogg", remux_webm_opus(data))
        except RemuxUnsupported:
            item.refuse("format", "audio_format")
            return None
    if mime not in GEMINI_AUDIO:
        item.refuse("format")
        return None
    return Audio(mime, mime.split("/")[1], data)


def evaluate(
    db: Session,
    storage: StorageService,
    user: User,
    context: list[dict[str, Any]],
    model: AiModel,
    endpoint: AiEndpoint,
    build: bool = False,
) -> list[Item]:
    """Every context item checked against the model; with `build`, the request parts too."""
    style = endpoint.style
    limits = LIMITS[style]
    items: list[Item] = []
    for entry in context:
        kind = entry.get("kind", "")
        if kind == "note":
            note = db.get(Note, entry.get("ref", ""))
            items.append(
                Item(
                    kind,
                    entry.get("ref", ""),
                    note.name if note else entry.get("title", ""),
                    "note",
                    available=note is not None and note.user_id == user.id,
                    size=note.size if note else None,
                    tokens=(note.size // 4) if note else 0,
                )
            )
            if not items[-1].available:
                items[-1].refuse("missing")
            continue
        row, data = _bytes_of(db, storage, user, entry)
        title = getattr(row, TITLE_FIELD.get(kind, "name"), None) or entry.get("title", "")
        if kind == "upload" and row is not None:
            category = row.kind
            mime = row.mime
        elif kind == "document":
            category, mime = "pdf", "application/pdf"
        else:
            category = "audio"
            mime = getattr(row, "mime_type", None)
        item = Item(
            kind,
            entry.get("ref", ""),
            title,
            category,
            mime=mime,
            size=len(data) if data is not None else None,
            pdf_mode=entry.get("pdfMode"),
        )
        items.append(item)
        if row is None or data is None:
            item.available = False
            item.refuse("missing")
            continue
        if category == "image":
            item.tokens = IMAGE_TOKENS
            if not model.cap_images:
                item.refuse("no_images")
            elif mime not in limits.image_types:
                item.refuse("format")
            elif base64_size(len(data)) > limits.per_file_bytes["image"]:
                item.accepted, item.reason_code = False, "too_large"
                most = human(limits.per_file_bytes["image"])
                item.reason = f"Pictures can be at most {most} for this provider."
            elif build:
                item.parts_.append(Image(mime or "image/png", data))
        elif category == "pdf":
            extracted = (
                pdf_text.extract(data) if (not model.cap_pdf or item.pdf_mode == "text") else None
            )
            pages = getattr(row, "page_count", None)
            item.pages = pages or (extracted.pages if extracted else None)
            if extracted is not None and extracted.encrypted:
                item.refuse("encrypted")
                continue
            if model.cap_pdf and item.pdf_mode != "text":
                item.tokens = (
                    (item.pages or 1) * PDF_PAGE_TOKENS[style]
                    if style in PDF_PAGE_TOKENS
                    else len(pdf_text.extract(data).text) // 4
                )
                limit_pages = limits.max_pdf_pages
                if (
                    style == "anthropic"
                    and model.context_limit
                    and model.context_limit >= 1_000_000
                    and limits.max_pdf_pages_large_context
                ):
                    limit_pages = limits.max_pdf_pages_large_context
                if base64_size(len(data)) > limits.per_file_bytes["pdf"]:
                    item.accepted, item.reason_code = False, "too_large"
                    most = human(limits.per_file_bytes["pdf"])
                    item.reason = f"PDFs can be at most {most} for this provider."
                elif limit_pages and item.pages and item.pages > limit_pages:
                    item.accepted, item.reason_code = False, "too_large"
                    item.reason = f"PDFs can have at most {limit_pages} pages for this model."
                elif build:
                    item.parts_.append(
                        Pdf(title if title.lower().endswith(".pdf") else f"{title}.pdf", data)
                    )
            else:
                assert extracted is not None
                item.pdf_has_text = extracted.has_text
                item.text_fallback = extracted.has_text
                item.tokens = len(extracted.text) // 4
                if not extracted.has_text:
                    item.refuse("no_text")
                elif item.pdf_mode != "text":
                    item.refuse("no_pdf")
                elif build:
                    item.parts_.append(PdfText(title, extracted.text))
        else:  # audio
            item.duration_ms = getattr(row, "duration_ms", None)
            item.tokens = ((item.duration_ms or 0) // 1000) * AUDIO_TOKENS_PER_SECOND
            if style == "anthropic" or not model.cap_audio:
                item.refuse("no_audio")
            elif base64_size(len(data)) > limits.per_file_bytes["audio"]:
                item.accepted, item.reason_code = False, "too_large"
                item.reason = (
                    f"Audio can be at most {human(limits.per_file_bytes['audio'])} for this "
                    "provider. Transcribe the recording first."
                )
            else:
                part = _audio_part(style, mime or "", data, item)
                if part is not None and build:
                    item.parts_.append(part)
    return items


def message_size(items: list[Item]) -> int:
    total = 0
    for item in items:
        for part in item.parts_:
            if isinstance(part, Image | Pdf | Audio):
                total += base64_size(len(part.data))
    return total


def file_parts(
    db: Session,
    storage: StorageService,
    user: User,
    folder: Sequence[str],
    stem: str,
    context: list[dict[str, Any]],
    model: AiModel,
    endpoint: AiEndpoint,
) -> list[Part]:
    """Request parts of the files in context; refuses (409/413) rather than dropping any."""
    files_context = [c for c in context if c.get("kind") != "note"]
    if not files_context:
        return []
    items = evaluate(db, storage, user, files_context, model, endpoint, build=True)
    refused = [i for i in items if not i.accepted]
    too_large = [i for i in refused if i.reason_code == "too_large"]
    if too_large:
        raise ApiError(413, "too_large", too_large[0].reason or "This attachment is too large.")
    if refused:
        raise ApiError(
            409,
            "attachment_not_accepted",
            "Some attachments can't be sent to this model.",
            "; ".join(f"{i.title}: {i.reason}" for i in refused),
            extra={
                "unaccepted": [
                    {"kind": i.kind, "ref": i.ref, "reasonCode": i.reason_code, "reason": i.reason}
                    for i in refused
                ]
            },
        )
    limit = LIMITS[endpoint.style].per_message_bytes
    if message_size(items) > limit:
        raise ApiError(
            413,
            "too_large",
            f"The attachments of one message can be at most {human(limit)} for this provider.",
        )
    if endpoint.style == "anthropic":
        images = sum(1 for i in items for p in i.parts_ if isinstance(p, Image))
        if LIMITS["anthropic"].max_images and images > LIMITS["anthropic"].max_images:
            raise ApiError(413, "too_large", "Anthropic accepts at most 100 pictures per message.")
    _settle_uploads(db, storage, user, folder, stem, files_context)
    return [p for i in items for p in i.parts_]


def _settle_uploads(
    db: Session,
    storage: StorageService,
    user: User,
    folder: Sequence[str],
    stem: str,
    context: list[dict[str, Any]],
) -> None:
    """Uploads sent for the first time move from `chats/.uploads/` into `<stem>.files/`."""
    from unihelper.db.engine import on_rollback

    for entry in context:
        if entry.get("kind") != "upload":
            continue
        row = db.get(ChatUpload, entry.get("ref", ""))
        if row is None or not row.rel_path.startswith(f"{files.CHATS}/{files.UPLOADS}/"):
            continue
        name = row.rel_path.rsplit("/", 1)[-1].removeprefix(f"{row.id}-")
        target_dir = files.files_parts(folder, stem)
        taken = (
            {p.name for p in storage.path_for(target_dir).glob("*")}
            if storage.exists(target_dir)
            else set()
        )
        index = len(taken) + 1
        target_name = f"{index:02d}-{name}"
        old = [*folder, *row.rel_path.split("/")]
        storage.ensure_dir(target_dir)
        undo = storage.rename_file(old, [*target_dir, target_name])
        on_rollback(db, undo)
        row.rel_path = f"{files.CHATS}/{stem}.files/{target_name}"
        row.chat_id = db.scalar(
            select(Chat.id).where(
                Chat.session_folder_id == row.session_folder_id, Chat.stem == stem
            )
        )
        entry["file"] = target_name


def note_parts(items: list[Item]) -> list[NoteText]:  # pragma: no cover - notes are snapshotted
    return [p for i in items for p in i.parts_ if isinstance(p, NoteText)]
