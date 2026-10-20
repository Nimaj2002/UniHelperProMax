"""Chat files in the session folder (014 contracts/chat-file-format.md, Principle II).

`chats/<stem>.json` (format `uh-chat/1`) is the source of truth; `chats/<stem>.md` is a
transcript regenerated from it after every write, for reading outside the app; uploads and note
snapshots go in `chats/<stem>.files/`. Writes are atomic and serialised per chat. Fields this
version doesn't know are kept when the file is rewritten. No key or auth value is ever written
here (FR-049).
"""

from __future__ import annotations

import json
import threading
from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from datetime import datetime
from typing import Any

from unihelper.domain.naming import safe_name, unique_sibling
from unihelper.storage.storage_service import StorageService

FORMAT = "uh-chat/1"
CHATS = "chats"
UPLOADS = ".uploads"
TITLE_IN_STEM = 60
TITLE_LEN = 60  # FR-029: the first 60 characters of the first message

# fixed key order keeps diffs readable; unknown keys follow in their own order
ORDER: dict[str, tuple[str, ...]] = {
    "chat": ("format", "id", "title", "createdAt", "updatedAt", "model", "context", "turns"),
    "turn": ("id", "selected", "versions"),
    "version": (
        "id",
        "text",
        "createdAt",
        "attachments",
        "noteSnapshots",
        "selectedAnswer",
        "answers",
    ),
    "answer": (
        "id",
        "status",
        "text",
        "endpointLabel",
        "modelLabel",
        "locality",
        "endpointId",
        "modelId",
        "startedAt",
        "endedAt",
        "usage",
        "error",
    ),
}


class ChatFileUnreadable(Exception):
    def __init__(self, path: str) -> None:
        super().__init__(path)
        self.path = path


_locks: dict[str, threading.RLock] = {}
_locks_guard = threading.Lock()


@contextmanager
def chat_lock(chat_id: str) -> Iterator[None]:
    """Serialise writers of one chat's file (request handlers and its run). In-process only:
    the backend runs as a single process (single_process.py)."""
    with _locks_guard:
        lock = _locks.setdefault(chat_id, threading.RLock())
    with lock:
        yield


# ───────────────────────────── paths ─────────────────────────────


def chats_dir(folder: Sequence[str]) -> list[str]:
    return [*folder, CHATS]


def json_parts(folder: Sequence[str], stem: str) -> list[str]:
    return [*folder, CHATS, f"{stem}.json"]


def md_parts(folder: Sequence[str], stem: str) -> list[str]:
    return [*folder, CHATS, f"{stem}.md"]


def files_parts(folder: Sequence[str], stem: str) -> list[str]:
    return [*folder, CHATS, f"{stem}.files"]


def uploads_parts(folder: Sequence[str]) -> list[str]:
    return [*folder, CHATS, UPLOADS]


def title_from(text: str) -> str:
    collapsed = " ".join(text.split())
    return collapsed[:TITLE_LEN] or "New chat"


def new_stem(created: datetime, title: str, taken: Sequence[str]) -> str:
    """`YYYY-MM-DD HHMM <title>`; a clash gets ` (2)` as elsewhere in the app."""
    head = created.strftime("%Y-%m-%d %H%M")
    name = safe_name(f"{head} {title[:TITLE_IN_STEM]}")
    picked = unique_sibling(f"{name}.json", [f"{t}.json" for t in taken])
    return picked.removesuffix(".json")


# ───────────────────────────── document ─────────────────────────────


def _ordered(obj: dict[str, Any], kind: str) -> dict[str, Any]:
    keys = ORDER[kind]
    out = {k: obj[k] for k in keys if k in obj}
    out.update({k: v for k, v in obj.items() if k not in out})
    return out


def canonical(doc: dict[str, Any]) -> dict[str, Any]:
    turns = []
    for turn in doc.get("turns", []):
        versions = []
        for version in turn.get("versions", []):
            answers = [_ordered(a, "answer") for a in version.get("answers", [])]
            versions.append(_ordered({**version, "answers": answers}, "version"))
        turns.append(_ordered({**turn, "versions": versions}, "turn"))
    return _ordered({**doc, "format": FORMAT, "turns": turns}, "chat")


def dumps(doc: dict[str, Any]) -> str:
    return json.dumps(canonical(doc), ensure_ascii=False, indent=2) + "\n"


