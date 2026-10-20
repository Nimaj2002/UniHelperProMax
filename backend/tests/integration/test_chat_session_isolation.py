"""014 T086: each session and event keeps its own chats (FR-048); they move with their folder
(FR-051), count as content in deletion confirmations, go to the Trash and come back with their
session, and are removed only by a permanent delete — real API, real SQLite, real files."""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from tests.conftest import assert_problem
from tests.contract.chat_helpers import (
    API,
    create_endpoint,
    make_session,
    model_ref,
    start_chat,
    wait_idle,
)
from tests.contract.event_helpers import EVENT_DATE, make_event

pytestmark = pytest.mark.integration


def im(v: int) -> dict[str, str]:
    return {"If-Match": f'"{v}"'}


def chat_ids(c: TestClient, key: str) -> list[str]:
    r = c.get(f"{API}/sessions/{key}/chats")
    assert r.status_code == 200, r.text
    return [x["id"] for x in r.json()]


def test_chats_belong_to_one_session(
    owner_client: TestClient, make_member: Callable[..., TestClient]
) -> None:
    c = owner_client
    ep = create_endpoint(c, "openai")
    a = make_session(c)
    b = a.replace("2026-09-28", "2026-09-30")  # the Wednesday of the same class
    in_a = [start_chat(c, a, model_ref(ep), f"A{i}")["chat"]["id"] for i in range(3)]
    wait_idle(c)
    in_b = start_chat(c, b, model_ref(ep), "B")["chat"]["id"]
    wait_idle(c)
    assert sorted(chat_ids(c, a)) == sorted(in_a)
    assert chat_ids(c, b) == [in_b]
    member = make_member()
    assert_problem(member.get(f"{API}/sessions/{a}/chats"), 404, "not_found")
    assert_problem(member.get(f"{API}/chats/{in_b}"), 404, "not_found")


def test_event_chats_move_with_the_event(owner_client: TestClient, tmp_data_dir: Path) -> None:
    c = owner_client
    ep = create_endpoint(c, "gemini")
    ev = make_event(c)
    lin = ev["lineageId"]
    key = f"{lin}:{EVENT_DATE}"
    sent = start_chat(c, key, model_ref(ep), "Seminar question")
    wait_idle(c)
    old = tmp_data_dir / "files/owner/2026/Fall 2026/_Events/2026-10-15 AI Seminar/chats"
    assert sorted(p.suffix for p in old.iterdir()) == [".json", ".md"]
    spring = make_event(
        c,
        title="Other",
        semester={"new": {"name": "Spring 2027", "year": {"new": {"name": "2027"}}}},
    )["semesterId"]
    r = c.patch(
        f"{API}/sessions/{key}",
        params={"scope": "all"},
        json={"semesterId": spring},
        headers=im(ev["version"]),
    )
    assert r.status_code == 200, r.text
    new = tmp_data_dir / "files/owner/2027/Spring 2027/_Events/2026-10-15 AI Seminar/chats"
    assert not old.exists() and sorted(p.suffix for p in new.iterdir()) == [".json", ".md"]
    chat = c.get(f"{API}/chats/{sent['chat']['id']}").json()  # found at the new place
    assert chat["turns"][0]["versions"][0]["text"] == "Seminar question"
    assert chat_ids(c, key) == [sent["chat"]["id"]]


def test_deletion_impact_trash_restore_and_purge(
    owner_client: TestClient, tmp_data_dir: Path
) -> None:
    c = owner_client
    ep = create_endpoint(c, "openai")
    ev = make_event(c)
    key = f"{ev['lineageId']}:{EVENT_DATE}"
    titles = [f"Question {i}" for i in range(6)]
    ids: list[str] = []
    for t in titles:
        ids.append(start_chat(c, key, model_ref(ep), t)["chat"]["id"])
        wait_idle(c)
    impact = c.get(f"{API}/sessions/{key}/deletion-impact", params={"scope": "all"}).json()
    assert impact["chats"] == 6
    assert impact["chatTitles"] == list(reversed(titles))[:5]  # newest first, at most 5
    sem = c.get(f"{API}/course-tree").json()[0]["semesters"][0]["semester"]
    assert c.get(f"{API}/semesters/{sem['id']}/deletion-impact").json()["chats"] == 6

    r = c.delete(f"{API}/sessions/{key}", params={"scope": "all"}, headers=im(ev["version"]))
    assert r.status_code == 200, r.text
    assert_problem(c.get(f"{API}/chats/{ids[0]}"), 404, "not_found")
    (entry,) = c.get(f"{API}/trash").json()
    assert entry["chatCount"] == 6
    folder = tmp_data_dir / "files/owner/2026/Fall 2026/_Events/2026-10-15 AI Seminar"
    assert len(list((folder / "chats").glob("*.json"))) == 6  # files untouched in the Trash

    r = c.post(f"{API}/trash/{entry['id']}/restore", headers=im(entry["version"]))
    assert r.status_code == 200, r.text
    assert sorted(chat_ids(c, key)) == sorted(ids)

    ev2: Any = c.get(f"{API}/events/{ev['lineageId']}").json()
    v = ev2["segments"][0]["version"]
    c.delete(f"{API}/sessions/{key}", params={"scope": "all"}, headers=im(v))
    (entry,) = c.get(f"{API}/trash").json()
    assert c.delete(f"{API}/trash/{entry['id']}", headers=im(entry["version"])).status_code == 204
    assert not folder.exists()
    with c.app.state.sessionmaker() as db:  # type: ignore[attr-defined]
        from unihelper.models import Chat

        assert db.query(Chat).count() == 0
