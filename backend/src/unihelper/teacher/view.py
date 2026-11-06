"""Teacher chats as the client sees them, and blocks saved while a reply streams (022 R3).

The chat file keeps each reply's raw text, `uh-*` blocks included; segments are derived on read
with the same splitter that ran during streaming, so ids match. A question's `key` and
`explanation` leave the server only once the question is answered or revealed.
"""

from __future__ import annotations

import json
from typing import Any

from sqlalchemy.orm import Session

from unihelper.chat import files
from unihelper.domain.teacher_blocks import Block, Malformed, Prose, segments_of
from unihelper.models import Chat
from unihelper.models.base import now_iso
from unihelper.storage.storage_service import StorageService
from unihelper.teacher.turns import (
    apply_grade,
    confidence_of,
    confidence_text,
    find_question,
    status_of,
)

PLAN_MARKER = "*Plan updated.*"


def teacher_of(doc: dict[str, Any]) -> dict[str, Any]:
    teacher: dict[str, Any] = doc.setdefault("teacher", {})
    for key in ("questions", "plans", "ideaSet"):
        teacher.setdefault(key, [])
    teacher.setdefault("graph", {"processedTurns": 0, "status": None})
    return teacher


# ───────────────────────────── questions ─────────────────────────────


def question_out(question: dict[str, Any]) -> dict[str, Any]:
    status = status_of(question)
    out: dict[str, Any] = {
        "id": question["id"],
        "answerId": question["answerId"],
        "kind": question["kind"],
        "title": question["title"],
        "prompt": question["prompt"],
        "practice": bool(question.get("practice")),
        "status": status,
        "revealed": bool(question.get("revealed")),
        "submission": _submission_out(question.get("submission")),
        "grades": [_grade_out(g) for g in question.get("grades", [])],
        "hints": [
            {"text": h["text"], "createdAt": h["createdAt"]} for h in question.get("hints", [])
        ],
    }
    if question["kind"] == "choice":
        out["options"] = question["options"]
    if status != "unanswered" or question.get("revealed"):
        out["key"] = question["key"]
        if question.get("explanation"):
            out["explanation"] = question["explanation"]
    return out


def _submission_out(submission: dict[str, Any] | None) -> dict[str, Any] | None:
    if not submission:
        return None
    out = {k: submission[k] for k in ("choice", "text") if submission.get(k) is not None}
    return {
        **out,
        "confidence": confidence_of(submission),
        "dontKnow": bool(submission.get("dontKnow")),
        "thinking": submission.get("thinking", ""),
        "submittedAt": submission["submittedAt"],
    }


def _grade_out(grade: dict[str, Any]) -> dict[str, Any]:
    out = {k: grade[k] for k in ("grade", "by", "at")}
    out["feedback"] = grade.get("feedback", "")
    if grade.get("disputeReason"):
        out["disputeReason"] = grade["disputeReason"]
    return out


def unanswered(doc: dict[str, Any]) -> int:
    return sum(1 for q in teacher_of(doc)["questions"] if status_of(q) == "unanswered")


# ───────────────────────────── streaming: saving blocks ─────────────────────────────


def apply_block(
    doc: dict[str, Any], answer_id: str, piece: Block | Malformed, practice: bool
) -> tuple[str, dict[str, Any]] | None:
    """Store one block of reply `answer_id`; the event to announce it, or None."""
    teacher = teacher_of(doc)
    at = now_iso()
    if isinstance(piece, Malformed):
        return "malformed", {"id": piece.id, "reason": piece.reason}
    payload = piece.payload
    if piece.type == "question":
        question = {
            "id": f"q{len(teacher['questions']) + 1}",
            "answerId": answer_id,
            "index": piece.index,
            "practice": practice,
            **payload,
            "revealed": False,
            "hints": [],
            "submission": None,
            "grades": [],
        }
        teacher["questions"].append(question)
        return "question", question_out(question)
    if piece.type == "grade":
        grade = apply_grade(doc, payload, answer_id, at)
        if grade is None:
            return None
        return "grade", {"questionId": payload["question"], **_grade_out(grade)}
    if piece.type == "plan":
        plan = {
            "version": len(teacher["plans"]) + 1,
            "answerId": answer_id,
            "mermaid": payload["mermaid"],
            "current": payload["current"],
            "createdAt": at,
        }
        teacher["plans"].append(plan)
        return "plan", plan
    if piece.type == "hint":
        target = find_question(doc, payload["question"])
        if target is None or not target.get("practice") or target.get("submission"):
            return None
        hint = {"text": payload["text"], "answerId": answer_id, "createdAt": at}
        target.setdefault("hints", []).append(hint)
        return "hint", {"questionId": target["id"], "text": hint["text"], "createdAt": at}
    return None


