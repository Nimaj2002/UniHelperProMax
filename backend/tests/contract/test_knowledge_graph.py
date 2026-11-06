"""022 US6: the knowledge graph — extraction worker, reads, search, idea sets, delete, prune."""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient

from tests.conftest import assert_problem
from tests.contract.openapi_check import check
from tests.contract.teacher_helpers import (
    API,
    lesson_setup,
    run_graph,
    script,
    start,
    wait_idle,
)

pytestmark = pytest.mark.contract

EXTRACTION = {
    "ideas": [
        {"key": "i1", "name": "Determinant", "statement": "det(A) measures volume scaling."},
        {"key": "i2", "name": "Zero determinant", "statement": "det(A)=0 means A is singular."},
        {"key": "i3", "name": "Singular matrix", "statement": "A singular matrix has no inverse."},
    ],
    "links": [{"premises": ["i1", "i2"], "conclusion": "i3"}],
}


def _idle(c: TestClient) -> None:
    worker = c.app.state.graph_worker  # type: ignore[attr-defined]
    worker.clock = lambda: datetime.now(UTC) + timedelta(minutes=6)


def _lesson(c: TestClient, key: str, ref: dict[str, str], extraction: Any = EXTRACTION) -> str:
    script("Determinants measure volume.\n", json.dumps(extraction))
    sent = start(c, key, ref)
    wait_idle(c)
    return str(sent["chat"]["id"])


def test_idle_lesson_feeds_the_graph(owner_client: TestClient) -> None:
    c = owner_client
    key, ref = lesson_setup(c)
    chat_id = _lesson(c, key, ref)
    assert run_graph(c) == 0  # not idle yet
    status = c.get(f"{API}/teacher-chats/{chat_id}").json()["graph"]
    assert status == {"status": "pending", "pendingTurns": 1}
    _idle(c)
    assert run_graph(c) == 1
    assert c.get(f"{API}/teacher-chats/{chat_id}").json()["graph"]["status"] == "ok"

    graph = c.get(f"{API}/knowledge-graph")
    assert graph.status_code == 200
    check(graph.json(), "Graph", spec="022")
    names = {i["name"]: i for i in graph.json()["ideas"]}
    assert set(names) == {"Determinant", "Zero determinant", "Singular matrix"}
    [link] = graph.json()["links"]
    assert link["conclusionId"] == names["Singular matrix"]["id"]
    assert sorted(link["premiseIds"]) == sorted(
        [names["Determinant"]["id"], names["Zero determinant"]["id"]]
    )

    detail = c.get(f"{API}/knowledge-graph/ideas/{names['Singular matrix']['id']}")
    assert detail.status_code == 200
    check(detail.json(), "IdeaDetail", spec="022")
    [source] = detail.json()["sources"]
    assert source["chatId"] == chat_id and source["sessionKey"] == key
    assert source["messageId"]  # the teacher answer it came from (FR-030)
    assert len(detail.json()["followsFrom"]) == 1
    assert_problem(c.get(f"{API}/knowledge-graph/ideas/nope"), 404, "not_found")

    # the same idea again merges (SC-008), by existingId or by normalized name
    again = {
        "ideas": [
            {"key": "x", "name": "zero-determinant!", "statement": "Other words."},
            {
                "key": "y",
                "name": "Whatever",
                "statement": "S.",
                "existingId": names["Determinant"]["id"],
            },
        ],
        "links": [],
    }
    _lesson(c, key, ref, again)
    _idle(c)
    run_graph(c)
    ideas = c.get(f"{API}/knowledge-graph").json()["ideas"]
    assert len(ideas) == 3
    zero = next(i for i in ideas if i["id"] == names["Zero determinant"]["id"])
    assert zero["sourceCount"] == 2 and zero["statement"] == "det(A)=0 means A is singular."


