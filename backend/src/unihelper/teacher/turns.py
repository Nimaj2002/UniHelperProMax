"""Grading and the text of the student's action turns (022 research R4, R5). Pure."""

from __future__ import annotations

from typing import Any

LEGACY_CONFIDENCE = {"low": 25, "medium": 50, "high": 75}  # chats saved before the 0–100 slider


def confidence_of(submission: dict[str, Any]) -> int | None:
    value = submission.get("confidence")
    if isinstance(value, str):
        return LEGACY_CONFIDENCE.get(value)
    return value if isinstance(value, int) else None


def confidence_text(submission: dict[str, Any]) -> str:
    value = confidence_of(submission)
    return "not given" if value is None else f"{value}%"


def status_of(question: dict[str, Any]) -> str:
    grades = question.get("grades") or []
    if grades:
        return str(grades[-1]["grade"])
    return "submitted" if question.get("submission") else "unanswered"


def grade_choice(question: dict[str, Any], choice: int, at: str) -> dict[str, Any]:
    """Multiple choice is graded by the app at once (R4)."""
    grade = "correct" if choice == question.get("key") else "incorrect"
    return {"grade": grade, "feedback": "", "by": "server", "at": at}


def _answer_line(question: dict[str, Any], submission: dict[str, Any]) -> list[str]:
    head = f"Answer to question {question['id']} ({question['title']})"
    lines: list[str]
    if submission.get("dontKnow"):
        lines = [f"{head}: I don't know. Graded by the app: incorrect."]
    elif question["kind"] == "choice":
        choice = submission["choice"]
        letter = chr(ord("A") + choice)
        grade = status_of(question)
        lines = [
            f"{head}, multiple choice: {letter} — {question['options'][choice]!r}. "
            f"Graded by the app: {grade}."
        ]
    else:
        lines = [f"{head}, free text:", submission["text"]]
    lines.append(f"Confidence: {confidence_text(submission)}.")
    thinking = (submission.get("thinking") or "").strip()
    if thinking:
        lines.append(f"My thinking: {thinking}")
    return lines


def answers_text(pairs: list[tuple[dict[str, Any], dict[str, Any]]]) -> str:
    """What the model reads for an answer submission (`(question, submission)` pairs)."""
    blocks = ["\n".join(_answer_line(q, s)) for q, s in pairs]
    if any(q["kind"] == "text" and not s.get("dontKnow") for q, s in pairs):
        blocks.append("Grade the free-text answers with uh-grade blocks.")
    return "\n\n".join(blocks)


def dispute_text(question: dict[str, Any], reason: str) -> str:
    if not question.get("grades"):
        return (
            f"You have not graded my answer to question {question['id']} ({question['title']}) "
            "yet. Please grade it with a uh-grade block."
        )
    head = (
        f"I dispute the grade of question {question['id']} ({question['title']}), "
        f"graded {status_of(question)}."
    )
    tail = f" My reason: {reason.strip()}" if reason.strip() else ""
    return f"{head}{tail}\nPlease look at it again and re-grade it with a uh-grade block."


def hint_text(question: dict[str, Any], attempt: str) -> str:
    head = f"Could I have a hint for problem {question['id']} ({question['title']})?"
    return f"{head}\nWhat I have so far: {attempt.strip()}" if attempt.strip() else head


def retry_text() -> str:
    return (
        "The last question could not be displayed in the app. Please ask it again, as one valid "
        "uh-question block."
    )


def apply_grade(
    doc: dict[str, Any], payload: dict[str, Any], answer_id: str, at: str
) -> dict[str, Any] | None:
    """A teacher `uh-grade` block. Returns the stored grade (camelCase), or None if it does not
    apply: unknown question, no submission, or an app-graded answer that was not disputed."""
    question = find_question(doc, payload["question"])
    if question is None or not question.get("submission"):
        return None
    disputed = question.get("disputeReason")
    app_graded = question["kind"] == "choice" or question["submission"].get("dontKnow")
    if app_graded and disputed is None:
        return None
    grade: dict[str, Any] = {
        "grade": payload["grade"],
        "feedback": payload.get("feedback", ""),
        "by": "teacher",
        "answerId": answer_id,
        "at": at,
    }
    if disputed is not None:
        if disputed:
            grade["disputeReason"] = disputed
        question.pop("disputeReason", None)
    question.setdefault("grades", []).append(grade)
    return grade


def find_question(doc: dict[str, Any], question_id: str) -> dict[str, Any] | None:
    for question in (doc.get("teacher") or {}).get("questions", []):
        if question.get("id") == question_id:
            return question  # type: ignore[no-any-return]
    return None