def on_piece(
    storage: StorageService, db: Session, chat: Chat, state: Any, piece: Any
) -> tuple[str, dict[str, Any]] | None:
    """RunState.on_piece for teacher runs (bound to the storage with functools.partial): save the
    text so far and the block; the event to announce it."""
    from unihelper.chat.runs import chat_location, quiet_update
    from unihelper.services.chat_service import label_of

    _user, folder = chat_location(db, chat)
    with files.chat_lock(chat.id):
        doc = files.read(storage, folder, chat.stem)
        answer = files.find_answer(doc, state.answer_id)
        if answer is not None:
            answer["text"] = "".join(state.text)
            answer["status"] = "streaming"
        out = apply_block(doc, state.answer_id, piece, chat.kind == "practice")
        doc["updatedAt"] = now_iso()
        digest = files.write(storage, folder, chat.stem, doc, label_of(db, chat))
        quiet_update(db, chat.id, file_hash=digest, unanswered_count=unanswered(doc))
    return out


# ───────────────────────────── reading ─────────────────────────────


def segments(doc: dict[str, Any], answer: dict[str, Any]) -> list[dict[str, Any]]:
    by_index = {
        q["index"]: q["id"]
        for q in teacher_of(doc)["questions"]
        if q.get("answerId") == answer.get("id")
    }
    out: list[dict[str, Any]] = []
    for piece in segments_of(answer.get("text", ""), str(answer.get("id", ""))):
        if isinstance(piece, Prose):
            item = {"type": "markdown", "text": piece.text}
        elif isinstance(piece, Malformed):
            item = {"type": "malformed", "id": piece.id, "reason": piece.reason}
        elif piece.type == "question" and piece.index in by_index:
            item = {"type": "question", "questionId": by_index[piece.index]}
        elif piece.type == "plan":
            item = {"type": "markdown", "text": f"\n\n{PLAN_MARKER}\n\n"}
        else:
            continue
        if item["type"] == "markdown" and out and out[-1]["type"] == "markdown":
            out[-1] = {"type": "markdown", "text": out[-1]["text"] + item["text"]}
        else:
            out.append(item)
    return out


def summary(chat: Chat) -> dict[str, Any]:
    return {
        "id": chat.id,
        "kind": chat.kind,
        "title": chat.title,
        "createdAt": chat.created_at,
        "updatedAt": chat.updated_at,
        "generating": chat.generating,
        "unseenAnswer": chat.unseen_answer,
        "unansweredCount": chat.unanswered_count,
        "modelLabel": chat.model_label,
        "version": chat.version,
    }


def graph_status(chat: Chat, doc: dict[str, Any]) -> dict[str, Any]:
    pending = max(0, len(doc.get("turns", [])) - chat.kg_processed_turns)
    out: dict[str, Any] = {
        "status": chat.kg_status if chat.kind == "lesson" else None,
        "pendingTurns": pending if chat.kind == "lesson" else 0,
    }
    if chat.kg_error:
        out["error"] = chat.kg_error
    return out


def turns_out(doc: dict[str, Any], run_ids: dict[str, str]) -> list[dict[str, Any]]:
    out = []
    for turn in doc.get("turns", []):
        version = files.selected_version(turn)
        answer = files.selected_answer(version) or {"id": "", "status": "failed", "text": ""}
        user: dict[str, Any] = {
            "id": version["id"],
            "text": version.get("text", ""),
            "createdAt": version.get("createdAt", ""),
            "action": version.get("action"),
            "target": version.get("target"),
            "attachments": [
                {"kind": a["kind"], "ref": a["ref"]} for a in version.get("attachments", [])
            ],
        }
        answer_out: dict[str, Any] = {
            "id": answer["id"],
            "status": answer.get("status", "completed"),
            "runId": run_ids.get(answer["id"]),
            "endpointLabel": answer.get("endpointLabel", ""),
            "modelLabel": answer.get("modelLabel", ""),
            "locality": answer.get("locality", "local"),
            "segments": segments(doc, answer),
        }
        if answer.get("error"):
            answer_out["error"] = answer["error"]
        out.append({"id": turn["id"], "user": user, "answer": answer_out})
    return out


