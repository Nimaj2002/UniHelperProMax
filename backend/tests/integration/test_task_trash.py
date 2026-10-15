"""012 US5 (research R5, Clarification 2): linked tasks deleted together with their event go
into the event's Trash entry and come back linked on restore; kept tasks stay unlinked; a
permanent delete removes the tasks with their checklist and quick notes. Real API, real SQLite."""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from tests.contract.event_helpers import API, make_event
from tests.contract.test_task_columns import columns, tasks
from tests.contract.test_tasks import link_task, task_of
from unihelper.models import Task, TaskChecklistItem, TaskQuickNote, User

pytestmark = pytest.mark.integration
WEEKLY = {"freq": "weekly", "byWeekday": ["TH"], "end": {"kind": "count", "count": 3}}


def im(v: int) -> dict[str, str]:
    return {"If-Match": f'"{v}"'}


def delete_occurrence(
    c: TestClient, key: str, scope: str = "this", linked: str | None = None
) -> dict[str, Any]:
    version = c.get(f"{API}/sessions/{key}").json()["seriesVersion"]
    params = {"scope": scope, **({"linkedTasks": linked} if linked else {})}
    r = c.delete(f"{API}/sessions/{key}", params=params, headers=im(version))
    assert r.status_code == 200, r.text
    return r.json()  # type: ignore[no-any-return]


def entry(c: TestClient, entry_id: str) -> dict[str, Any]:
    return next(e for e in c.get(f"{API}/trash").json() if e["id"] == entry_id)


def restore(c: TestClient, entry_id: str) -> None:
    e = entry(c, entry_id)
    r = c.post(f"{API}/trash/{entry_id}/restore", headers=im(e["version"]))
    assert r.status_code == 200, r.text


def test_keep_unlinks_and_restore_leaves_it_unlinked(owner_client: TestClient) -> None:
    c = owner_client
    ev = make_event(c, recurrence=WEEKLY)
    key = f"{ev['lineageId']}:2026-10-22"
    t = link_task(c, key)
    result = delete_occurrence(c, key)
    kept = task_of(c, t["id"])
    assert kept is not None and kept["event"] is None and kept["dueDate"] == "2026-10-22"
    assert entry(c, result["trashEntryId"])["taskCount"] == 0
    restore(c, result["trashEntryId"])
    kept = task_of(c, t["id"])
    assert kept is not None and kept["event"] is None
    assert c.get(f"{API}/sessions/{key}").json()["taskId"] is None


def test_delete_restore_relinks_into_first_column(owner_client: TestClient) -> None:
    c = owner_client
    todo, doing, done = columns(c)
    ev = make_event(c, recurrence=WEEKLY)
    key = f"{ev['lineageId']}:2026-10-22"
    t = link_task(c, key, columnId=doing["id"])
    c.put(
        f"{API}/tasks/{t['id']}/checklist",
        json={"items": [{"text": "Slides", "done": True}]},
        headers=im(1),
    )
    c.post(f"{API}/tasks/{t['id']}/quick-notes", json={"title": "Q", "body": "Ask about RL"})
    result = delete_occurrence(c, key, linked="delete")
    assert task_of(c, t["id"]) is None
    assert entry(c, result["trashEntryId"])["taskCount"] == 1
    # its column is deleted meanwhile (the live tasks go to Done; the trashed one to the first)
    r = c.delete(
        f"{API}/task-columns/{doing['id']}",
        params={"moveTo": done["id"]},
        headers=im(doing["version"]),
    )
    assert r.status_code == 200, r.text
    restore(c, result["trashEntryId"])
    back = task_of(c, t["id"])
    assert back is not None
    assert back["columnId"] == todo["id"] and back["event"]["sessionKey"] == key
    assert back["checklistTotal"] == 1 and back["quickNoteCount"] == 1
    assert c.get(f"{API}/sessions/{key}").json()["taskId"] == t["id"]


