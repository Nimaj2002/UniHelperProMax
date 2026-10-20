"""014 T087: the history list and title search, rename, delete with Undo, drafts, chat tabs."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from tests import fake_llm
from tests.conftest import assert_problem
from tests.contract.chat_helpers import (
    API,
    create_endpoint,
    make_session,
    model_ref,
    start_chat,
    wait_idle,
)
from tests.contract.openapi_check import check
from unihelper.models import Chat

pytestmark = pytest.mark.contract


def test_list_rename_delete_restore(app, owner_client: TestClient) -> None:  # type: ignore[no-untyped-def]
    c = owner_client
    ep = create_endpoint(c, "openai")
    key = make_session(c)
    assert c.get(f"{API}/sessions/{key}/chats").json() == []
    first = start_chat(c, key, model_ref(ep), "Binary search trees")
    wait_idle(c)
    second = start_chat(c, key, model_ref(ep), "Heaps and priority queues")
    wait_idle(c)
    listed = c.get(f"{API}/sessions/{key}/chats")
    assert listed.status_code == 200
    for item in listed.json():
        check(item, "ChatSummary", spec="014")
    assert [x["id"] for x in listed.json()] == [second["chat"]["id"], first["chat"]["id"]]
    found = c.get(f"{API}/sessions/{key}/chats", params={"q": "heap"}).json()
    assert [x["id"] for x in found] == [second["chat"]["id"]]
    by_text = c.get(f"{API}/sessions/{key}/chats", params={"q": "said", "in": "text"}).json()
    assert {x["id"] for x in by_text} == {first["chat"]["id"], second["chat"]["id"]}
    assert "You said" in by_text[0]["match"]

    chat_id = first["chat"]["id"]
    current = c.get(f"{API}/chats/{chat_id}").json()
    assert c.patch(f"{API}/chats/{chat_id}", json={"title": "BSTs"}).status_code == 428
    assert_problem(
        c.patch(f"{API}/chats/{chat_id}", json={"title": "x"}, headers={"If-Match": "99"}),
        412,
        "version_conflict",
    )
    renamed = c.patch(
        f"{API}/chats/{chat_id}",
        json={"title": "  BSTs  "},
        headers={"If-Match": str(current["version"])},
    )
    assert renamed.status_code == 200 and renamed.json()["title"] == "BSTs"
    check(renamed.json(), "Chat", spec="014")
    assert (
        c.patch(
            f"{API}/chats/{chat_id}",
            json={"title": ""},
            headers={"If-Match": str(renamed.json()["version"])},
        ).status_code
        == 422
    )

    deleted = c.delete(
        f"{API}/chats/{chat_id}", headers={"If-Match": str(renamed.json()["version"])}
    )
    assert deleted.status_code == 204
    assert [x["id"] for x in c.get(f"{API}/sessions/{key}/chats").json()] == [second["chat"]["id"]]
    assert_problem(c.get(f"{API}/chats/{chat_id}"), 404, "not_found")
    restored = c.post(f"{API}/chats/{chat_id}/restore")
    assert restored.status_code == 200 and restored.json()["title"] == "BSTs"
    check(restored.json(), "ChatSummary", spec="014")
    assert len(c.get(f"{API}/sessions/{key}/chats").json()) == 2

    # after the Undo window it can't come back
    again = c.get(f"{API}/chats/{chat_id}").json()
    assert (
        c.delete(f"{API}/chats/{chat_id}", headers={"If-Match": str(again["version"])}).status_code
        == 204
    )
    with app.state.sessionmaker() as db:
        row = db.get(Chat, chat_id)
        row.deleted_at = (datetime.now(UTC) - timedelta(minutes=11)).isoformat(timespec="seconds")
        db.commit()
    assert_problem(c.post(f"{API}/chats/{chat_id}/restore"), 410, "undo_expired")


def test_delete_stops_a_running_answer(owner_client: TestClient) -> None:
    c = owner_client
    fake_llm.STATE.update(slow_tokens=200, slow_delay=0.05)
    ep = create_endpoint(c, "anthropic")
    sent = start_chat(c, make_session(c), model_ref(ep, "slow"))
    version = c.get(f"{API}/chats/{sent['chat']['id']}").json()["version"]
    r = c.delete(f"{API}/chats/{sent['chat']['id']}", headers={"If-Match": str(version)})
    assert r.status_code == 204, r.text
    assert c.get(f"{API}/chat-runs/active").json() == []


def test_drafts(owner_client: TestClient) -> None:
    c = owner_client
    ep = create_endpoint(c, "openai")
    key = make_session(c)
    url = f"{API}/sessions/{key}/chat-drafts"
    assert c.get(url).json() == []
    new = c.put(url, json={"chatId": None, "text": "half a question", "attachments": []})
    assert new.status_code == 200
    check(new.json(), "ChatDraft", spec="014")
    sent = start_chat(c, key, model_ref(ep))
    wait_idle(c)
    assert c.get(url).json() == []  # sending from the new-chat box clears its draft
    c.put(
        url,
        json={
            "chatId": sent["chat"]["id"],
            "text": "follow-up",
            "attachments": [{"kind": "note", "ref": "n1"}],
        },
    )
    c.put(url, json={"chatId": None, "text": "another", "attachments": []})
    drafts = {d["chatId"]: d for d in c.get(url).json()}
    assert drafts[sent["chat"]["id"]]["text"] == "follow-up"
    assert drafts[sent["chat"]["id"]]["attachments"] == [
        {"kind": "note", "ref": "n1", "pdfMode": None}
    ]
    assert drafts[None]["text"] == "another"
    c.put(url, json={"chatId": None, "text": "", "attachments": []})  # empty deletes it
    assert [d["chatId"] for d in c.get(url).json()] == [sent["chat"]["id"]]
    assert (
        c.put(url, json={"chatId": None, "text": "x" * 100_001, "attachments": []}).status_code
        == 422
    )


def test_chat_tabs_survive(owner_client: TestClient) -> None:
    c = owner_client
    ep = create_endpoint(c, "openai")
    key = make_session(c)
    sent = start_chat(c, key, model_ref(ep))
    wait_idle(c)
    tab = {"kind": "chat", "id": sent["chat"]["id"]}
    r = c.put(f"{API}/workspace/{key}", json={"tabs": [tab], "active": tab})
    assert r.status_code == 200 and r.json()["tabs"] == [tab]


def test_bookkeeping_keeps_the_version(owner_client: TestClient) -> None:
    """Runs finishing and "seen" don't make the student's If-Match stale; a new EventSource
    can resume with ?lastEventId=."""
    c = owner_client
    ep = create_endpoint(c, "openai")
    sent = start_chat(c, make_session(c), model_ref(ep))
    wait_idle(c)
    before = c.get(f"{API}/chats/{sent['chat']['id']}").json()["version"]
    assert c.post(f"{API}/chats/{sent['chat']['id']}/seen").status_code == 204
    assert c.get(f"{API}/chats/{sent['chat']['id']}").json()["version"] == before
    r = c.get(f"{API}/chat-runs/{sent['runId']}/events", params={"lastEventId": 2})
    assert "id: 1\n" not in r.text and "id: 3\n" in r.text
