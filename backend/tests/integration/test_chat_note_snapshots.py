"""014 T102: attached notes are sent as titled text, with a fresh snapshot on every send
(clarification Q2); snapshots are content-addressed files kept once; a deleted note is shown as
no longer available."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from tests import fake_llm
from tests.contract.chat_helpers import (
    API,
    create_endpoint,
    make_session,
    model_ref,
    send,
    start_chat,
    wait_idle,
)
from tests.contract.notes_helpers import create_note, save

pytestmark = pytest.mark.integration


def last_user_text(style: str = "openai") -> str:
    messages = fake_llm.STATE["last"]["body"]["messages"]
    content = messages[-1]["content"]
    return content if isinstance(content, str) else " ".join(p.get("text", "") for p in content)


def test_snapshots_per_send(owner_client: TestClient, tmp_data_dir: Path) -> None:
    c = owner_client
    ep = create_endpoint(c, "openai")
    key = make_session(c)
    note = create_note(c, key, "Lecture 5", "Heaps are trees.")
    sent = start_chat(
        c, key, model_ref(ep), "Summarise", attachments=[{"kind": "note", "ref": note["id"]}]
    )
    wait_idle(c)
    assert "--- Note: Lecture 5 ---\nHeaps are trees." in last_user_text()
    chat_id = sent["chat"]["id"]
    first = c.get(f"{API}/chats/{chat_id}").json()
    snap1 = first["turns"][0]["versions"][0]["noteSnapshots"][0]
    assert snap1["noteId"] == note["id"] and snap1["title"] == "Lecture 5"
    assert first["context"][0]["title"] == "Lecture 5" and first["context"][0]["available"] is True

    current = c.get(f"{API}/notes/{note['id']}").json()
    save(c, current, "Heaps are complete binary trees.")
    send(c, chat_id, model_ref(ep), "And now?")  # the note stays in context
    wait_idle(c)
    assert "complete binary trees" in last_user_text()
    full = c.get(f"{API}/chats/{chat_id}").json()
    snap2 = full["turns"][1]["versions"][0]["noteSnapshots"][0]
    assert snap2["snapshot"] != snap1["snapshot"]
    assert full["turns"][0]["versions"][0]["noteSnapshots"][0] == snap1  # history unchanged
    snapdir = next(tmp_data_dir.rglob("snapshots"))
    assert sorted(p.stem for p in snapdir.iterdir()) == sorted(
        [snap1["snapshot"], snap2["snapshot"]]
    )
    send(c, chat_id, model_ref(ep), "Once more")  # same content: stored once
    wait_idle(c)
    assert len(list(snapdir.iterdir())) == 2

    current = c.get(f"{API}/notes/{note['id']}").json()
    assert (
        c.delete(
            f"{API}/notes/{note['id']}", headers={"If-Match": str(current["version"])}
        ).status_code
        == 204
    )
    gone = c.get(f"{API}/chats/{chat_id}").json()
    assert gone["context"][0]["available"] is False
    send(c, chat_id, model_ref(ep), "Without it")
    wait_idle(c)
    assert "--- Note" not in last_user_text()
