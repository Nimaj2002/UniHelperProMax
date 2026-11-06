"""014 chat runs: active runs, the event stream, Stop (contracts/chat-stream.md)."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import Annotated, Any

from fastapi import APIRouter, Header, Query, Request
from fastapi.responses import StreamingResponse

from unihelper.api.deps import CurrentUser, DbSession
from unihelper.api.errors import not_found
from unihelper.api.v1.chats import runs_of
from unihelper.chat import files
from unihelper.chat.runs import RunState, chat_location
from unihelper.models import Chat, ChatRun, SessionFolder
from unihelper.schemas.chat import ChatRunOut

router = APIRouter(tags=["chat"])


def _out(state: RunState) -> dict[str, Any]:
    return {
        "id": state.id,
        "chat_id": state.chat_id,
        "session_key": state.session_key,
        "answer_id": state.answer_id,
        "status": state.status,
        "teacher": state.splitter is not None,
    }


def _row(db: Any, user_id: str, run_id: str) -> ChatRun:
    run = db.get(ChatRun, run_id)
    if run is None or run.user_id != user_id:
        raise not_found("Run")
    return run  # type: ignore[no-any-return]


@router.get("/chat-runs/active", response_model=list[ChatRunOut])
def active(request: Request, user: CurrentUser) -> Any:
    """The registry is the truth for what is generating now (rows of a crashed server are
    marked interrupted at startup)."""
    return [_out(s) for s in runs_of(request).active(user.id)]


def _session_key(db: Any, chat_id: str) -> str:
    chat = db.get(Chat, chat_id)
    folder = db.get(SessionFolder, chat.session_folder_id) if chat is not None else None
    return folder.session_key if folder is not None else ""


def _frame(event_id: int | None, name: str, data: dict[str, Any]) -> bytes:
    head = f"id: {event_id}\n" if event_id is not None else ""
    return f"{head}event: {name}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n".encode()


@router.get("/chat-runs/{run_id}/events")
async def events(
    run_id: str,
    request: Request,
    user: CurrentUser,
    db: DbSession,
    last_event_id: Annotated[int | None, Header(alias="Last-Event-ID")] = None,
    last_event_query: Annotated[int | None, Query(alias="lastEventId", ge=0)] = None,
) -> StreamingResponse:
    """`Last-Event-ID` (EventSource's own reconnect) or `?lastEventId=` (a new EventSource after
    a hard disconnect) — replay starts after it."""
    if last_event_id is None:
        last_event_id = last_event_query
    run = _row(db, user.id, run_id)
    runs = runs_of(request)
    state = runs.get(run_id)
    snapshot: dict[str, Any] | None = None
    if state is None:  # the buffer expired (or the server restarted): one snapshot event
        chat = db.get(Chat, run.chat_id)
        text = ""
        segments: list[dict[str, Any]] = []
        if chat is not None:
            _user, folder = chat_location(db, chat)
            try:
                doc = files.read(request.app.state.storage, folder, chat.stem)
                answer = files.find_answer(doc, run.answer_id)
                text = answer.get("text", "") if answer else ""
                if answer and chat.kind != "chat":  # 022: never raw blocks (answer keys)
                    from unihelper.teacher.view import segments as teacher_segments

                    segments = teacher_segments(doc, answer)
            except files.ChatFileUnreadable:
                text = ""
        if chat is not None and chat.kind != "chat":
            snapshot = {"segments": segments, "status": run.status}
        else:
            snapshot = {"text": text, "status": run.status}
    db.close()  # the stream may last minutes: don't hold a connection

    async def body() -> AsyncIterator[bytes]:
        if snapshot is not None or state is None:
            yield _frame(1, "snapshot", snapshot or {"text": "", "status": run.status})
            return
        async for event in runs.subscribe(state, last_event_id or 0):
            if event is None:
                yield b": keepalive\n\n"
            else:
                yield _frame(event.id, event.name, event.data)

    return StreamingResponse(
        body(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/chat-runs/{run_id}/stop", response_model=ChatRunOut)
async def stop(run_id: str, request: Request, user: CurrentUser, db: DbSession) -> Any:
    run = _row(db, user.id, run_id)
    state = await runs_of(request).stop(run_id)
    if state is not None:
        return _out(state)
    db.refresh(run)
    chat = db.get(Chat, run.chat_id)
    return {
        "teacher": chat is not None and chat.kind != "chat",
        "id": run.id,
        "chat_id": run.chat_id,
        "session_key": _session_key(db, run.chat_id),
        "answer_id": run.answer_id,
        "status": run.status,
    }
