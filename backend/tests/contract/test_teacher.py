"""022: lesson and practice chats — contract tests (contracts/openapi.yaml, teacher-stream.md)."""

from __future__ import annotations

from collections.abc import Callable

import pytest
from fastapi.testclient import TestClient

from tests import fake_llm
from tests.conftest import assert_problem
from tests.contract.chat_helpers import ack, create_endpoint, model_ref, start_chat
from tests.contract.openapi_check import check
from tests.contract.teacher_helpers import (
    API,
    CHOICE,
    TEXT,
    block,
    events,
    lesson_setup,
    script,
    start,
    wait_idle,
)

pytestmark = pytest.mark.contract


def _chat(c: TestClient, chat_id: str) -> dict[str, object]:
    r = c.get(f"{API}/teacher-chats/{chat_id}")
    assert r.status_code == 200, r.text
    check(r.json(), "TeacherChatOut", spec="022")
    return r.json()  # type: ignore[no-any-return]


def test_start_list_read_and_question_events(
    owner_client: TestClient, make_member: Callable[..., TestClient]
) -> None:
    c = owner_client
    key, ref = lesson_setup(c)
    script("What do you know already?\n" + block("question", CHOICE) + "Take your time.\n")
    sent = start(c, key, ref)
    check(sent, "TeacherSendResult", spec="022")
    assert sent["chat"]["kind"] == "lesson"
    evs = events(c, sent["runId"])
    names = [name for _id, name, _data in evs]
    assert names[0] == "start" and names[-1] == "done"
    question = next(data for _id, name, data in evs if name == "question")
    check(question, "Question", spec="022")
    assert "key" not in question and "explanation" not in question  # FR-018
    prose = "".join(data["text"] for _id, name, data in evs if name == "delta")
    assert prose == "What do you know already?\nTake your time.\n"
    assert "non-trivial" not in prose
    wait_idle(c)

    listed = c.get(f"{API}/sessions/{key}/teacher-chats")
    assert listed.status_code == 200
    check(listed.json(), "TeacherChatSummary", many=True, spec="022")
    assert [x["id"] for x in listed.json()] == [sent["chat"]["id"]]
    assert listed.json()[0]["unansweredCount"] == 1

    full = _chat(c, sent["chat"]["id"])
    [turn] = full["turns"]  # type: ignore[misc]
    assert [s["type"] for s in turn["answer"]["segments"]] == ["markdown", "question", "markdown"]
    [q] = full["questions"]  # type: ignore[misc]
    assert q["id"] == "q1" and q["status"] == "unanswered" and "key" not in q

    # teacher chats are not AI chats, and the reverse
    assert c.get(f"{API}/sessions/{key}/chats").json() == []
    assert_problem(c.get(f"{API}/chats/{sent['chat']['id']}"), 404, "not_found")
    ai_chat = start_chat(c, key, model_ref(create_endpoint(c, "anthropic")))
    wait_idle(c)
    assert_problem(c.get(f"{API}/teacher-chats/{ai_chat['chat']['id']}"), 404, "not_found")

    member = make_member()
    assert_problem(member.get(f"{API}/teacher-chats/{sent['chat']['id']}"), 404, "not_found")


def test_start_refusals(owner_client: TestClient) -> None:
    c = owner_client
    key, ref = lesson_setup(c)
    url = f"{API}/sessions/{key}/teacher-chats"
    r = c.post(url, json={"text": " ", "model": ref, "kind": "lesson"})
    assert_problem(r, 422, "empty_message")
    assert_problem(
        c.post(
            f"{API}/sessions/nope:2026-01-01/teacher-chats",
            json={"text": "x", "model": ref, "kind": "lesson"},
        ),
        404,
        "not_found",
    )
    remote = create_endpoint(c, "openai", remote=True, api_key="sk-teacher-test-key-1234")
    r = c.post(url, json={"text": "Hi", "model": model_ref(remote), "kind": "lesson"})
    assert_problem(r, 409, "privacy_ack_required")
    ack(c, remote)
    r = c.post(url, json={"text": "Hi", "model": ref, "kind": "lesson", "ideaIds": ["nope"]})
    assert_problem(r, 422, "unknown_idea")