def test_search_default_set_and_idea_set(owner_client: TestClient) -> None:
    c = owner_client
    key, ref = lesson_setup(c)
    _lesson(c, key, ref)
    _idle(c)
    run_graph(c)
    found = c.get(f"{API}/knowledge-graph/ideas", params={"q": "singular"})
    assert found.status_code == 200
    check(found.json(), "IdeaSummary", many=True, spec="022")
    assert [i["name"] for i in found.json()] == ["Singular matrix", "Zero determinant"]
    course_id = found.json()[0]["courseIds"][0]
    recent = c.get(
        f"{API}/knowledge-graph/ideas",
        params={"courseId": course_id, "sort": "recent", "limit": 30},
    ).json()
    assert len(recent) == 3

    # a new lesson of the same course starts from those ideas by default (FR-017)
    script("Hi again.\n")
    second = start(c, key, ref, "More please")
    wait_idle(c)
    second_id = second["chat"]["id"]
    full = c.get(f"{API}/teacher-chats/{second_id}").json()
    assert len(full["ideaSet"]) == 3
    from tests import fake_llm

    system = str(fake_llm.STATE["last"]["body"]["messages"][0])
    assert "Singular matrix" in system and "What earlier lessons covered" in system

    keep = [found.json()[0]["id"]]
    r = c.put(f"{API}/teacher-chats/{second_id}/idea-set", json={"ideaIds": keep})
    assert r.status_code == 200, r.text
    check(r.json(), "IdeaSummary", many=True, spec="022")
    assert [i["id"] for i in r.json()] == keep
    r = c.put(f"{API}/teacher-chats/{second_id}/idea-set", json={"ideaIds": ["nope"]})
    assert_problem(r, 422, "unknown_idea")
    r = c.put(
        f"{API}/teacher-chats/{second_id}/idea-set",
        json={"ideaIds": [f"id{i}" for i in range(31)]},
    )
    assert_problem(r, 422, "too_many_ideas")


def test_graph_update_failure_and_retry(owner_client: TestClient) -> None:
    c = owner_client
    key, ref = lesson_setup(c)
    script("Lesson.\n", "this is not json")
    sent = start(c, key, ref)
    wait_idle(c)
    chat_id = sent["chat"]["id"]
    r = c.post(f"{API}/teacher-chats/{chat_id}/graph-update")  # e.g. the tab closed
    assert r.status_code == 202, r.text
    check(r.json(), "GraphStatus", spec="022")
    assert run_graph(c) == 1
    status = c.get(f"{API}/teacher-chats/{chat_id}").json()["graph"]
    assert status["status"] == "failed" and status["error"] == "invalid_output"
    # the lesson itself is unaffected (FR-036)
    assert (
        c.get(f"{API}/teacher-chats/{chat_id}").json()["turns"][0]["answer"]["status"]
        == "completed"
    )
    script(json.dumps(EXTRACTION))
    c.post(f"{API}/teacher-chats/{chat_id}/graph-update")
    run_graph(c)
    assert c.get(f"{API}/teacher-chats/{chat_id}").json()["graph"]["status"] == "ok"
    assert len(c.get(f"{API}/knowledge-graph").json()["ideas"]) == 3

    # practice chats never feed the graph
    script("Problem time.\n")
    practice = start(c, key, ref, "Practice", kind="practice")
    wait_idle(c)
    r = c.post(f"{API}/teacher-chats/{practice['chat']['id']}/graph-update")
    assert_problem(r, 409, "not_lesson")
    full = c.get(f"{API}/teacher-chats/{practice['chat']['id']}").json()
    assert full["graph"] == {"status": None, "pendingTurns": 0}
    assert_problem(c.post(f"{API}/teacher-chats/nope/graph-update"), 404, "not_found")


def test_delete_idea_and_chat_prunes(owner_client: TestClient) -> None:
    c = owner_client
    key, ref = lesson_setup(c)
    chat_id = _lesson(c, key, ref)
    _idle(c)
    run_graph(c)
    ideas = {i["name"]: i["id"] for i in c.get(f"{API}/knowledge-graph").json()["ideas"]}
    assert c.delete(f"{API}/knowledge-graph/ideas/{ideas['Determinant']}").status_code == 204
    graph = c.get(f"{API}/knowledge-graph").json()
    assert len(graph["ideas"]) == 2 and graph["links"] == []  # its link went with it
    assert_problem(
        c.delete(f"{API}/knowledge-graph/ideas/{ideas['Determinant']}"), 404, "not_found"
    )
    # the chat is unchanged
    assert c.get(f"{API}/teacher-chats/{chat_id}").status_code == 200

    assert c.get(f"{API}/teacher-chats/{chat_id}/graph-impact").json() == {"ideas": 2}
    impact = c.get(f"{API}/sessions/{key}/deletion-impact", params={"scope": "this"}).json()
    assert impact["teacherChats"] == 1 and impact["graphIdeas"] == 2
    version = c.get(f"{API}/sessions/{key}/teacher-chats").json()[0]["version"]
    assert c.delete(f"{API}/chats/{chat_id}", headers={"If-Match": str(version)}).status_code == 204
    assert c.get(f"{API}/knowledge-graph").json()["ideas"] == []  # hidden during Undo

    # once the sweep removes the chat for good, its ideas are pruned
    from sqlalchemy import update

    from unihelper.chat import sweep
    from unihelper.models import Chat, KgIdea

    app = c.app  # type: ignore[attr-defined]
    with app.state.sessionmaker() as db:
        db.execute(update(Chat).values(deleted_at="2000-01-01T00:00:00+00:00"))
        db.commit()
        sweep.purge_deleted(db, app.state.storage)
        assert db.query(KgIdea).count() == 0