# ───────────────────────────── the model's view of earlier replies ─────────────────────────


def model_text(doc: dict[str, Any], answer: dict[str, Any]) -> str:
    """An earlier reply as the model reads it again: each question block gains the id the app
    gave it, so later grade and hint blocks can name it."""
    ids = {
        q["index"]: q["id"]
        for q in teacher_of(doc)["questions"]
        if q.get("answerId") == answer.get("id")
    }
    parts: list[str] = []
    for piece in segments_of(answer.get("text", ""), str(answer.get("id", ""))):
        if isinstance(piece, Prose):
            parts.append(piece.text)
        elif isinstance(piece, Block):
            payload = dict(piece.payload)
            if piece.type == "question":
                if piece.index not in ids:
                    continue
                payload = {"id": ids[piece.index], **payload}
                key = payload.pop("key")
                payload["answer" if payload["kind"] == "choice" else "solution"] = key
            body = json.dumps(payload, ensure_ascii=False)
            parts.append(f"```uh-{piece.type}\n{body}\n```\n")
        else:
            parts.append("(A question here could not be displayed to the student.)\n")
    return "".join(parts)


# ───────────────────────────── transcript ─────────────────────────────


def _question_md(question: dict[str, Any]) -> list[str]:
    kind = "multiple choice" if question["kind"] == "choice" else "free text"
    lines = [f"> **{question['id'].upper()} — {question['title']}** ({kind})", ">"]
    lines += [f"> {line}" for line in question["prompt"].splitlines()]
    for i, option in enumerate(question.get("options") or []):
        lines.append(f"> {chr(ord('A') + i)}. {option}")
    status = status_of(question)
    if (status != "unanswered" or question.get("revealed")) and question["key"] != "":
        key = question["key"]
        shown = question["options"][key] if question["kind"] == "choice" else key
        lines.append(f"> Answer: {shown}")
    grades = question.get("grades") or []
    by = ""
    if grades and grades[-1].get("by") == "teacher":
        by = " (teacher" + (", after dispute" if len(grades) > 1 else "") + ")"
    lines.append(f"> Status: {status}{by}")
    return [*lines, ""]


def transcript(doc: dict[str, Any], label: str) -> str:
    teacher = teacher_of(doc)
    kind = "Practice" if teacher.get("kind") == "practice" else "Lesson"
    created = doc.get("createdAt", "")
    lines = [f"# {doc.get('title', kind)}", "", f"{kind} in {label} · started {created}", ""]
    questions = teacher["questions"]
    for turn in doc.get("turns", []):
        version = files.selected_version(turn)
        lines += [f"## You — {files._clock(version.get('createdAt'))}", ""]
        subs = version.get("submissions") or []
        if subs:
            lines += ["Answers:"]
            for sub in subs:
                q = find_question(doc, sub["questionId"]) or {"title": "", "options": []}
                given = (
                    "didn't know"
                    if sub.get("dontKnow")
                    else f'chose "{q["options"][sub["choice"]]}"'
                    if sub.get("choice") is not None and q.get("options")
                    else f'wrote "{sub.get("text", "")}"'
                )
                conf = confidence_text(sub)
                lines.append(
                    f"- **{sub['questionId'].upper()} {q['title']}** — {given} · confidence: {conf}"
                )
                if (sub.get("thinking") or "").strip():
                    lines.append(f"  Thinking: {sub['thinking'].strip()}")
            lines.append("")
        else:
            lines += [version.get("text", ""), ""]
        answer = files.selected_answer(version)
        if answer is None:
            continue
        who = " · ".join(x for x in (answer.get("endpointLabel"), answer.get("modelLabel")) if x)
        lines += [f"## Teacher — {who} — {files._clock(answer.get('startedAt'))}", ""]
        for seg in segments(doc, answer):
            if seg["type"] == "markdown":
                lines += [seg["text"].strip(), ""]
            elif seg["type"] == "question":
                q = next(x for x in questions if x["id"] == seg["questionId"])
                lines += _question_md(q)
            else:
                lines += ["*(A question could not be displayed.)*", ""]
        note = files.STATUS_NOTE.get(answer.get("status", ""))
        if note:
            lines += [note, ""]
    for plan in teacher["plans"][-1:]:
        lines += [
            f"## Plan (version {plan['version']})",
            "",
            "```mermaid",
            plan["mermaid"],
            "```",
            "",
        ]
    return "\n".join(lines).rstrip("\n") + "\n"