def test_send_message_and_run_active(owner_client: TestClient) -> None:
    c = owner_client
    key, ref = lesson_setup(c)
    script("Hello.\n" + block("question", CHOICE))
    sent = start(c, key, ref)
    wait_idle(c)
    chat_id = sent["chat"]["id"]
    fake_llm.STATE["slow_tokens"] = 50
    r = c.post(
        f"{API}/teacher-chats/{chat_id}/messages",
        json={"text": "Wait, what is a determinant?", "model": ref},
    )
    assert r.status_code == 202, r.text
    check(r.json(), "TeacherSendResult", spec="022")
    wait_idle(c)
    full = _chat(c, chat_id)
    assert full["questions"][0]["status"] == "unanswered"  # type: ignore[index]
    # the model saw the earlier question with the id the app gave it
    sent_text = str(fake_llm.STATE["last"]["body"]["messages"])
    assert '"id": "q1"' in sent_text
    assert "uh-question" in str(fake_llm.STATE["last"]["body"]["messages"][0])  # system prompt


def test_answers_grades_and_disputes(owner_client: TestClient) -> None:
    c = owner_client
    key, ref = lesson_setup(c)
    script("Two checks.\n" + block("question", CHOICE) + block("question", TEXT))
    sent = start(c, key, ref)
    wait_idle(c)
    chat_id = sent["chat"]["id"]
    url = f"{API}/teacher-chats/{chat_id}/answers"

    assert_problem(
        c.post(
            url,
            json={"model": ref, "answers": [{"questionId": "q1", "text": "x", "confidence": None}]},
        ),
        422,
        "wrong_answer_kind",
    )
    assert_problem(
        c.post(
            url,
            json={
                "model": ref,
                "answers": [{"questionId": "q1", "choice": 0, "dontKnow": True, "confidence": 0}],
            },
        ),
        422,
        "wrong_answer_kind",
    )
    assert_problem(
        c.post(
            url,
            json={"model": ref, "answers": [{"questionId": "q1", "choice": 7, "confidence": None}]},
        ),
        422,
        "option_out_of_range",
    )
    assert_problem(
        c.post(
            url,
            json={"model": ref, "answers": [{"questionId": "q9", "choice": 0, "confidence": None}]},
        ),
        404,
        "not_found",
    )

    script(
        "The determinant is zero, so…\n"
        + block("grade", {"question": "q2", "grade": "partly", "feedback": "Almost."})
    )
    body = {
        "model": ref,
        "answers": [
            {"questionId": "q1", "choice": 0, "confidence": 25, "thinking": "I guessed"},
            {"questionId": "q2", "text": "Because rows", "confidence": None},
        ],
    }
    r = c.post(url, json=body)
    assert r.status_code == 202, r.text
    check(r.json(), "TeacherSendResult", spec="022")
    [graded] = r.json()["graded"]
    assert graded["id"] == "q1" and graded["status"] == "incorrect" and graded["key"] == 1
    evs = events(c, r.json()["runId"])
    grade = next(d for _i, n, d in evs if n == "grade")
    assert grade["questionId"] == "q2" and grade["grade"] == "partly"
    wait_idle(c)
    # the model read the answers in words, confidence not given ≠ low (FR-020)
    last_user = str(fake_llm.STATE["last"]["body"]["messages"][-1])
    assert "Graded by the app: incorrect" in last_user and "Confidence: not given" in last_user
    assert_problem(
        c.post(
            url,
            json={"model": ref, "answers": [{"questionId": "q1", "choice": 1, "confidence": None}]},
        ),
        409,
        "already_answered",
    )

    questions = {q["id"]: q for q in _chat(c, chat_id)["questions"]}  # type: ignore[attr-defined]
    assert questions["q2"]["status"] == "partly" and questions["q2"]["key"] == TEXT["solution"]

    # dispute the server grade of q1: the teacher re-grades, both grades are kept (FR-024a)
    script(
        "You are right.\n"
        + block("grade", {"question": "q1", "grade": "correct", "feedback": "Fair."})
    )
    r = c.post(
        f"{API}/teacher-chats/{chat_id}/questions/q1/dispute",
        json={"model": ref, "reason": "Option A was meant"},
    )
    assert r.status_code == 202, r.text
    wait_idle(c)
    q1 = next(q for q in _chat(c, chat_id)["questions"] if q["id"] == "q1")  # type: ignore[attr-defined]
    assert [g["grade"] for g in q1["grades"]] == ["incorrect", "correct"]
    assert q1["grades"][1]["disputeReason"] == "Option A was meant"
    assert q1["status"] == "correct"

    script("Next.\n" + block("question", {**TEXT, "title": "Later"}))
    c.post(f"{API}/teacher-chats/{chat_id}/messages", json={"text": "go on", "model": ref})
    wait_idle(c)
    assert_problem(
        c.post(f"{API}/teacher-chats/{chat_id}/questions/q3/dispute", json={"model": ref}),
        409,
        "not_answered",
    )


