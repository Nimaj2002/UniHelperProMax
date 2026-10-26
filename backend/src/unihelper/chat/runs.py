"""Chat runs: answers generated in the background, independent of any browser (014 research R1,
R2; contracts/chat-stream.md).

A send starts a run — an asyncio task on the app's event loop that owns the upstream stream and
writes the answer as it arrives. Browsers subscribe to its events (ids from 1, replayable from
`Last-Event-ID` while buffered); closing a panel, moving a chat to a tab, reloading or chatting
in several chats never interrupts it. Stop cancels the task, which closes the upstream
connection; nothing arrives after the stop answer. The answer is checkpointed to the chat file
every 2 s and written for good before the terminal event; a server shutdown or crash ends it as
"interrupted" (FR-036, FR-037).
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass, field
from typing import Any

import httpx
from sqlalchemy import select, update
from sqlalchemy.orm import Session, sessionmaker

from unihelper.ai.base import AiError, ChatRequest, Delta, EndpointConfig, UsageEvent
from unihelper.ai.styles import adapter
from unihelper.api.errors import ApiError
from unihelper.chat import files
from unihelper.models import Chat, ChatRun, SessionFolder, User
from unihelper.models.base import now_iso
from unihelper.models.chat import ACTIVE_RUN_STATUSES
from unihelper.storage.storage_service import StorageService

log = logging.getLogger("unihelper.chat")

FLUSH_SECONDS = 0.05
CHECKPOINT_SECONDS = 2.0
KEEPALIVE_SECONDS = 15.0
BUFFER_SECONDS = 60.0
TERMINAL = ("done", "stopped", "interrupted", "failed")


@dataclass
class Event:
    id: int
    name: str
    data: dict[str, Any]


@dataclass
class RunState:
    id: str
    user_id: str
    chat_id: str
    session_key: str
    answer_id: str
    turn_id: str
    endpoint_id: str
    start_data: dict[str, Any]
    events: list[Event] = field(default_factory=list)
    text: list[str] = field(default_factory=list)
    pending: list[str] = field(default_factory=list)
    usage: dict[str, int] | None = None
    status: str = "queued"
    stop_reason: str | None = None
    task: asyncio.Task[None] | None = None
    ended: float | None = None
    changed: asyncio.Event = field(default_factory=asyncio.Event)
    flush_handle: asyncio.TimerHandle | None = None

    @property
    def done(self) -> bool:
        return self.ended is not None


def folder_parts_of(db: Session, user: User, folder: SessionFolder) -> list[str]:
    from unihelper.services.trash_service import folder_parts

    parts = folder_parts(db, user, folder)
    if parts is None:  # pragma: no cover - a folder without a place (cannot hold a chat)
        raise RuntimeError("chat folder has no location")
    return parts


def quiet_update(db: Session, chat_id: str, **values: Any) -> None:
    """Bookkeeping of a chat row (generating, unseen, file hash…) without bumping its version:
    only the student's own edits may make their If-Match go stale (a Core UPDATE skips the
    ORM's version listener)."""
    db.execute(update(Chat).where(Chat.id == chat_id).values(**values))


def chat_location(db: Session, chat: Chat) -> tuple[User, list[str]]:
    user = db.get(User, chat.user_id)
    folder = db.get(SessionFolder, chat.session_folder_id)
    assert user is not None and folder is not None
    return user, folder_parts_of(db, user, folder)