def test_restore_when_occurrence_has_another_task(app: Any, owner_client: TestClient) -> None:
    c = owner_client
    ev = make_event(c, recurrence=WEEKLY)
    key = f"{ev['lineageId']}:2026-10-22"
    t = link_task(c, key)
    result = delete_occurrence(c, key, linked="delete")
    # another live task holds the link meanwhile (e.g. made on another device)
    with app.state.sessionmaker() as db:
        user = db.scalar(select(User).where(User.username == "owner"))
        assert user is not None
        other = Task(
            user_id=user.id,
            column_id=t["columnId"],
            position=0,
            title="AI Seminar",
            event_key=key,
        )
        db.add(other)
        db.commit()
        other_id = other.id
    restore(c, result["trashEntryId"])
    back = task_of(c, t["id"])
    assert back is not None and back["event"] is None and back["title"] == "AI Seminar"
    assert c.get(f"{API}/sessions/{key}").json()["taskId"] == other_id


def test_purge_removes_task_checklist_and_notes(app: Any, owner_client: TestClient) -> None:
    c = owner_client
    ev = make_event(c, recurrence=WEEKLY)
    key = f"{ev['lineageId']}:2026-10-15"
    t = link_task(c, key)
    survivor = c.post(f"{API}/tasks", json={"title": "Unrelated"}).json()
    c.put(
        f"{API}/tasks/{t['id']}/checklist",
        json={"items": [{"text": "a", "done": False}, {"text": "b", "done": True}]},
        headers=im(1),
    )
    c.post(f"{API}/tasks/{t['id']}/quick-notes", json={"body": "one"})
    c.post(f"{API}/tasks/{survivor['id']}/quick-notes", json={"body": "stays"})
    result = delete_occurrence(c, key, scope="all", linked="delete")
    e = entry(c, result["trashEntryId"])
    r = c.delete(f"{API}/trash/{e['id']}", headers=im(e["version"]))
    assert r.status_code == 204, r.text
    with app.state.sessionmaker() as db:
        assert db.get(Task, t["id"]) is None
        assert db.scalar(select(func.count()).select_from(TaskChecklistItem)) == 0
        notes = list(db.scalars(select(TaskQuickNote)))
        assert [n.task_id for n in notes] == [survivor["id"]]
    assert [x["id"] for x in tasks(c)] == [survivor["id"]]


def test_semester_delete_puts_each_lineage_tasks_in_its_entry(owner_client: TestClient) -> None:
    c = owner_client
    a = make_event(c, title="Talk A", recurrence=WEEKLY)
    b = make_event(c, title="Talk B", semester={"id": a["semesterId"]})
    ta1 = link_task(c, f"{a['lineageId']}:2026-10-15")
    ta2 = link_task(c, f"{a['lineageId']}:2026-10-29")
    tb = link_task(c, f"{b['lineageId']}:2026-10-15")
    sem = c.get(f"{API}/semesters", params={"yearId": c.get(f"{API}/years").json()[0]["id"]})
    s = sem.json()[0]
    imp = c.get(f"{API}/semesters/{s['id']}/deletion-impact").json()
    assert imp["linkedTaskCount"] == 3
    r = c.delete(
        f"{API}/semesters/{s['id']}", params={"linkedTasks": "delete"}, headers=im(s["version"])
    )
    assert r.status_code == 204, r.text
    assert tasks(c) == []
    entries = {e["label"]: e for e in c.get(f"{API}/trash").json()}
    assert entries["Talk A"]["taskCount"] == 2 and entries["Talk B"]["taskCount"] == 1
    restore(c, entries["Talk B"]["id"])  # recreates the semester by name
    assert [x["id"] for x in tasks(c)] == [tb["id"]]
    assert tasks(c)[0]["event"]["sessionKey"] == f"{b['lineageId']}:2026-10-15"
    restore(c, entries["Talk A"]["id"])
    assert {x["id"] for x in tasks(c)} == {ta1["id"], ta2["id"], tb["id"]}