def test_malformed_question_and_retry(owner_client: TestClient) -> None:
    c = owner_client
    key, ref = lesson_setup(c)
    script("Check.\n" + block("question", {**CHOICE, "options": ["one"]}))
    sent = start(c, key, ref)
    evs = events(c, sent["runId"])
    bad = next(d for _i, n, d in evs if n == "malformed")
    assert bad["reason"] == "bad_options"
    wait_idle(c)
    chat_id = sent["chat"]["id"]
    segs = _chat(c, chat_id)["turns"][0]["answer"]["segments"]  # type: ignore[index]
    assert segs[-1] == {"type": "malformed", "id": bad["id"], "reason": "bad_options"}
    script("Again.\n" + block("question", CHOICE))
    r = c.post(f"{API}/teacher-chats/{chat_id}/malformed/{bad['id']}/retry", json={"model": ref})
    assert r.status_code == 202, r.text
    wait_idle(c)
    assert [q["id"] for q in _chat(c, chat_id)["questions"]] == ["q1"]  # type: ignore[attr-defined]
    assert_problem(
        c.post(f"{API}/teacher-chats/{chat_id}/malformed/nope/retry", json={"model": ref}),
        404,
        "not_found",
    )


def test_stop_mid_block_keeps_earlier_questions(owner_client: TestClient) -> None:
    c = owner_client
    key, ref = lesson_setup(c)
    script("One.\n" + block("question", CHOICE) + '```uh-question\n{"kind": "text", "prompt": "cut')
    sent = start(c, key, ref)
    evs = events(c, sent["runId"])
    assert [d["reason"] for _i, n, d in evs if n == "malformed"] == ["unterminated"]
    wait_idle(c)
    full = _chat(c, sent["chat"]["id"])
    assert [q["status"] for q in full["questions"]] == ["unanswered"]  # type: ignore[attr-defined]


