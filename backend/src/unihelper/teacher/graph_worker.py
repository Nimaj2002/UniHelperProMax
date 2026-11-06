"""Adds what lessons taught to the knowledge graph, in the background (022 research R8).

A lesson is processed once it has been idle for 5 minutes, when its tab closes, or when the
student asks ("Update graph"); only its turns not yet processed are sent, one job at a time,
never while that chat is generating. A failed job leaves the lesson untouched and is retried on
request or after an hour (FR-029, FR-036).
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
from sqlalchemy import or_, select
from sqlalchemy.orm import Session, sessionmaker

from unihelper.ai.base import AiError, ChatRequest, Delta, NeutralMessage, Text
from unihelper.ai.styles import adapter
from unihelper.chat import files
from unihelper.chat.runs import RunRegistry, chat_location, quiet_update
from unihelper.models import AiEndpoint, AiModel, Chat, SessionFolder
from unihelper.secrets.store import SecretStore
from unihelper.services import ai_endpoint_service, knowledge_graph_service, proxy_service
from unihelper.storage.storage_service import StorageService
from unihelper.teacher import prompts, view

log = logging.getLogger("unihelper.teacher")

IDLE = timedelta(minutes=5)
RETRY_FAILED = timedelta(hours=1)
SCAN_SECONDS = 60.0
MAX_EXISTING = 200


class JobError(Exception):
    def __init__(self, category: str) -> None:
        super().__init__(category)
        self.category = category[:30]


def _iso(moment: datetime) -> str:
    return moment.isoformat(timespec="seconds")


def parse_extraction(text: str) -> dict[str, Any]:
    """The model's JSON object, tolerating a code fence or prose around it."""
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end <= start:
        raise JobError("invalid_output")
    try:
        data = json.loads(text[start : end + 1])
    except ValueError as exc:
        raise JobError("invalid_output") from exc
    if not isinstance(data, dict) or not isinstance(data.get("ideas", []), list):
        raise JobError("invalid_output")
    return data


