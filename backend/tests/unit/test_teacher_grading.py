"""022 T030: grading, question status and the text of the student's action turns."""

from __future__ import annotations

from typing import Any

import pytest

from unihelper.teacher.turns import (
    answers_text,
    apply_grade,
    dispute_text,
    grade_choice,
    status_of,
)

pytestmark = pytest.mark.unit


def _choice() -> dict[str, Any]:
    return {
        "id": "q1",
        "kind": "choice",
        "title": "Zero determinant",
        "options": ["invertible", "singular"],
        "key": 1,
        "grades": [],
        "submission": None,
    }


def _text() -> dict[str, Any]:
    return {
        "id": "q2",
        "kind": "text",
        "title": "Why",
        "key": "s",
        "grades": [],
        "submission": None,
    }


def test_status_and_choice_grading() -> None:
    q = _choice()
    assert status_of(q) == "unanswered"
    q["submission"] = {"choice": 0}
    assert status_of(q) == "submitted"
    q["grades"] = [grade_choice(q, 0, "t")]
    assert status_of(q) == "incorrect" and q["grades"][0]["by"] == "server"
    assert grade_choice(q, 1, "t")["grade"] == "correct"


def test_answers_text_confidence_not_given_is_not_low() -> None:
    q, t = _choice(), _text()
    q["submission"] = {"choice": 0, "confidence": None, "thinking": " I guessed "}
    q["grades"] = [grade_choice(q, 0, "t")]
    t["submission"] = {"text": "Because rows", "confidence": "low", "thinking": ""}  # legacy level
    text = answers_text([(q, q["submission"]), (t, t["submission"])])
    assert "A — 'invertible'. Graded by the app: incorrect." in text
    assert "Confidence: not given." in text and "Confidence: 25%." in text
    assert "My thinking: I guessed" in text
    assert "Grade the free-text answers with uh-grade blocks." in text


def test_apply_grade_rules() -> None:
    q, t = _choice(), _text()
    doc = {"teacher": {"questions": [q, t]}}
    grade = {"question": "q2", "grade": "partly", "feedback": "f"}
    assert apply_grade(doc, grade, "a1", "t") is None  # not answered yet
    t["submission"] = {"text": "x"}
    assert apply_grade(doc, grade, "a1", "t") == {
        "grade": "partly",
        "feedback": "f",
        "by": "teacher",
        "answerId": "a1",
        "at": "t",
    }
    q["submission"] = {"choice": 0}
    q["grades"] = [grade_choice(q, 0, "t")]
    regrade = {"question": "q1", "grade": "correct", "feedback": ""}
    assert apply_grade(doc, regrade, "a2", "t") is None  # choice: only after a dispute
    q["disputeReason"] = "Option A was meant"
    stored = apply_grade(doc, regrade, "a2", "t")
    assert stored is not None and stored["disputeReason"] == "Option A was meant"
    assert [g["grade"] for g in q["grades"]] == ["incorrect", "correct"]
    assert "disputeReason" not in q
    assert apply_grade(doc, {**regrade, "question": "q9"}, "a3", "t") is None


def test_dispute_text() -> None:
    t = _text()
    t["submission"] = {"text": "x"}
    assert "have not graded" in dispute_text(t, "")
    t["grades"] = [{"grade": "incorrect"}]
    text = dispute_text(t, "  It is right ")
    assert "graded incorrect" in text and "My reason: It is right" in text


def test_dont_know_is_app_graded_and_told_to_the_teacher() -> None:
    t = _text()
    t["submission"] = {"dontKnow": True, "confidence": 0, "thinking": ""}
    t["grades"] = [{"grade": "incorrect", "feedback": "", "by": "server", "at": "t"}]
    text = answers_text([(t, t["submission"])])
    assert "I don't know. Graded by the app: incorrect." in text and "Confidence: 0%." in text
    assert "Grade the free-text answers" not in text
    doc = {"teacher": {"questions": [t]}}
    assert apply_grade(doc, {"question": "q2", "grade": "correct"}, "a1", "t") is None