def test_rename_seen_delete_restore_and_instructions(owner_client: TestClient) -> None:
    c = owner_client
    key, ref = lesson_setup(c)
    script("Hi.\n")
    sent = start(c, key, ref)
    wait_idle(c)
    chat_id = sent["chat"]["id"]
    version = c.get(f"{API}/sessions/{key}/teacher-chats").json()[0]["version"]
    r = c.patch(
        f"{API}/teacher-chats/{chat_id}",
        json={"title": "Determinants"},
        headers={"If-Match": str(version)},
    )
    assert r.status_code == 200, r.text
    check(r.json(), "TeacherChatSummary", spec="022")
    assert r.json()["title"] == "Determinants"
    assert_problem(
        c.patch(
            f"{API}/teacher-chats/{chat_id}",
            json={"title": "x"},
            headers={"If-Match": str(version)},
        ),
        412,
        "version_conflict",
    )
    assert_problem(
        c.patch(f"{API}/chats/{chat_id}", json={"title": "x"}, headers={"If-Match": str(version)}),
        404,
        "not_found",
    )
    assert c.post(f"{API}/chats/{chat_id}/seen").status_code == 204

    impact = c.get(f"{API}/teacher-chats/{chat_id}/graph-impact")
    assert impact.status_code == 200 and impact.json() == {"ideas": 0}
    assert_problem(c.get(f"{API}/teacher-chats/nope/graph-impact"), 404, "not_found")
    version = r.json()["version"]
    assert c.delete(f"{API}/chats/{chat_id}", headers={"If-Match": str(version)}).status_code == 204
    assert c.get(f"{API}/sessions/{key}/teacher-chats").json() == []
    assert c.post(f"{API}/chats/{chat_id}/restore").status_code == 200
    assert len(c.get(f"{API}/sessions/{key}/teacher-chats").json()) == 1

    r = c.get(f"{API}/teacher/instructions")
    assert r.status_code == 200
    body = r.json()
    assert all(body[k].strip() for k in ("lesson", "practice", "extraction"))
    assert "uh-question" in body["lesson"]


def test_files_and_transcript(owner_client: TestClient, tmp_data_dir) -> None:  # type: ignore[no-untyped-def]
    c = owner_client
    key, ref = lesson_setup(c)
    script(
        "Plan first.\n"
        + block("plan", {"mermaid": "graph TD\n a --> b", "current": "a"})
        + block("question", CHOICE)
    )
    sent = start(c, key, ref, "Teach me eigenvalues")
    wait_idle(c)
    [json_file] = [p for p in tmp_data_dir.rglob("chats/*.json")]
    md = json_file.with_suffix(".md").read_text(encoding="utf-8")
    assert md.startswith("# Teach me eigenvalues") and "Lesson in" in md
    assert "Q1 — Zero determinant" in md and "Answer:" not in md  # key hidden until answered
    assert "uh-question" not in md and "```mermaid" in md
    import json

    doc = json.loads(json_file.read_text(encoding="utf-8"))
    assert doc["format"] == "uh-chat/1" and doc["teacher"]["kind"] == "lesson"
    assert doc["teacher"]["questions"][0]["key"] == 1
    full = _chat(c, sent["chat"]["id"])
    assert [p["version"] for p in full["plans"]] == [1]  # type: ignore[attr-defined]


def test_practice_hint_and_reveal(owner_client: TestClient) -> None:
    c = owner_client
    key, ref = lesson_setup(c)
    script(
        "Problem one.\n" + block("question", CHOICE) + "Problem two.\n" + block("question", TEXT)
    )
    sent = start(c, key, ref, "Practice determinants", kind="practice", topic="Determinants")
    wait_idle(c)
    chat_id = sent["chat"]["id"]
    from tests import fake_llm

    system = str(fake_llm.STATE["last"]["body"]["messages"][0])
    assert "practice session" in system and "Determinants" in system
    full = _chat(c, chat_id)
    assert full["topic"] == "Determinants" and full["chat"]["kind"] == "practice"  # type: ignore[index]
    assert all(q["practice"] for q in full["questions"])  # type: ignore[attr-defined]

    script("Think of volume.\n" + block("hint", {"question": "q1", "text": "Think of volume."}))
    r = c.post(
        f"{API}/teacher-chats/{chat_id}/questions/q1/hint",
        json={"model": ref, "attempt": "No idea"},
    )
    assert r.status_code == 202, r.text
    check(r.json(), "TeacherSendResult", spec="022")
    hint_event = next(d for _i, n, d in events(c, r.json()["runId"]) if n == "hint")
    assert hint_event == {
        "questionId": "q1",
        "text": "Think of volume.",
        "createdAt": hint_event["createdAt"],
    }
    wait_idle(c)
    q1 = next(q for q in _chat(c, chat_id)["questions"] if q["id"] == "q1")  # type: ignore[attr-defined]
    assert [h["text"] for h in q1["hints"]] == ["Think of volume."] and "key" not in q1

    r = c.post(f"{API}/teacher-chats/{chat_id}/questions/q2/reveal")
    assert r.status_code == 200, r.text
    check(r.json(), "Question", spec="022")
    assert r.json()["revealed"] and r.json()["key"] == TEXT["solution"]
    assert_problem(c.post(f"{API}/teacher-chats/{chat_id}/questions/q9/reveal"), 404, "not_found")

    # practice-only actions refuse lesson questions
    script("Lesson.\n" + block("question", CHOICE))
    lesson = start(c, key, ref)
    wait_idle(c)
    lid = lesson["chat"]["id"]
    assert_problem(c.post(f"{API}/teacher-chats/{lid}/questions/q1/reveal"), 409, "not_practice")
    assert_problem(
        c.post(f"{API}/teacher-chats/{lid}/questions/q1/hint", json={"model": ref}),
        409,
        "not_practice",
    )


