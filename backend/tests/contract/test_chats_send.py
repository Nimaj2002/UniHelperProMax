"""014 T064: starting chats, sending, regenerating, choosing versions, runs, Stop, seen."""

from __future__ import annotations

from collections.abc import Callable

import pytest
from fastapi.testclient import TestClient

from tests import fake_llm
from tests.conftest import assert_problem
from tests.contract.chat_helpers import (
    API,
    ack,
    create_endpoint,
    events,
    make_session,
    model_ref,
    send,
    start_chat,
    wait_idle,
)
from tests.contract.openapi_check import check

pytestmark = pytest.mark.contract


def test_start_and_send(owner_client: TestClient, make_member: Callable[..., TestClient]) -> None:
    c = owner_client
    ep = create_endpoint(c, "openai")
    key = make_session(c)
    sent = start_chat(c, key, model_ref(ep))
    check(sent, "SendResult", spec="014")
    wait_idle(c)
    chat = c.get(f"{API}/chats/{sent['chat']['id']}")
    assert chat.status_code == 200
    check(chat.json(), "Chat", spec="014")
    assert chat.json()["sessionKey"] == key
    assert chat.json()["model"] == model_ref(ep)

    second = send(c, sent["chat"]["id"], model_ref(ep), "second question")
    check(second, "SendResult", spec="014")
    wait_idle(c)
    full = c.get(f"{API}/chats/{sent['chat']['id']}").json()
    assert [t["versions"][0]["text"] for t in full["turns"]] == ["Hello there", "second question"]
    # the conversation was sent: user, assistant, user
    roles = [m["role"] for m in fake_llm.STATE["last"]["body"]["messages"]]
    assert roles == ["user", "assistant", "user"]

    member = make_member()
    assert_problem(member.get(f"{API}/chats/{sent['chat']['id']}"), 404, "not_found")
    assert_problem(member.post(f"{API}/chat-runs/{sent['runId']}/stop"), 404, "not_found")
    assert_problem(member.get(f"{API}/chat-runs/{sent['runId']}/events"), 404, "not_found")


def test_refusals(owner_client: TestClient) -> None:
    c = owner_client
    ep = create_endpoint(c, "openai")
    key = make_session(c)
    url = f"{API}/sessions/{key}/chats"
    assert_problem(c.post(url, json={"text": "   ", "model": model_ref(ep)}), 422, "empty_message")
    eleven = [{"kind": "note", "ref": f"n{i}"} for i in range(11)]
    assert_problem(
        c.post(url, json={"text": "x", "model": model_ref(ep), "attachments": eleven}),
        422,
        "too_many_attachments",
    )
    remote = create_endpoint(c, "anthropic", remote=True)
    assert_problem(
        c.post(url, json={"text": "x", "model": model_ref(remote)}), 409, "privacy_ack_required"
    )
    ack(c, remote)
    assert c.post(url, json={"text": "x", "model": model_ref(remote)}).status_code == 201
    wait_idle(c)
    # a hidden model or a disabled endpoint is not available
    r = c.patch(
        f"{API}/ai/endpoints/{ep['id']}",
        json={"enabled": False},
        headers={"If-Match": str(ep["version"])},
    )
    assert r.status_code == 200
    assert_problem(
        c.post(url, json={"text": "x", "model": model_ref(ep)}), 409, "model_unavailable"
    )
    # a key the store can't read
    keyed = create_endpoint(c, "gemini", api_key="sk-key-which-is-lost-1")
    c.app.state.secrets._aead = None  # type: ignore[attr-defined]
    assert_problem(
        c.post(url, json={"text": "x", "model": model_ref(keyed)}), 409, "key_unreadable"
    )


def test_run_active_regenerate_and_selection(owner_client: TestClient) -> None:
    c = owner_client
    fake_llm.STATE.update(slow_tokens=30, slow_delay=0.05)
    ep = create_endpoint(c, "openai")
    sent = start_chat(c, make_session(c), model_ref(ep, "slow"))
    assert_problem(
        c.post(
            f"{API}/chats/{sent['chat']['id']}/messages", json={"text": "x", "model": model_ref(ep)}
        ),
        409,
        "run_active",
    )
    active = c.get(f"{API}/chat-runs/active").json()
    for run in active:
        check(run, "ChatRun", spec="014")
    stopped = c.post(f"{API}/chat-runs/{sent['runId']}/stop")
    assert stopped.status_code == 200
    check(stopped.json(), "ChatRun", spec="014")

    regen = c.post(
        f"{API}/chats/{sent['chat']['id']}/turns/{sent['turnId']}/regenerate",
        json={"model": model_ref(ep, "echo")},
    )
    assert regen.status_code == 202, regen.text
    check(regen.json(), "SendResult", spec="014")
    assert events(c, regen.json()["runId"])[-1][1] == "done"
    wait_idle(c)
    version = c.get(f"{API}/chats/{sent['chat']['id']}").json()["turns"][0]["versions"][0]
    assert [a["status"] for a in version["answers"]] == ["stopped", "completed"]
    assert version["selectedAnswer"] == 1

    sel = c.put(
        f"{API}/chats/{sent['chat']['id']}/turns/{sent['turnId']}/selection",
        json={"version": 0, "answer": 0},
    )
    assert sel.status_code == 200
    check(sel.json(), "Chat", spec="014")
    assert sel.json()["turns"][0]["versions"][0]["selectedAnswer"] == 0
    assert (
        c.put(
            f"{API}/chats/{sent['chat']['id']}/turns/{sent['turnId']}/selection",
            json={"version": 3, "answer": 0},
        ).status_code
        == 422
    )

    retry = c.post(f"{API}/chats/{sent['chat']['id']}/turns/{sent['turnId']}/regenerate")
    assert retry.status_code == 202  # Retry/regenerate with the chat's model
    wait_idle(c)
    assert c.post(f"{API}/chats/{sent['chat']['id']}/seen").status_code == 204


def test_failures_are_classified_and_kept(owner_client: TestClient) -> None:
    c = owner_client
    ep = create_endpoint(c, "openai", models=["fail-429", "fail-midstream"])
    sent = start_chat(c, make_session(c), model_ref(ep, "fail-429"), "keep this text")
    got = events(c, sent["runId"])
    assert got[-1][1] == "failed"
    error = got[-1][2]["error"]
    assert error["category"] == "rate_limited" and error["retryAfterSeconds"] == 7
    wait_idle(c)
    chat = c.get(f"{API}/chats/{sent['chat']['id']}").json()
    version = chat["turns"][0]["versions"][0]
    assert version["text"] == "keep this text"  # the message is never lost
    assert version["answers"][0]["status"] == "failed"
    assert version["answers"][0]["error"]["category"] == "rate_limited"