class RunRegistry:
    def __init__(
        self,
        maker: sessionmaker[Session],
        storage: StorageService,
        transport: Callable[[], httpx.AsyncBaseTransport | None],
        label_of: Callable[[Session, Chat], str],
        max_per_user: int = 4,
        max_total: int = 8,
    ) -> None:
        self._maker = maker
        self._storage = storage
        self._transport = transport
        self._label_of = label_of
        self.max_per_user = max_per_user
        self.max_total = max_total
        self._runs: dict[str, RunState] = {}
        self._loop: asyncio.AbstractEventLoop | None = None
        # 016: accounts whose data is being restored start no new answers
        self.paused: Callable[[str], bool] = lambda _user_id: False

    # ───────────────────────────── lifecycle ─────────────────────────────

    def attach(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    def recover(self) -> int:
        """At startup: runs that were active when the server stopped end as interrupted, with
        the text of their last checkpoint (FR-037)."""
        with self._maker() as db:
            runs = list(db.scalars(select(ChatRun).where(ChatRun.status.in_(ACTIVE_RUN_STATUSES))))
            for run in runs:
                chat = db.get(Chat, run.chat_id)
                if chat is not None:
                    self._finish_file(db, chat, run.answer_id, "interrupted", None, None, None)
                run.status, run.ended_at = "interrupted", now_iso()
            db.execute(update(Chat).where(Chat.generating.is_(True)).values(generating=False))
            db.commit()
        return len(runs)

    async def shutdown(self) -> None:
        active = [s for s in self._runs.values() if not s.done and s.task is not None]
        for state in active:
            state.stop_reason = "interrupted"
            assert state.task is not None
            state.task.cancel()
        if active:
            await asyncio.wait([s.task for s in active if s.task is not None], timeout=10)

    # ───────────────────────────── starting ─────────────────────────────

    def active(self, user_id: str | None = None) -> list[RunState]:
        return [
            s
            for s in self._runs.values()
            if not s.done and (user_id is None or s.user_id == user_id)
        ]

    def active_for_chat(self, chat_id: str) -> RunState | None:
        return next((s for s in self.active() if s.chat_id == chat_id), None)

    def check_capacity(self, user_id: str) -> None:
        if self.paused(user_id):  # 016: this account's data is being restored
            raise ApiError(
                423, "restore_in_progress", "Your data is being restored.",
                "Wait until the restore has finished.",
            )
        if len(self.active(user_id)) >= self.max_per_user or len(self.active()) >= self.max_total:
            raise ApiError(
                429,
                "too_many_runs",
                "Too many answers are being generated at once.",
                "Wait for one of them to finish, or stop one, and send again.",
            )

    def prepare(
        self,
        run_id: str,
        user_id: str,
        chat_id: str,
        session_key: str,
        turn_id: str,
        answer_id: str,
        endpoint_id: str,
        start_data: dict[str, Any],
    ) -> RunState:
        state = RunState(
            run_id, user_id, chat_id, session_key, answer_id, turn_id, endpoint_id, start_data
        )
        self._runs[run_id] = state
        return state

    def launch(self, state: RunState, cfg: EndpointConfig, request: ChatRequest) -> None:
        """Start the task once the request's transaction has committed (called from the
        request thread through `on_commit`)."""
        assert self._loop is not None, "the run registry is not attached to the event loop"

        def spawn() -> None:
            state.task = asyncio.ensure_future(self._run(state, cfg, request))

        self._loop.call_soon_threadsafe(spawn)

    def forget(self, run_id: str) -> None:
        """A send whose transaction rolled back."""
        self._runs.pop(run_id, None)

    # ───────────────────────────── stopping ─────────────────────────────

    async def stop(self, run_id: str, reason: str = "stopped") -> RunState | None:
        state = self._runs.get(run_id)
        if state is None:
            return None
        if not state.done:
            state.stop_reason = reason
            for _ in range(200):  # wait for the task to exist (just launched)
                if state.task is not None or state.done:
                    break
                await asyncio.sleep(0.005)
            if state.task is not None and not state.done:
                state.task.cancel()
                await asyncio.wait([state.task])
        return state

    def stop_endpoint(self, endpoint_id: str) -> None:
        """Deleting an endpoint stops its answers (thread-safe; doesn't wait)."""
        for state in self.active():
            if state.endpoint_id == endpoint_id and self._loop is not None:
                state.stop_reason = "stopped"
                self._loop.call_soon_threadsafe(
                    lambda s=state: s.task.cancel() if s.task is not None else None  # type: ignore[misc]
                )

    def stop_chat_threadsafe(self, chat_id: str) -> None:
        state = self.active_for_chat(chat_id)
        if state is not None:
            self.stop_endpoint_state(state)

    def stop_endpoint_state(self, state: RunState) -> None:
        if self._loop is not None:
            state.stop_reason = "stopped"
            self._loop.call_soon_threadsafe(
                lambda: state.task.cancel() if state.task is not None else None
            )

    # ───────────────────────────── events ─────────────────────────────

    def _emit(self, state: RunState, name: str, data: dict[str, Any]) -> None:
        state.events.append(Event(len(state.events) + 1, name, data))
        state.changed.set()

    def _flush(self, state: RunState) -> None:
        state.flush_handle = None
        if state.pending:
            self._emit(state, "delta", {"text": "".join(state.pending)})
            state.pending = []

    def _queue_delta(self, state: RunState, text: str) -> None:
        state.text.append(text)
        state.pending.append(text)
        if state.flush_handle is None:
            loop = asyncio.get_running_loop()
            state.flush_handle = loop.call_later(FLUSH_SECONDS, self._flush, state)

    def get(self, run_id: str) -> RunState | None:
        self._prune()
        return self._runs.get(run_id)

    def _prune(self) -> None:
        now = time.monotonic()
        for run_id, state in list(self._runs.items()):
            if state.ended is not None and now - state.ended > BUFFER_SECONDS:
                del self._runs[run_id]

    async def subscribe(self, state: RunState, last_id: int) -> AsyncIterator[Event | None]:
        """Events after `last_id`; None means "send a keepalive"."""
        index = max(0, last_id)
        while True:
            while index < len(state.events):
                event = state.events[index]
                index += 1
                yield event
                if event.name in TERMINAL:
                    return
            if state.done:
                return
            state.changed.clear()
            try:
                await asyncio.wait_for(state.changed.wait(), KEEPALIVE_SECONDS)
            except TimeoutError:
                yield None

    # ───────────────────────────── the run ─────────────────────────────

    async def _run(self, state: RunState, cfg: EndpointConfig, request: ChatRequest) -> None:
        self._emit(state, "start", state.start_data)
        state.status = "streaming"
        error: dict[str, Any] | None = None
        status = "completed"
        try:
            await asyncio.to_thread(self._mark, state, "streaming")
            last_checkpoint = time.monotonic()
            async with httpx.AsyncClient(transport=self._transport()) as http:
                async for event in adapter(cfg.style).stream(http, cfg, request):
                    if isinstance(event, Delta):
                        self._queue_delta(state, event.text)
                        if time.monotonic() - last_checkpoint >= CHECKPOINT_SECONDS:
                            last_checkpoint = time.monotonic()
                            await asyncio.to_thread(self._checkpoint, state)
                    elif isinstance(event, UsageEvent):
                        state.usage = {
                            k: v
                            for k, v in (
                                ("input", event.input),
                                ("output", event.output),
                                ("total", event.total),
                            )
                            if v is not None
                        }
        except asyncio.CancelledError:
            status = state.stop_reason or "interrupted"
        except AiError as err:
            status = "failed"
            error = {"category": err.category, "message": err.message}
            if err.retry_after_seconds is not None:
                error["retryAfterSeconds"] = err.retry_after_seconds
        except Exception as exc:  # never leave a run hanging
            log.exception("chat run failed (%s)", type(exc).__name__)
            status = "failed"
            error = {"category": "provider", "message": "The answer couldn't be generated."}
        if state.flush_handle is not None:
            state.flush_handle.cancel()
        if status != "stopped" or not state.pending:
            self._flush(state)
        else:  # text already received is kept, but nothing is announced after Stop
            state.pending = []
        state.status = status
        try:
            await asyncio.shield(asyncio.to_thread(self._finish, state, status, error))
        except Exception:  # pragma: no cover - the file write failed; the run row says so
            log.exception("could not save the final answer")
        if state.usage:
            self._emit(state, "usage", dict(state.usage))
        ended_at = now_iso()
        if status == "completed":
            self._emit(
                state, "done", {"status": "completed", "usage": state.usage, "endedAt": ended_at}
            )
        elif status == "failed":
            self._emit(state, "failed", {"status": "failed", "error": error})
        else:
            self._emit(state, status, {"status": status, "endedAt": ended_at})
        state.ended = time.monotonic()
        state.changed.set()

    # ───────────────────────────── persistence (threads) ─────────────────────────────

    def _mark(self, state: RunState, status: str) -> None:
        with self._maker() as db:
            run = db.get(ChatRun, state.id)
            if run is not None:
                run.status = status
                db.commit()

    def _patch_answer(self, db: Session, chat: Chat, answer_id: str, patch: dict[str, Any]) -> None:
        user, folder = chat_location(db, chat)
        with files.chat_lock(chat.id):
            doc = files.read(self._storage, folder, chat.stem)
            answer = files.find_answer(doc, answer_id)
            if answer is None:
                return
            answer.update({k: v for k, v in patch.items() if v is not None})
            for k, v in patch.items():
                if v is None:
                    answer.pop(k, None)
            doc["updatedAt"] = now_iso()
            digest = files.write(self._storage, folder, chat.stem, doc, self._label_of(db, chat))
            quiet_update(db, chat.id, file_hash=digest, message_count=files.message_count(doc))

    def _checkpoint(self, state: RunState) -> None:
        with self._maker() as db:
            chat = db.get(Chat, state.chat_id)
            if chat is None:
                return
            try:
                self._patch_answer(
                    db, chat, state.answer_id, {"text": "".join(state.text), "status": "streaming"}
                )
            except files.ChatFileUnreadable:
                return
            db.commit()

    def _finish_file(
        self,
        db: Session,
        chat: Chat,
        answer_id: str,
        status: str,
        text: str | None,
        usage: dict[str, int] | None,
        error: dict[str, Any] | None,
    ) -> None:
        patch: dict[str, Any] = {"status": status, "endedAt": now_iso()}
        if text is not None:
            patch["text"] = text
        if usage:
            patch["usage"] = usage
        if error:
            patch["error"] = error
        try:
            self._patch_answer(db, chat, answer_id, patch)
        except files.ChatFileUnreadable:
            log.warning("chat file missing or unreadable while finishing an answer")

    def _finish(self, state: RunState, status: str, error: dict[str, Any] | None) -> None:
        with self._maker() as db:
            chat = db.get(Chat, state.chat_id)
            run = db.get(ChatRun, state.id)
            if chat is not None:
                self._finish_file(
                    db, chat, state.answer_id, status, "".join(state.text), state.usage, error
                )
                quiet_update(
                    db, chat.id, generating=False, unseen_answer=True, updated_at=now_iso()
                )
            if run is not None:
                run.status = status
                run.ended_at = now_iso()
                run.error_category = error["category"] if error else None
            db.commit()