def test_run_active_and_workspace_tab(owner_client: TestClient) -> None:
    c = owner_client
    key, ref = lesson_setup(c)
    slow_ref = model_ref(create_endpoint(c, "openai", name="slow one"), "slow")
    fake_llm.STATE["slow_tokens"] = 400
    sent = start(c, key, slow_ref)
    chat_id = sent["chat"]["id"]
    r = c.post(f"{API}/teacher-chats/{chat_id}/messages", json={"text": "more", "model": ref})
    assert_problem(r, 409, "run_active")
    r = c.post(
        f"{API}/teacher-chats/{chat_id}/answers",
        json={"model": ref, "answers": [{"questionId": "q1", "choice": 0, "confidence": None}]},
    )
    assert_problem(r, 409, "run_active")
    [run] = c.get(f"{API}/chat-runs/active").json()
    assert run["teacher"] is True  # the rail shows it on AI Teacher, not Chat
    stopped = c.post(f"{API}/chat-runs/{sent['runId']}/stop")
    assert stopped.status_code == 200 and stopped.json()["teacher"] is True
    wait_idle(c)

    tab = {"kind": "teacher", "id": chat_id}
    new_tab = {"kind": "teacher", "id": "new:lesson-0123456789ab"}
    r = c.put(f"{API}/workspace/{key}", json={"tabs": [tab, new_tab], "active": tab})
    assert r.status_code == 200, r.text
    assert r.json()["tabs"] == [tab, new_tab]


def test_an_empty_answer_fails_with_a_reason(owner_client: TestClient) -> None:
    """022 T076 (seen with a real reasoning model): no answer text at all is a failed run with
    a message, not an empty completed reply."""
    c = owner_client
    key, ref = lesson_setup(c)
    script("")
    sent = start(c, key, ref)
    failed = next(d for _i, n, d in events(c, sent["runId"]) if n == "failed")
    assert failed["error"]["category"] == "provider"
    assert "no answer" in failed["error"]["message"]
    wait_idle(c)
    answer = _chat(c, sent["chat"]["id"])["turns"][0]["answer"]  # type: ignore[index]
    assert answer["status"] == "failed" and answer["error"]["category"] == "provider"


def test_dont_know_answer(owner_client: TestClient) -> None:
    c = owner_client
    key, ref = lesson_setup(c)
    script("One check.\n" + block("question", TEXT))
    sent = start(c, key, ref)
    wait_idle(c)
    chat_id = sent["chat"]["id"]
    script("That's fine, let us build it up.\n")
    r = c.post(
        f"{API}/teacher-chats/{chat_id}/answers",
        json={"model": ref, "answers": [{"questionId": "q1", "dontKnow": True, "confidence": 0}]},
    )
    assert r.status_code == 202, r.text
    [graded] = r.json()["graded"]
    assert graded["status"] == "incorrect" and graded["submission"]["dontKnow"] is True
    assert graded["submission"]["confidence"] == 0
    wait_idle(c)
    assert "I don't know" in str(fake_llm.STATE["last"]["body"]["messages"][-1])
