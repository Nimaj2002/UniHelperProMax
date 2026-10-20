"""Build the provider request for one answer (014 data-model.md "The conversation sent").

For each earlier turn: its selected user version's text, then its selected answer when that
answer has text and did not fail. The message being answered carries the chat's context items —
every attached note as a fresh snapshot taken now (clarification Q2) plus attached files — then
its text. Items stay in context until removed (FR-056), so they are sent with every message;
earlier turns are sent as text only, which keeps a long chat from repeating every attachment.
"""

from __future__ import annotations

import hashlib
from collections.abc import Callable, Sequence
from typing import Any

from sqlalchemy.orm import Session

from unihelper.ai.base import (
    DEFAULT_MAX_TOKENS,
    MAX_TOKENS_CAP,
    ChatRequest,
    NeutralMessage,
    NoteText,
    Part,
    Text,
)
from unihelper.api.errors import ApiError
from unihelper.chat import files
from unihelper.models import AiModel, Note, User
from unihelper.services import ai_settings_service
from unihelper.storage.storage_service import StorageService

# kind → resolver of a context item into request parts (files: chat.attachments, US8)
FileResolver = Callable[[dict[str, Any]], list[Part]]


def max_tokens(model: AiModel) -> int:
    return min(model.output_limit, MAX_TOKENS_CAP) if model.output_limit else DEFAULT_MAX_TOKENS


def snapshot_parts(folder: Sequence[str], stem: str, digest: str) -> list[str]:
    return [*files.files_parts(folder, stem), "snapshots", f"{digest}.md"]


def take_note_snapshots(
    db: Session,
    storage: StorageService,
    user: User,
    folder: Sequence[str],
    stem: str,
    context: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[NoteText]]:
    """Snapshot every note in context now: content-addressed files, written once."""
    from unihelper.services import note_service

    refs: list[dict[str, Any]] = []
    parts: list[NoteText] = []
    for item in context:
        if item.get("kind") != "note":
            continue
        note = db.get(Note, item["ref"])
        if note is None or note.user_id != user.id:
            item["available"] = False
            continue
        content = note_service.get_note(db, storage, user, note.id)["content"]
        digest = hashlib.sha256(content.encode("utf-8")).hexdigest()[:16]
        target = snapshot_parts(folder, stem, digest)
        if not storage.exists(target):
            storage.write_text_atomic(target, content)
        item["title"], item["available"] = note.name, True
        refs.append({"noteId": note.id, "title": note.name, "snapshot": digest})
        parts.append(NoteText(note.name, content))
    return refs, parts


def history(doc: dict[str, Any], upto: int) -> list[NeutralMessage]:
    """Turns before index `upto`, as text."""
    messages: list[NeutralMessage] = []
    for turn in doc["turns"][:upto]:
        version = files.selected_version(turn)
        messages.append(NeutralMessage("user", [Text(version.get("text", ""))]))
        answer = files.selected_answer(version)
        if answer and answer.get("text") and answer.get("status") != "failed":
            messages.append(NeutralMessage("assistant", [Text(answer["text"])]))
    return messages


def build(
    db: Session,
    user: User,
    doc: dict[str, Any],
    turn_index: int,
    model: AiModel,
    context_parts: list[Part],
) -> ChatRequest:
    turn = doc["turns"][turn_index]
    version = files.selected_version(turn)
    current: list[Part] = [*context_parts]
    if version.get("text"):
        current.append(Text(version["text"]))
    if not current:
        raise ApiError(422, "empty_message", "Type a message or attach something to send.")
    messages = [*history(doc, turn_index), NeutralMessage("user", current)]
    return ChatRequest(
        model_id=model.model_id,
        messages=messages,
        system=ai_settings_service.instructions(db, user.id),
        max_tokens=max_tokens(model),
    )
