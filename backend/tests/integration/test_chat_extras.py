"""014 T121: add an answer to a note (append-only), edit and resend the last message as a new
version, custom instructions as the system text, search in the text of chats."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from tests import fake_llm
from tests.conftest import assert_problem
from tests.contract.chat_helpers import (
    API,
    create_endpoint,
    make_session,
    model_ref,
    send,
    start_chat,
    wait_idle,
)
from tests.contract.notes_helpers import create_note
from tests.contract.openapi_check import check

pytestmark = pytest.mark.integration


def test_add_answer_to_note(owner_client: TestClient) -> None:
    c = owner_client
    ep = create_endpoint(c, "openai")
    key = make_session(c)
    original = "# Notes\nlast line without newline"
    note = create_note(c, key, "Lecture", original)
    sent = start_chat(c, key, model_ref(ep), "Explain heaps")
    wait_idle(c)
    url = f"{API}/chats/{sent['chat']['id']}/answers/{sent['answerId']}/append-to-note"
    r = c.post(url, json={"noteId": note["id"]})
    assert r.status_code == 200, r.text
    check(r.json(), "AppendResult", spec="014")
    content = c.get(f"{API}/notes/{note['id']}").json()["content"]
    assert content.startswith(original)  # nothing before it changed
    added = content[len(original) :]
    assert (
        added.startswith("\n\n## Chat — Explain heaps · 20") and "You said: Explain heaps" in added
    )
    new = c.post(url, json={"newNoteTitle": "From chat"})
    assert new.status_code == 200, new.text
    assert (
        c.get(f"{API}/notes/{new.json()['noteId']}")
        .json()["content"]
        .startswith("## Chat — Explain heaps")
    )

    fake_llm.STATE.update(slow_tokens=100, slow_delay=0.05)
    slow = send(c, sent["chat"]["id"], {**model_ref(ep, "slow")}, "More")
    busy = c.post(
        f"{API}/chats/{sent['chat']['id']}/answers/{slow['answerId']}/append-to-note",
        json={"noteId": note["id"]},
    )
    assert_problem(busy, 409, "answer_incomplete")
    c.post(f"{API}/chat-runs/{slow['runId']}/stop")


def test_edit_and_resend(owner_client: TestClient) -> None:
    c = owner_client
    ep = create_endpoint(c, "anthropic")
    key = make_session(c)
    sent = start_chat(c, key, model_ref(ep), "First question")
    wait_idle(c)
    second = send(c, sent["chat"]["id"], model_ref(ep), "Second question")
    wait_idle(c)
    assert_problem(
        c.post(
            f"{API}/chats/{sent['chat']['id']}/turns/{sent['turnId']}/edit",
            json={"text": "x", "model": model_ref(ep)},
        ),
        409,
        "not_last_turn",
    )
    r = c.post(
        f"{API}/chats/{sent['chat']['id']}/turns/{second['turnId']}/edit",
        json={"text": "Second question, better", "model": model_ref(ep)},
    )
    assert r.status_code == 202, r.text
    check(r.json(), "SendResult", spec="014")
    wait_idle(c)
    turn = c.get(f"{API}/chats/{sent['chat']['id']}").json()["turns"][1]
    assert [v["text"] for v in turn["versions"]] == ["Second question", "Second question, better"]
    assert turn["selected"] == 1
    assert (
        turn["versions"][0]["answers"][0]["status"] == "completed"
    )  # version 1 kept with its answer
    assert "better" in turn["versions"][1]["answers"][0]["text"]


def test_custom_instructions_reach_every_style(owner_client: TestClient) -> None:
    c = owner_client
    version = c.get(f"{API}/ai/settings").json()["version"]
    c.put(
        f"{API}/ai/settings",
        json={"customInstructions": "Answer like a tutor."},
        headers={"If-Match": str(version)},
    )
    key = make_session(c)
    for style in ("openai", "anthropic", "gemini"):
        ep = create_endpoint(c, style, name=f"{style} x")
        start_chat(c, key, model_ref(ep), "Hi")
        wait_idle(c)
        body = fake_llm.STATE["last"]["body"]
        if style == "openai":
            assert body["messages"][0] == {"role": "system", "content": "Answer like a tutor."}
        elif style == "anthropic":
            assert body["system"] == "Answer like a tutor."
        else:
            assert body["system_instruction"] == {"parts": [{"text": "Answer like a tutor."}]}