def read(storage: StorageService, folder: Sequence[str], stem: str) -> dict[str, Any]:
    parts = json_parts(folder, stem)
    data = storage.read_bytes(parts)
    if data is None:
        raise ChatFileUnreadable(StorageService.relative_path(parts))
    try:
        doc = json.loads(data.decode("utf-8"))
    except (UnicodeDecodeError, ValueError) as exc:
        raise ChatFileUnreadable(StorageService.relative_path(parts)) from exc
    if (
        not isinstance(doc, dict)
        or doc.get("format") != FORMAT
        or not isinstance(doc.get("turns"), list)
    ):
        raise ChatFileUnreadable(StorageService.relative_path(parts))
    return doc


def write(
    storage: StorageService, folder: Sequence[str], stem: str, doc: dict[str, Any], label: str
) -> str:
    """Write the JSON atomically, then regenerate the transcript. Returns the JSON's sha256."""
    digest, _size = storage.write_text_atomic(json_parts(folder, stem), dumps(doc))
    storage.write_text_atomic(md_parts(folder, stem), render_transcript(doc, label))
    return digest


def ensure_transcript(
    storage: StorageService, folder: Sequence[str], stem: str, doc: dict[str, Any], label: str
) -> None:
    """Rebuild a transcript that was deleted or edited outside the app (it is derived)."""
    expected = render_transcript(doc, label)
    current = storage.read_bytes(md_parts(folder, stem))
    if current is None or current.decode("utf-8", "replace") != expected:
        storage.write_text_atomic(md_parts(folder, stem), expected)


# ───────────────────────────── selection helpers ─────────────────────────────


def selected_version(turn: dict[str, Any]) -> dict[str, Any]:
    versions: list[dict[str, Any]] = turn["versions"]
    index = min(max(int(turn.get("selected", 0)), 0), len(versions) - 1)
    return versions[index]


def selected_answer(version: dict[str, Any]) -> dict[str, Any] | None:
    answers: list[dict[str, Any]] = version.get("answers") or []
    if not answers:
        return None
    index = min(max(int(version.get("selectedAnswer", 0)), 0), len(answers) - 1)
    return answers[index]


def find_answer(doc: dict[str, Any], answer_id: str) -> dict[str, Any] | None:
    for turn in doc.get("turns", []):
        for version in turn.get("versions", []):
            for answer in version.get("answers", []):
                if answer.get("id") == answer_id:
                    return answer  # type: ignore[no-any-return]
    return None


def message_count(doc: dict[str, Any]) -> int:
    count = 0
    for turn in doc.get("turns", []):
        count += 1
        if selected_answer(selected_version(turn)) is not None:
            count += 1
    return count


# ───────────────────────────── transcript ─────────────────────────────

STATUS_NOTE = {
    "stopped": "*(Stopped)*",
    "interrupted": "*(Interrupted)*",
    "failed": "*(Failed)*",
    "streaming": "*(Generating…)*",
    "queued": "*(Generating…)*",
}


def _clock(iso: str | None) -> str:
    if not iso:
        return ""
    try:
        return datetime.fromisoformat(iso).strftime("%H:%M")
    except ValueError:
        return ""


def render_transcript(doc: dict[str, Any], label: str) -> str:
    created = doc.get("createdAt", "")
    try:
        started = datetime.fromisoformat(created).strftime("%Y-%m-%d %H:%M")
    except ValueError:
        started = created
    lines = [f"# {doc.get('title', 'Chat')}", "", f"Chat in {label} · started {started}", ""]
    for turn in doc.get("turns", []):
        version = selected_version(turn)
        lines += [f"## You — {_clock(version.get('createdAt'))}", "", version.get("text", ""), ""]
        attached = version.get("attachments") or []
        if attached:
            names = ", ".join(f"{a.get('title', a.get('ref'))} ({a.get('kind')})" for a in attached)
            lines += [f"Attached: {names}", ""]
        answer = selected_answer(version)
        if answer is None:
            continue
        who = " · ".join(x for x in (answer.get("endpointLabel"), answer.get("modelLabel")) if x)
        lines += [f"## Assistant — {who} — {_clock(answer.get('startedAt'))}", ""]
        if answer.get("text"):
            lines += [answer["text"], ""]
        note = STATUS_NOTE.get(answer.get("status", ""))
        if note:
            lines += [note, ""]
    return "\n".join(lines).rstrip("\n") + "\n"
