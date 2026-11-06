"""Lesson and practice chats (022): starting, messages, answers, disputes, hints, reveal.

Teacher chats are chats (research R1): this service reuses the AI chat's model checks, context
snapshots, drafts and run launch, and adds the teacher's request (system prompt, earlier replies
with question ids) and the block splitter for its runs.
"""

from __future__ import annotations

import functools
from typing import Any

from sqlalchemy import select

from unihelper.ai.base import ChatRequest, NeutralMessage, Part, Text
from unihelper.api.errors import ApiError
from unihelper.chat import context as chat_context
from unihelper.chat import files
from unihelper.chat.runs import quiet_update
from unihelper.domain.teacher_blocks import BlockSplitter
from unihelper.models import AiEndpoint, AiModel, Chat, SessionFolder
from unihelper.models.base import new_id, now_iso
from unihelper.models.chat import TEACHER_KINDS
from unihelper.schemas.chat import SendMessage
from unihelper.schemas.teacher import MAX_IDEA_SET
from unihelper.services import ai_settings_service, knowledge_graph_service
from unihelper.services import chat_service as cs
from unihelper.services import session_folder_service as sfs
from unihelper.teacher import prompts, view
from unihelper.teacher.turns import (
    answers_text,
    dispute_text,
    find_question,
    grade_choice,
    hint_text,
    retry_text,
)

Deps = cs.Deps


def get(deps: Deps, chat_id: str, include_deleted: bool = False) -> Chat:
    return cs.get_chat(deps.db, deps.user, chat_id, include_deleted, kinds=TEACHER_KINDS)


# ───────────────────────────── request and launch ─────────────────────────────


def _request(
    deps: Deps, chat: Chat, doc: dict[str, Any], turn_index: int, model: AiModel, parts: list[Part]
) -> ChatRequest:
    messages: list[NeutralMessage] = []
    for turn in doc["turns"][:turn_index]:
        version = files.selected_version(turn)
        messages.append(NeutralMessage("user", [Text(version.get("text", ""))]))
        answer = files.selected_answer(version)
        if answer and answer.get("text") and answer.get("status") != "failed":
            messages.append(NeutralMessage("assistant", [Text(view.model_text(doc, answer))]))
    version = files.selected_version(doc["turns"][turn_index])
    current: list[Part] = [*parts]
    if version.get("text"):
        current.append(Text(version["text"]))
    if not current:
        raise ApiError(422, "empty_message", "Type a message or attach something to send.")
    messages.append(NeutralMessage("user", current))
    teacher = view.teacher_of(doc)
    ideas, links = knowledge_graph_service.prompt_ideas(deps.db, deps.user, teacher["ideaSet"])
    system = prompts.system_prompt(
        chat.kind,
        teacher.get("topic"),
        ideas,
        links,
        ai_settings_service.instructions(deps.db, deps.user.id),
    )
    return ChatRequest(
        model_id=model.model_id,
        messages=messages,
        system=system,
        max_tokens=chat_context.max_tokens(model),
    )


