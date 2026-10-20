"""014 T060: a message in each style streams its answer and is saved as chat files in the
session folder — JSON plus transcript, title from the message, usage, no key (FR-035, FR-049)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from tests import fake_llm
from tests.contract.chat_helpers import (
    API,
    chat_files,
    create_endpoint,
    events,
    make_session,
    model_ref,
    start_chat,
    wait_idle,
)

pytestmark = pytest.mark.integration
KEY = "sk-chat-stream-KEY-55556666"
MESSAGE = "  What is   amortised analysis, and why does a dynamic array double its capacity? " * 2


@pytest.mark.parametrize("style", ["openai", "anthropic", "gemini"])
def test_send_streams_and_saves(owner_client: TestClient, tmp_data_dir: Path, style: str) -> None:
    c = owner_client
    fake_llm.STATE["required_key"] = KEY
    ep = create_endpoint(c, style, api_key=KEY)
    key = make_session(c)
    sent = start_chat(c, key, model_ref(ep), MESSAGE)
    chat = sent["chat"]
    assert chat["title"] == " ".join(MESSAGE.split())[:60]
    got = events(c, sent["runId"])
    names = [name for _id, name, _data in got]
    assert names[0] == "start" and names[-1] == "done" and "delta" in names and "usage" in names
    assert [i for i, *_ in got] == list(range(1, len(got) + 1))
    text = "".join(d["text"] for _i, n, d in got if n == "delta")
    assert text == "You said: " + MESSAGE
    start = got[0][2]
    assert start["modelLabel"] == "Echo" and start["locality"] == "local"

    wait_idle(c)
    full = c.get(f"{API}/chats/{chat['id']}").json()
    answer = full["turns"][0]["versions"][0]["answers"][0]
    assert answer["status"] == "completed" and answer["text"] == text
    assert answer["usage"] == {"input": 812, "output": 403, "total": 1215}
    assert answer["endpointLabel"] == ep["name"] and answer["modelLabel"] == "Echo"
    assert full["messageCount"] == 2 and full["unseenAnswer"] is True

    paths = chat_files(tmp_data_dir)
    assert [p.suffix for p in paths] == [".json", ".md"]
    assert all("/chats/" in p.as_posix() and "CS 201" in p.as_posix() for p in paths)
    doc = json.loads(paths[0].read_text(encoding="utf-8"))
    assert doc["format"] == "uh-chat/1" and list(doc)[:4] == ["format", "id", "title", "createdAt"]
    transcript = paths[1].read_text(encoding="utf-8")
    assert transcript.startswith(f"# {chat['title']}") and text in transcript
    for p in tmp_data_dir.rglob("*"):
        if p.is_file():
            assert KEY.encode() not in p.read_bytes()

    # the request in this style carried the message (and the system text when set)
    body = fake_llm.STATE["last"]["body"]
    assert "stream" in body or style == "gemini"


def test_replay_from_last_event_id(owner_client: TestClient) -> None:
    c = owner_client
    ep = create_endpoint(c, "openai")
    sent = start_chat(c, make_session(c), model_ref(ep))
    all_events = events(c, sent["runId"])
    replay = events(c, sent["runId"], last_id=2)
    assert replay == all_events[2:]
