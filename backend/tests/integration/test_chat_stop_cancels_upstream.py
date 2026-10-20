"""014 T061: Stop ends the answer at once, cancels it at the provider (the connection closes),
keeps the partial text as "Stopped", and nothing arrives afterwards (FR-036, SC-003)."""

from __future__ import annotations

import time

import pytest
from fastapi.testclient import TestClient

from tests import fake_llm
from tests.contract.chat_helpers import (
    API,
    create_endpoint,
    events,
    make_session,
    model_ref,
    start_chat,
)

pytestmark = pytest.mark.integration


@pytest.mark.parametrize("style", ["openai", "anthropic", "gemini"])
def test_stop(owner_client: TestClient, style: str) -> None:
    c = owner_client
    ep = create_endpoint(c, style)
    sent = start_chat(c, make_session(c), model_ref(ep, "slow"))
    time.sleep(0.5)  # a few tokens
    began = time.monotonic()
    r = c.post(f"{API}/chat-runs/{sent['runId']}/stop")
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "stopped"
    assert time.monotonic() - began < 0.5
    deadline = time.monotonic() + 0.5
    while not fake_llm.STATE["disconnected"] and time.monotonic() < deadline:
        time.sleep(0.01)
    assert fake_llm.STATE["disconnected"] is True  # the provider saw the client go away

    got = events(c, sent["runId"])
    assert got[-1][1] == "stopped"
    streamed = "".join(d["text"] for _i, n, d in got if n == "delta")
    assert streamed.startswith("tok0 ")
    time.sleep(0.3)  # no further text after stopping
    assert events(c, sent["runId"]) == got

    answer = c.get(f"{API}/chats/{sent['chat']['id']}").json()["turns"][0]["versions"][0][
        "answers"
    ][0]
    assert answer["status"] == "stopped" and answer["text"].startswith(streamed)
    assert len(answer["text"].split()) < 50  # far from the 200 tokens of a full answer

    again = c.post(f"{API}/chat-runs/{sent['runId']}/stop")
    assert again.status_code == 200 and again.json()["status"] == "stopped"
