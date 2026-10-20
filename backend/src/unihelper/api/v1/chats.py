"""014 chats of a session or event: sending, history, drafts, uploads (contracts/openapi.yaml)."""

from __future__ import annotations

from typing import Annotated, Any, Literal

import anyio
from fastapi import APIRouter, Depends, Query, Request, Response
from fastapi.responses import FileResponse

from unihelper.ai.limits import MAX_UPLOAD
from unihelper.api import uploads
from unihelper.api.deps import CurrentUser, DbSession, IfMatch, Storage, check_version
from unihelper.chat.runs import RunRegistry
from unihelper.schemas.chat import (
    AppendResult,
    AppendTarget,
    ChatDraftIo,
    ChatOut,
    ChatSummary,
    ChatUpdate,
    ChatUploadOut,
    PreflightRequest,
    PreflightResult,
    Regenerate,
    Selection,
    SendMessage,
    SendResult,
)
from unihelper.services import chat_service as svc
from unihelper.services import chat_upload_service
from unihelper.services import session_folder_service as sfs

router = APIRouter(tags=["chat"])


def runs_of(request: Request) -> RunRegistry:
    runs: RunRegistry = request.app.state.chat_runs
    return runs


def chat_deps(request: Request, user: CurrentUser, db: DbSession) -> svc.Deps:
    return svc.Deps(
        db, request.app.state.storage, request.app.state.secrets, runs_of(request), user
    )


ChatDeps = Annotated[svc.Deps, Depends(chat_deps)]


@router.get("/sessions/{session_key}/chats", response_model=list[ChatSummary])
def list_chats(
    session_key: str,
    deps: ChatDeps,
    q: Annotated[str | None, Query(max_length=200)] = None,
    in_: Annotated[Literal["title", "text"], Query(alias="in")] = "title",
) -> Any:
    return svc.list_chats(deps, session_key, q, in_)


@router.post("/sessions/{session_key}/chats", response_model=SendResult, status_code=201)
def start_chat(session_key: str, body: SendMessage, deps: ChatDeps) -> Any:
    return svc.start_chat(deps, session_key, body)


@router.post("/chats/preflight", response_model=PreflightResult)
def preflight(body: PreflightRequest, deps: ChatDeps) -> Any:
    return svc.preflight(deps, body)


@router.get("/chats/{chat_id}", response_model=ChatOut)
def get_chat(chat_id: str, deps: ChatDeps) -> Any:
    return svc.view(deps, svc.get_chat(deps.db, deps.user, chat_id))


@router.patch("/chats/{chat_id}", response_model=ChatOut)
def update_chat(chat_id: str, body: ChatUpdate, version: IfMatch, deps: ChatDeps) -> Any:
    return svc.update(deps, chat_id, version, body)


@router.delete("/chats/{chat_id}", status_code=204)
async def delete_chat(chat_id: str, version: IfMatch, deps: ChatDeps) -> Response:
    chat = svc.get_chat(deps.db, deps.user, chat_id)
    check_version(version, chat.version)
    active = deps.runs.active_for_chat(chat.id)
    if active is not None:  # the partial answer is saved first
        await deps.runs.stop(active.id)
        deps.db.refresh(chat)
    svc.delete(deps, chat)
    return Response(status_code=204)


@router.post("/chats/{chat_id}/restore", response_model=ChatSummary)
def restore_chat(chat_id: str, deps: ChatDeps) -> Any:
    return svc.restore(deps, chat_id)


@router.get("/sessions/{session_key}/chat-drafts", response_model=list[ChatDraftIo])
def get_drafts(session_key: str, deps: ChatDeps) -> Any:
    return svc.get_drafts(deps, session_key)


@router.put("/sessions/{session_key}/chat-drafts", response_model=ChatDraftIo)
def put_draft(session_key: str, body: ChatDraftIo, deps: ChatDeps) -> Any:
    return svc.put_draft(deps, session_key, body)


@router.post("/chats/{chat_id}/messages", response_model=SendResult, status_code=202)
def send_message(chat_id: str, body: SendMessage, deps: ChatDeps) -> Any:
    return svc.send(deps, chat_id, body)


@router.post(
    "/chats/{chat_id}/turns/{turn_id}/regenerate", response_model=SendResult, status_code=202
)
def regenerate(chat_id: str, turn_id: str, deps: ChatDeps, body: Regenerate | None = None) -> Any:
    return svc.regenerate(deps, chat_id, turn_id, body.model if body else None)


@router.post("/chats/{chat_id}/turns/{turn_id}/edit", response_model=SendResult, status_code=202)
def edit_last(chat_id: str, turn_id: str, body: SendMessage, deps: ChatDeps) -> Any:
    return svc.edit(deps, chat_id, turn_id, body)


@router.post("/chats/{chat_id}/answers/{answer_id}/append-to-note", response_model=AppendResult)
def append_to_note(chat_id: str, answer_id: str, body: AppendTarget, deps: ChatDeps) -> Any:
    return svc.append_answer(deps, chat_id, answer_id, body)


@router.put("/chats/{chat_id}/turns/{turn_id}/selection", response_model=ChatOut)
def select(chat_id: str, turn_id: str, body: Selection, deps: ChatDeps) -> Any:
    return svc.select_versions(deps, chat_id, turn_id, body.version, body.answer)


@router.post("/chats/{chat_id}/seen", status_code=204)
def seen(chat_id: str, user: CurrentUser, db: DbSession) -> None:
    svc.mark_seen(db, user, chat_id)


@router.post("/sessions/{session_key}/chat-uploads", response_model=ChatUploadOut, status_code=201)
async def upload(
    session_key: str,
    request: Request,
    user: CurrentUser,
    db: DbSession,
    storage: Storage,
    file_name: Annotated[str, Query(alias="fileName", min_length=1, max_length=255)],
) -> Any:
    """A picture, PDF or audio file from the device, streamed into the session's chats folder
    (raw body, like document imports). Its type is read from its first bytes."""
    length = uploads.declared_length(request, MAX_UPLOAD, "A chat attachment")
    await anyio.to_thread.run_sync(sfs.resolve, db, user, session_key)  # 404 before the body
    staged = await uploads.receive_upload(request, storage, length, MAX_UPLOAD, "A chat attachment")
    try:
        return await anyio.to_thread.run_sync(
            chat_upload_service.store, db, storage, user, session_key, staged, file_name
        )
    except BaseException:
        await anyio.to_thread.run_sync(storage.discard_upload, staged.path)
        raise


@router.get("/chat-files/{upload_id}", response_class=FileResponse)
def chat_file(upload_id: str, user: CurrentUser, db: DbSession, storage: Storage) -> Any:
    row, path = chat_upload_service.file_of(db, storage, user, upload_id)
    disposition = "inline" if row.kind == "image" else "attachment"
    return FileResponse(
        path, media_type=row.mime, filename=row.original_name, content_disposition_type=disposition
    )
