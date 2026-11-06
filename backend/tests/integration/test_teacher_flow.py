"""022 T016/T032: a lesson on the real API, SQLite and files — a crash mid-reply keeps the
reply as Interrupted, its complete questions stay answerable, the cut-off block shows as
malformed, and the files never hold a raw block in the transcript."""

from __future__ import annotations

import time
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from tests.conftest import OWNER, _attach_csrf
from tests.contract.teacher_helpers import API, CHOICE, block, lesson_setup, script, start
from unihelper.chat import files
from unihelper.chat.runs import chat_location
from unihelper.models import Chat, ChatRun

pytestmark = pytest.mark.integration


def _sign_in(c: TestClient) -> None:
    r = c.post(f"{API}/auth/login", json={k: OWNER[k] for k in ("username", "password")})
    assert r.status_code == 200, r.text
    _attach_csrf(c)


def _idle(c: TestClient) -> None:
    deadline = time.monotonic() + 10
    while c.get(f"{API}/chat-runs/active").json() and time.monotonic() < deadline:
        time.sleep(0.05)


def test_crash_mid_reply_keeps_questions(app: FastAPI, tmp_data_dir: Path) -> None:
    with TestClient(app) as c:
        assert c.post(f"{API}/setup/owner", json=OWNER).status_code == 201
        _attach_csrf(c)
        key, ref = lesson_setup(c)
        script("Probe.\n" + block("question", CHOICE))
        sent = start(c, key, ref)
        _idle(c)
    # as if the server had died while the teacher was writing a second question
    raw = "Probe.\n" + block("question", CHOICE) + '```uh-question\n{"kind": "text", "prompt": "cu'
    with app.state.sessionmaker() as db:
        run = db.get(ChatRun, sent["runId"])
        chat = db.get(Chat, sent["chat"]["id"])
        assert run is not None and chat is not None
        run.status, chat.generating = "streaming", True
        _user, folder = chat_location(db, chat)
        doc = files.read(app.state.storage, folder, chat.stem)
        answer = files.find_answer(doc, sent["answerId"])
        assert answer is not None
        answer["status"], answer["text"] = "streaming", raw
        files.write(app.state.storage, folder, chat.stem, doc, "Linear Algebra")
        db.commit()
    with TestClient(app) as c:
        _sign_in(c)
        full = c.get(f"{API}/teacher-chats/{sent['chat']['id']}").json()
        answer = full["turns"][0]["answer"]
        assert answer["status"] == "interrupted"
        assert [s["type"] for s in answer["segments"]] == ["markdown", "question", "malformed"]
        assert answer["segments"][2]["reason"] == "unterminated"
        assert full["chat"]["generating"] is False
        script("Thanks.\n")
        r = c.post(
            f"{API}/teacher-chats/{sent['chat']['id']}/answers",
            json={
                "model": ref,
                "answers": [{"questionId": "q1", "choice": 1, "confidence": 75}],
            },
        )
        assert r.status_code == 202, r.text
        assert r.json()["graded"][0]["status"] == "correct"
        _idle(c)
    [md] = list(tmp_data_dir.rglob("chats/*.md"))
    text = md.read_text(encoding="utf-8")
    assert "uh-question" not in text and "Status: correct" in text
    assert "*(Interrupted)*" in text
