"""014 T063: an answer cut off by a server shutdown or crash is kept as "Interrupted" with the
text of its last checkpoint (FR-037, research R2)."""

from __future__ import annotations

import time

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from tests import fake_llm
from tests.conftest import OWNER, _attach_csrf
from tests.contract.chat_helpers import API, create_endpoint, make_session, model_ref, start_chat
from unihelper.chat import files
from unihelper.chat.runs import chat_location
from unihelper.models import Chat, ChatRun

pytestmark = pytest.mark.integration


def sign_in(c: TestClient) -> TestClient:
    r = c.post(f"{API}/auth/login", json={k: OWNER[k] for k in ("username", "password")})
    assert r.status_code == 200, r.text
    return _attach_csrf(c)


def answer_of(c: TestClient, chat_id: str) -> dict:  # type: ignore[type-arg]
    return c.get(f"{API}/chats/{chat_id}").json()["turns"][0]["versions"][0]["answers"][0]  # type: ignore[no-any-return]


def test_shutdown_interrupts_and_keeps_the_checkpoint(app: FastAPI) -> None:
    fake_llm.STATE.update(slow_tokens=400, slow_delay=0.02)
    with TestClient(app) as c:
        assert c.post(f"{API}/setup/owner", json=OWNER).status_code == 201
        _attach_csrf(c)
        ep = create_endpoint(c, "gemini")
        sent = start_chat(c, make_session(c), model_ref(ep, "slow"))
        time.sleep(2.6)  # past the first 2 s checkpoint
    with TestClient(app) as c:  # restart
        sign_in(c)
        answer = answer_of(c, sent["chat"]["id"])
        assert answer["status"] == "interrupted"
        assert answer["text"].startswith("tok0 ") and answer["text"].count("tok") < 400
        assert c.get(f"{API}/chat-runs/active").json() == []
        assert c.get(f"{API}/chats/{sent['chat']['id']}").json()["generating"] is False


def test_crash_is_recovered_at_startup(app: FastAPI) -> None:
    fake_llm.STATE.update(slow_tokens=3, slow_delay=0)
    with TestClient(app) as c:
        assert c.post(f"{API}/setup/owner", json=OWNER).status_code == 201
        _attach_csrf(c)
        ep = create_endpoint(c, "openai")
        sent = start_chat(c, make_session(c), model_ref(ep))
        deadline = time.monotonic() + 5
        while c.get(f"{API}/chat-runs/active").json() and time.monotonic() < deadline:
            time.sleep(0.05)
    # as if the server had died mid-answer: the run and the answer still say "streaming"
    with app.state.sessionmaker() as db:
        run = db.get(ChatRun, sent["runId"])
        chat = db.get(Chat, sent["chat"]["id"])
        assert run is not None and chat is not None
        run.status, chat.generating = "streaming", True
        _user, folder = chat_location(db, chat)
        doc = files.read(app.state.storage, folder, chat.stem)
        answer = files.find_answer(doc, sent["answerId"])
        assert answer is not None
        answer["status"], answer["text"] = "streaming", "partial text"
        files.write(app.state.storage, folder, chat.stem, doc, "CS 201")
        db.commit()
    with TestClient(app) as c:
        sign_in(c)
        answer = answer_of(c, sent["chat"]["id"])
        assert answer["status"] == "interrupted" and answer["text"] == "partial text"
        with app.state.sessionmaker() as db:
            assert db.get(ChatRun, sent["runId"]).status == "interrupted"  # type: ignore[union-attr]