def _launch(
    deps: Deps,
    chat: Chat,
    doc: dict[str, Any],
    answer: dict[str, Any],
    model: AiModel,
    endpoint: AiEndpoint,
    folder: list[str],
    parts: list[Part],
    graded: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    turn_index = len(doc["turns"]) - 1

    def configure(state: Any) -> None:
        state.splitter = BlockSplitter(state.answer_id)
        state.on_piece = functools.partial(view.on_piece, deps.storage)

    chat.unanswered_count = view.unanswered(doc)
    if chat.kind == "lesson":  # the graph worker picks it up once idle (FR-029)
        chat.kg_status = "pending"
    result = cs._launch(
        deps,
        chat,
        doc,
        turn_index,
        answer,
        model,
        endpoint,
        folder,
        parts,
        build_request=lambda: _request(deps, chat, doc, turn_index, model, parts),
        configure=configure,
    )
    return {**result, "chat": view.summary(chat), "graded": graded or []}


def _version(
    deps: Deps,
    text: str,
    answer: dict[str, Any],
    action: str | None = None,
    target: str | None = None,
) -> dict[str, Any]:
    return {
        "id": new_id(),
        "text": text,
        "createdAt": cs._now(deps.user),
        "action": action,
        "target": target,
        "attachments": [],
        "noteSnapshots": [],
        "selectedAnswer": 0,
        "answers": [answer],
    }


def _turn(
    deps: Deps, chat: Chat, model_ref: Any, text: str, attachments: list[Any]
) -> dict[str, Any]:
    """A message the student typed: append it and start the teacher's reply."""
    cs._no_active_run(deps, chat)
    model, endpoint = cs._model(deps.db, deps.user, model_ref.endpoint_id, model_ref.model_id)
    cs._privacy(endpoint)
    with files.chat_lock(chat.id):
        folder, doc = cs._load(deps, chat)
        view.teacher_of(doc)
        answer = cs._answer(deps.user, model, endpoint)
        version = _version(deps, text, answer)
        version["attachments"] = cs._merge_context(doc, attachments)
        doc["turns"].append({"id": new_id(), "selected": 0, "versions": [version]})
        parts = cs._context_parts(deps, folder, chat, doc, version, model, endpoint)
        folder_row = deps.db.get(SessionFolder, chat.session_folder_id)
        assert folder_row is not None
        cs._delete_draft(deps.db, deps.user, folder_row, chat.id)
        return _launch(deps, chat, doc, answer, model, endpoint, folder, parts)


def graded_submissions(doc: dict[str, Any], questions: list[dict[str, Any]] | None) -> list[Any]:
    out = []
    for q in questions or []:
        sub = q["submission"]
        item = {"questionId": q["id"], "confidence": sub.get("confidence")}
        item.update({k: sub[k] for k in ("choice", "text", "dontKnow") if sub.get(k) is not None})
        item["thinking"] = sub.get("thinking", "")
        out.append(item)
    return out


# ───────────────────────────── starting and sending ─────────────────────────────


def start(deps: Deps, session_key: str, body: Any) -> dict[str, Any]:
    cs._check_message(body)
    model, endpoint = cs._model(deps.db, deps.user, body.model.endpoint_id, body.model.model_id)
    cs._privacy(endpoint)
    deps.runs.check_capacity(deps.user.id)
    r = sfs.resolve(deps.db, deps.user, session_key)
    if body.idea_ids is not None:
        idea_ids = knowledge_graph_service.check_idea_set(deps.db, deps.user, body.idea_ids)
    else:
        idea_ids = knowledge_graph_service.default_set(
            deps.db, deps.user, r.course.id if r.course is not None else None
        )
    folder_row = sfs.get_or_create_folder(deps.db, deps.storage, deps.user, r)
    folder = sfs.folder_parts(deps.user, r, folder_row)
    taken = list(deps.db.scalars(select(Chat.stem).where(Chat.session_folder_id == folder_row.id)))
    default = "New lesson" if body.kind == "lesson" else "New practice"
    title = files.title_from(body.text) if body.text.strip() else default
    stem = files.new_stem(cs._local_now(deps.user), title, taken)
    while deps.storage.exists(files.json_parts(folder, stem)):  # a file left on disk is kept
        taken.append(stem)
        stem = files.new_stem(cs._local_now(deps.user), title, taken)
    chat = Chat(
        id=new_id(),
        user_id=deps.user.id,
        session_folder_id=folder_row.id,
        stem=stem,
        title=title,
        kind=body.kind,
        model_label=f"{endpoint.name} · {model.display_name}",
    )
    deps.db.add(chat)
    deps.db.flush()
    answer = cs._answer(deps.user, model, endpoint)
    version = _version(deps, body.text, answer)
    doc: dict[str, Any] = {
        "format": files.FORMAT,
        "id": chat.id,
        "title": title,
        "createdAt": cs._now(deps.user),
        "updatedAt": cs._now(deps.user),
        "context": [],
        "teacher": {
            "kind": body.kind,
            "topic": (body.topic or "").strip() or None,
            "ideaSet": idea_ids,
            "questions": [],
            "plans": [],
            "graph": {"processedTurns": 0, "status": None},
        },
        "turns": [{"id": new_id(), "selected": 0, "versions": [version]}],
    }
    version["attachments"] = cs._merge_context(doc, body.attachments)
    parts = cs._context_parts(deps, folder, chat, doc, version, model, endpoint)
    from unihelper.db.engine import on_rollback

    on_rollback(deps.db, lambda: cs._remove_files(deps.storage, folder, stem))
    cs._delete_draft(deps.db, deps.user, folder_row, f"teacher:{body.kind}")
    return _launch(deps, chat, doc, answer, model, endpoint, folder, parts)


def send(deps: Deps, chat_id: str, body: SendMessage) -> dict[str, Any]:
    chat = get(deps, chat_id)
    cs._check_message(body)
    return _turn(deps, chat, body.model, body.text, body.attachments)


# ───────────────────────────── answers, disputes, hints ─────────────────────────────


def submit_answers(deps: Deps, chat_id: str, body: Any) -> dict[str, Any]:
    chat = get(deps, chat_id)
    at = now_iso()
    seen: set[str] = set()

    def change(doc: dict[str, Any]) -> list[dict[str, Any]]:
        pairs = []
        for item in body.answers:
            question = find_question(doc, item.question_id)
            if question is None:
                raise ApiError(404, "not_found", "This question doesn't exist.")
            if question.get("submission") or item.question_id in seen:
                raise ApiError(409, "already_answered", "This question was already answered.")
            seen.add(item.question_id)
            if item.dont_know:
                if item.choice is not None or item.text is not None:
                    raise ApiError(422, "wrong_answer_kind", "\"I don't know\" has no answer.")
            elif question["kind"] == "choice":
                if item.choice is None or item.text is not None:
                    raise ApiError(422, "wrong_answer_kind", "Choose one of the options.")
                if item.choice >= len(question["options"]):
                    raise ApiError(422, "option_out_of_range", "That option doesn't exist.")
            elif item.text is None or item.choice is not None:
                raise ApiError(422, "wrong_answer_kind", "Write an answer.")
            submission = {
                "choice": item.choice,
                "text": item.text,
                "confidence": item.confidence,
                "dontKnow": item.dont_know or None,
                "thinking": item.thinking,
                "submittedAt": at,
            }
            question["submission"] = {k: v for k, v in submission.items() if v is not None}
            question["submission"].setdefault("confidence", None)
            if item.dont_know:  # nothing to grade: the app marks it incorrect at once
                grade = {"grade": "incorrect", "feedback": "", "by": "server", "at": at}
                question["grades"] = [grade]
            elif item.choice is not None:  # multiple choice: graded by the app (R4)
                question["grades"] = [grade_choice(question, item.choice, at)]
            pairs.append(question)
        return pairs

    # the model reads the answers with their app grades: build the text after `change`
    holder: dict[str, str] = {}

    def change_and_text(doc: dict[str, Any]) -> list[dict[str, Any]]:
        questions = change(doc)
        holder["text"] = answers_text([(q, q["submission"]) for q in questions])
        return questions

    return _turn_text_after(deps, chat, body.model, "answers", None, change_and_text, holder)


def _turn_text_after(
    deps: Deps,
    chat: Chat,
    model_ref: Any,
    action: str,
    target: str | None,
    change: Any,
    holder: dict[str, str],
) -> dict[str, Any]:
    """`_turn` whose text is only known once `change` ran on the document."""
    cs._no_active_run(deps, chat)
    model, endpoint = cs._model(deps.db, deps.user, model_ref.endpoint_id, model_ref.model_id)
    cs._privacy(endpoint)
    with files.chat_lock(chat.id):
        folder, doc = cs._load(deps, chat)
        view.teacher_of(doc)
        graded = change(doc)
        answer = cs._answer(deps.user, model, endpoint)
        version = _version(deps, holder["text"], answer, action, target)
        if action == "answers":
            version["submissions"] = graded_submissions(doc, graded)
        doc["turns"].append({"id": new_id(), "selected": 0, "versions": [version]})
        out_graded = [view.question_out(q) for q in graded or [] if q.get("grades")]
        return _launch(deps, chat, doc, answer, model, endpoint, folder, [], out_graded)


def dispute(deps: Deps, chat_id: str, question_id: str, body: Any) -> dict[str, Any]:
    chat = get(deps, chat_id)
    holder: dict[str, str] = {}

    def change(doc: dict[str, Any]) -> None:
        question = _question(doc, question_id)
        if not question.get("submission"):
            raise ApiError(409, "not_answered", "Answer this question first.")
        holder["text"] = dispute_text(question, body.reason)
        question["disputeReason"] = body.reason.strip()

    return _turn_text_after(deps, chat, body.model, "dispute", question_id, change, holder)


def hint(deps: Deps, chat_id: str, question_id: str, body: Any) -> dict[str, Any]:
    chat = get(deps, chat_id)
    holder: dict[str, str] = {}

    def change(doc: dict[str, Any]) -> None:
        question = _question(doc, question_id)
        if not question.get("practice"):
            raise ApiError(409, "not_practice", "Hints are for practice problems.")
        if question.get("submission"):
            raise ApiError(409, "already_answered", "This problem was already answered.")
        holder["text"] = hint_text(question, body.attempt)

    return _turn_text_after(deps, chat, body.model, "hint", question_id, change, holder)


def retry_malformed(deps: Deps, chat_id: str, segment_id: str, body: Any) -> dict[str, Any]:
    chat = get(deps, chat_id)
    holder = {"text": retry_text()}

    def change(doc: dict[str, Any]) -> None:
        for turn in doc["turns"]:
            answer = files.selected_answer(files.selected_version(turn))
            if answer and any(s.get("id") == segment_id for s in view.segments(doc, answer)):
                return
        raise ApiError(404, "not_found", "This question doesn't exist.")

    return _turn_text_after(deps, chat, body.model, "retry", segment_id, change, holder)


def reveal(deps: Deps, chat_id: str, question_id: str) -> dict[str, Any]:
    chat = get(deps, chat_id)
    with files.chat_lock(chat.id):
        folder, doc = cs._load(deps, chat)
        question = _question(doc, question_id)
        if not question.get("practice"):
            raise ApiError(409, "not_practice", "Only practice solutions can be revealed.")
        if not question.get("revealed"):
            question["revealed"] = True
            doc["updatedAt"] = now_iso()
            digest = files.write(deps.storage, folder, chat.stem, doc, cs.label_of(deps.db, chat))
            quiet_update(deps.db, chat.id, file_hash=digest)
        return view.question_out(question)


def _question(doc: dict[str, Any], question_id: str) -> dict[str, Any]:
    question = find_question(doc, question_id)
    if question is None:
        raise ApiError(404, "not_found", "This question doesn't exist.")
    return question


# ───────────────────────────── reading, listing, renaming ─────────────────────────────


def list_chats(deps: Deps, session_key: str) -> list[dict[str, Any]]:
    folder_row = cs._folder_of(deps.db, deps.user, session_key)
    if folder_row is None:
        sfs.resolve(deps.db, deps.user, session_key)  # 404 for an unknown session
        return []
    rows = deps.db.scalars(
        select(Chat)
        .where(
            Chat.session_folder_id == folder_row.id,
            Chat.deleted_at.is_(None),
            Chat.kind.in_(TEACHER_KINDS),
        )
        .order_by(Chat.updated_at.desc(), Chat.id.desc())
    )
    return [view.summary(c) for c in rows]


def read(deps: Deps, chat_id: str) -> dict[str, Any]:
    chat = get(deps, chat_id)
    folder, doc = cs._load(deps, chat)
    files.ensure_transcript(deps.storage, folder, chat.stem, doc, cs.label_of(deps.db, chat))
    teacher = view.teacher_of(doc)
    run_ids = {s.answer_id: s.id for s in deps.runs.active(deps.user.id) if s.chat_id == chat.id}
    ref = doc.get("model") or {}
    model = None
    if ref.get("modelId"):
        model = {
            "endpointId": ref["endpointId"],
            "modelId": ref["modelId"],
            "label": ref.get("label", chat.model_label),
            "available": chat.model_ref_id is not None and ref["modelId"] == chat.model_ref_id,
        }
    return {
        "chat": view.summary(chat),
        "topic": teacher.get("topic"),
        "model": model,
        "turns": view.turns_out(doc, run_ids),
        "questions": [view.question_out(q) for q in teacher["questions"]],
        "plans": [{k: v for k, v in p.items()} for p in teacher["plans"]],
        "ideaSet": knowledge_graph_service.summaries(deps.db, deps.user, teacher["ideaSet"]),
        "graph": view.graph_status(chat, doc),
    }


def rename(deps: Deps, chat_id: str, version: int, title: str) -> dict[str, Any]:
    from unihelper.api.deps import check_version

    chat = get(deps, chat_id)
    check_version(version, chat.version)
    cs.rename(deps, chat, title)
    return view.summary(chat)


# ───────────────────────────── idea set and graph ─────────────────────────────


def set_idea_set(deps: Deps, chat_id: str, idea_ids: list[str]) -> list[dict[str, Any]]:
    chat = get(deps, chat_id)
    if len(set(idea_ids)) > MAX_IDEA_SET:
        raise ApiError(422, "too_many_ideas", "A chat can start from at most 30 ideas.")
    ids = knowledge_graph_service.check_idea_set(deps.db, deps.user, idea_ids)
    with files.chat_lock(chat.id):
        folder, doc = cs._load(deps, chat)
        view.teacher_of(doc)["ideaSet"] = ids
        doc["updatedAt"] = now_iso()
        digest = files.write(deps.storage, folder, chat.stem, doc, cs.label_of(deps.db, chat))
        quiet_update(deps.db, chat.id, file_hash=digest)
    return knowledge_graph_service.summaries(deps.db, deps.user, ids)
