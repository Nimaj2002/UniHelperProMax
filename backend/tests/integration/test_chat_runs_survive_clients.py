"""014 T062: an answer finishes and is saved with nobody watching (closing the panel or a tab
never interrupts it — FR-007, FR-045); several viewers see the same events; the run limit."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from tests import fake_llm
from tests.conftest import assert_problem
from tests.contract.chat_helpers import (
    API,
    create_endpoint,
    events,
    make_session,
    model_ref,
    start_chat,
    wait_idle,
)

pytestmark = pytest.mark.integration


def test_answer_completes_without_subscribers(owner_client: TestClient) -> None:
    c = owner_client
    fake_llm.STATE.update(slow_tokens=10, slow_delay=0.02)
    ep = create_endpoint(c, "anthropic")
    sent = start_chat(c, make_session(c), model_ref(ep, "slow"))
    active = c.get(f"{API}/chat-runs/active").json()
    assert [r["id"] for r in active] == [sent["runId"]]
    listed = c.get(f"{API}/chats/{sent['chat']['id']}").json()
    assert listed["generating"] is True
    wait_idle(c)
    chat = c.get(f"{API}/chats/{sent['chat']['id']}").json()
    answer = chat["turns"][0]["versions"][0]["answers"][0]
    assert answer["status"] == "completed" and answer["text"].count("tok") == 10
    assert chat["generating"] is False and chat["unseenAnswer"] is True
    assert c.post(f"{API}/chats/{chat['id']}/seen").status_code == 204
    assert c.get(f"{API}/chats/{chat['id']}").json()["unseenAnswer"] is False
    # two viewers (two windows) get the same stream
    assert events(c, sent["runId"]) == events(c, sent["runId"])


def test_run_limit_per_user(owner_client: TestClient) -> None:
    c = owner_client
    fake_llm.STATE.update(slow_tokens=100, slow_delay=0.05)
    ep = create_endpoint(c, "openai")
    key = make_session(c)
    runs = [start_chat(c, key, model_ref(ep, "slow"), f"chat {i}")["runId"] for i in range(4)]
    r = c.post(
        f"{API}/sessions/{key}/chats", json={"text": "fifth", "model": model_ref(ep, "slow")}
    )
    assert_problem(r, 429, "too_many_runs")
    for run_id in runs:
        assert c.post(f"{API}/chat-runs/{run_id}/stop").status_code == 200
    wait_idle(c)
