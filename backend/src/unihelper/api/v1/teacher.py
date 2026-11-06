"""Lesson and practice chats (022 contracts/openapi.yaml). Teacher chats are chats: delete,
restore, seen, drafts, uploads and run events use the 014 routes."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Request

from unihelper.api.deps import IfMatch
from unihelper.api.errors import ApiError
from unihelper.api.v1.chats import ChatDeps
from unihelper.schemas.chat import SendMessage
from unihelper.schemas.teacher import (
    Dispute,
    GraphImpact,
    GraphStatus,
    HintRequest,
    IdeaSetIn,
    IdeaSummary,
    Instructions,
    ModelOnly,
    QuestionOut,
    StartTeacherChat,
    SubmitAnswers,
    TeacherChatOut,
    TeacherChatSummary,
    TeacherChatUpdate,
    TeacherSendResult,
)
from unihelper.services import chat_service as cs
from unihelper.services import knowledge_graph_service as kg
from unihelper.services import teacher_service as svc
from unihelper.teacher import prompts, view

router = APIRouter(tags=["teacher"])

# `response_model_exclude_unset`: a question's key and explanation are left out (not null)
# while they are withheld (FR-018, FR-041)


@router.get("/sessions/{session_key}/teacher-chats", response_model=list[TeacherChatSummary])
def list_teacher_chats(session_key: str, deps: ChatDeps) -> Any:
    return svc.list_chats(deps, session_key)


@router.post(
    "/sessions/{session_key}/teacher-chats",
    response_model=TeacherSendResult,
    status_code=201,
    response_model_exclude_unset=True,
)
def start_teacher_chat(session_key: str, body: StartTeacherChat, deps: ChatDeps) -> Any:
    return svc.start(deps, session_key, body)


@router.get(
    "/teacher-chats/{chat_id}", response_model=TeacherChatOut, response_model_exclude_unset=True
)
def get_teacher_chat(chat_id: str, deps: ChatDeps) -> Any:
    return svc.read(deps, chat_id)


@router.patch("/teacher-chats/{chat_id}", response_model=TeacherChatSummary)
def rename_teacher_chat(
    chat_id: str, body: TeacherChatUpdate, version: IfMatch, deps: ChatDeps
) -> Any:
    return svc.rename(deps, chat_id, version, body.title)


@router.post(
    "/teacher-chats/{chat_id}/messages",
    response_model=TeacherSendResult,
    status_code=202,
    response_model_exclude_unset=True,
)
def send_teacher_message(chat_id: str, body: SendMessage, deps: ChatDeps) -> Any:
    return svc.send(deps, chat_id, body)


@router.post(
    "/teacher-chats/{chat_id}/answers",
    response_model=TeacherSendResult,
    status_code=202,
    response_model_exclude_unset=True,
)
def submit_answers(chat_id: str, body: SubmitAnswers, deps: ChatDeps) -> Any:
    return svc.submit_answers(deps, chat_id, body)


@router.post(
    "/teacher-chats/{chat_id}/questions/{question_id}/dispute",
    response_model=TeacherSendResult,
    status_code=202,
    response_model_exclude_unset=True,
)
def dispute_grade(chat_id: str, question_id: str, body: Dispute, deps: ChatDeps) -> Any:
    return svc.dispute(deps, chat_id, question_id, body)


@router.post(
    "/teacher-chats/{chat_id}/questions/{question_id}/hint",
    response_model=TeacherSendResult,
    status_code=202,
    response_model_exclude_unset=True,
)
def ask_hint(chat_id: str, question_id: str, body: HintRequest, deps: ChatDeps) -> Any:
    return svc.hint(deps, chat_id, question_id, body)


@router.post(
    "/teacher-chats/{chat_id}/questions/{question_id}/reveal",
    response_model=QuestionOut,
    response_model_exclude_unset=True,
)
def reveal_solution(chat_id: str, question_id: str, deps: ChatDeps) -> Any:
    return svc.reveal(deps, chat_id, question_id)


@router.post(
    "/teacher-chats/{chat_id}/malformed/{segment_id}/retry",
    response_model=TeacherSendResult,
    status_code=202,
    response_model_exclude_unset=True,
)
def retry_question(chat_id: str, segment_id: str, body: ModelOnly, deps: ChatDeps) -> Any:
    return svc.retry_malformed(deps, chat_id, segment_id, body)


@router.put("/teacher-chats/{chat_id}/idea-set", response_model=list[IdeaSummary])
def put_idea_set(chat_id: str, body: IdeaSetIn, deps: ChatDeps) -> Any:
    return svc.set_idea_set(deps, chat_id, body.idea_ids)


@router.post("/teacher-chats/{chat_id}/graph-update", response_model=GraphStatus, status_code=202)
def update_graph(chat_id: str, request: Request, deps: ChatDeps) -> Any:
    chat = svc.get(deps, chat_id)
    if chat.kind != "lesson":
        raise ApiError(409, "not_lesson", "Only lessons add ideas to the knowledge graph.")
    _folder, doc = cs._load(deps, chat)
    if chat.kg_processed_turns < len(doc.get("turns", [])) and chat.kg_status != "running":
        chat.kg_status = "pending"
        deps.db.flush()
    request.app.state.graph_worker.request(chat.id)
    return view.graph_status(chat, doc)


@router.get("/teacher-chats/{chat_id}/graph-impact", response_model=GraphImpact)
def graph_impact(chat_id: str, deps: ChatDeps) -> Any:
    chat = svc.get(deps, chat_id)
    return {"ideas": kg.impact_of_chats(deps.db, deps.user, {chat.id})}


@router.get("/teacher/instructions", response_model=Instructions)
def instructions() -> Any:
    return {
        "lesson": f"{prompts.LESSON}\n{prompts.BLOCKS}",
        "practice": f"{prompts.PRACTICE}\n{prompts.BLOCKS}",
        "extraction": prompts.EXTRACTION,
    }