class GraphWorker:
    def __init__(
        self,
        maker: sessionmaker[Session],
        storage: StorageService,
        store: SecretStore,
        runs: RunRegistry,
        transport: Callable[[], httpx.AsyncBaseTransport | None],
        clock: Callable[[], datetime] = lambda: datetime.now(UTC),
    ) -> None:
        self._maker = maker
        self._storage = storage
        self._store = store
        self._runs = runs
        self._transport = transport
        self.clock = clock
        self._requested: list[str] = []
        self._wake: asyncio.Event | None = None
        self._loop: asyncio.AbstractEventLoop | None = None
        self._task: asyncio.Task[None] | None = None
        self._lock = asyncio.Lock()

    # ───────────────────────────── lifecycle ─────────────────────────────

    def attach(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop
        self._wake = asyncio.Event()

    async def start(self) -> None:
        self._task = asyncio.create_task(self._forever())

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            await asyncio.gather(self._task, return_exceptions=True)

    def request(self, chat_id: str) -> None:
        """Process this lesson soon, before idle ones (called from request threads)."""
        if chat_id not in self._requested:
            self._requested.insert(0, chat_id)
        if self._loop is not None and self._wake is not None:
            self._loop.call_soon_threadsafe(self._wake.set)

    async def _forever(self) -> None:
        assert self._wake is not None
        while True:
            try:
                await self.run_once()
            except Exception:
                log.exception("knowledge graph update failed")
            self._wake.clear()
            try:
                await asyncio.wait_for(self._wake.wait(), SCAN_SECONDS)
            except TimeoutError:
                pass

    # ───────────────────────────── jobs ─────────────────────────────

    async def run_once(self) -> int:
        """Every requested lesson, then every lesson that is due. Returns jobs run."""
        async with self._lock:
            done = 0
            while True:
                chat_id = self._requested.pop(0) if self._requested else None
                if chat_id is None:
                    due = await asyncio.to_thread(self._due)
                    if not due:
                        return done
                    chat_id = due[0]
                if self._runs.active_for_chat(chat_id) is not None:
                    continue  # never while it generates; its next reply makes it pending again
                await self._job(chat_id)
                done += 1

    def _due(self) -> list[str]:
        now = self.clock()
        with self._maker() as db:
            return list(
                db.scalars(
                    select(Chat.id)
                    .where(
                        Chat.kind == "lesson",
                        Chat.deleted_at.is_(None),
                        Chat.generating.is_(False),
                        or_(
                            (Chat.kg_status == "pending") & (Chat.updated_at <= _iso(now - IDLE)),
                            (Chat.kg_status == "failed")
                            & (Chat.kg_attempted_at <= _iso(now - RETRY_FAILED)),
                        ),
                    )
                    .order_by(Chat.updated_at)
                    .limit(1)
                )
            )

    async def _job(self, chat_id: str) -> None:
        prepared = await asyncio.to_thread(self._prepare, chat_id)
        if prepared is None:
            return
        cfg, request, upto, message_ids = prepared
        try:
            text = await self._collect(cfg, request)
            extraction = parse_extraction(text)
        except AiError as err:
            await asyncio.to_thread(self._fail, chat_id, err.category)
            return
        except JobError as err:
            await asyncio.to_thread(self._fail, chat_id, err.category)
            return
        except Exception:
            log.exception("knowledge graph extraction failed")
            await asyncio.to_thread(self._fail, chat_id, "provider")
            return
        await asyncio.to_thread(self._finish, chat_id, extraction, upto, message_ids)

    async def _collect(self, cfg: Any, request: ChatRequest) -> str:
        parts: list[str] = []
        async with proxy_service.client(cfg.proxy, self._transport()) as http:
            async for event in adapter(cfg.style).stream(http, cfg, request):
                if isinstance(event, Delta):
                    parts.append(event.text)
        if not "".join(parts).strip():
            raise JobError("empty_reply")  # e.g. the output budget went on thinking
        return "".join(parts)

    def _prepare(self, chat_id: str) -> tuple[Any, ChatRequest, int, list[str]] | None:
        with self._maker() as db:
            chat = db.get(Chat, chat_id)
            if chat is None or chat.kind != "lesson" or chat.deleted_at is not None:
                return None
            _user, folder = chat_location(db, chat)
            try:
                doc = files.read(self._storage, folder, chat.stem)
            except files.ChatFileUnreadable:
                self._mark(db, chat, "failed", "chat_file_unreadable")
                db.commit()
                return None
            turns = doc.get("turns", [])
            if chat.kg_processed_turns >= len(turns):
                self._mark(db, chat, "ok", None)
                db.commit()
                return None
            model = db.get(AiModel, chat.model_ref_id) if chat.model_ref_id else None
            endpoint = db.get(AiEndpoint, model.endpoint_id) if model is not None else None
            if model is None or endpoint is None or not endpoint.enabled:
                self._mark(db, chat, "failed", "model_unavailable")
                db.commit()
                return None
            try:
                cfg = ai_endpoint_service.config_for(db, self._store, endpoint)
            except Exception:
                self._mark(db, chat, "failed", "key_unreadable")
                db.commit()
                return None
            lines, message_ids = [], []
            for turn in turns[chat.kg_processed_turns :]:
                version = files.selected_version(turn)
                lines.append(f"Student: {version.get('text', '')}")
                answer = files.selected_answer(version)
                if answer and answer.get("text") and answer.get("status") != "failed":
                    message_ids.append(answer["id"])
                    said = view.model_text(doc, answer)
                    lines.append(f"Teacher [message {answer['id']}]: {said}")
            user = chat_location(db, chat)[0]
            folder_row = db.get(SessionFolder, chat.session_folder_id)
            course_id = folder_row.course_id if folder_row is not None else None
            existing = (
                knowledge_graph_service.search(db, user, None, course_id, "recent", MAX_EXISTING)
                if course_id
                else []
            )
            known = "\n".join(f"- {i['id']}: {i['name']} — {i['statement']}" for i in existing)
            content = (
                f"Existing ideas:\n{known or '(none)'}\n\nLesson transcript:\n\n"
                + "\n\n".join(lines)
            )
            request = ChatRequest(
                model_id=model.model_id,
                messages=[NeutralMessage("user", [Text(content)])],
                system=prompts.EXTRACTION,
                max_tokens=4096,
            )
            self._mark(db, chat, "running", None)
            db.commit()
            return cfg, request, len(turns), message_ids

    def _mark(self, db: Session, chat: Chat, status: str, error: str | None) -> None:
        values: dict[str, Any] = {"kg_status": status, "kg_error": error}
        if status in ("running",):
            values["kg_attempted_at"] = _iso(self.clock())
        quiet_update(db, chat.id, **values)

    def _mirror(self, db: Session, chat_id: str, processed: int | None = None) -> None:
        """Update the row and the chat file's `teacher.graph` together. With `processed`, the
        status becomes ok — or pending when the lesson went on while it was being read."""
        from unihelper.services.chat_service import label_of

        chat = db.get(Chat, chat_id)
        if chat is None:
            return
        db.refresh(chat)
        _user, folder = chat_location(db, chat)
        with files.chat_lock(chat.id):
            try:
                doc = files.read(self._storage, folder, chat.stem)
            except files.ChatFileUnreadable:
                return
            values: dict[str, Any] = {}
            if processed is not None:
                behind = processed < len(doc.get("turns", [])) or chat.generating
                values = {
                    "kg_processed_turns": processed,
                    "kg_status": "pending" if behind else "ok",
                    "kg_error": None,
                }
            view.teacher_of(doc)["graph"] = {
                "processedTurns": values.get("kg_processed_turns", chat.kg_processed_turns),
                "status": values.get("kg_status", chat.kg_status),
            }
            digest = files.write(self._storage, folder, chat.stem, doc, label_of(db, chat))
            quiet_update(db, chat.id, file_hash=digest, **values)

    def _fail(self, chat_id: str, category: str) -> None:
        with self._maker() as db:
            chat = db.get(Chat, chat_id)
            if chat is None:
                return
            self._mark(db, chat, "failed", category[:30])
            self._mirror(db, chat_id)
            db.commit()

    def _finish(
        self, chat_id: str, extraction: dict[str, Any], upto: int, message_ids: list[str]
    ) -> None:
        with self._maker() as db:
            chat = db.get(Chat, chat_id)
            if chat is None or chat.deleted_at is not None:
                return
            user = chat_location(db, chat)[0]
            knowledge_graph_service.merge(db, user, chat, extraction, message_ids)
            self._mirror(db, chat_id, processed=upto)
            db.commit()
