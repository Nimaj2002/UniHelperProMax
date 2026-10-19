"""009 US4 contract: GET /trash, POST /trash/{id}/restore, DELETE /trash/{id}."""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from tests.conftest import assert_problem
from tests.contract.event_helpers import API, content_for, make_event
from tests.contract.notes_helpers import create_note
from tests.contract.openapi_check import check
from tests.contract.test_classes_sessions_read import new_class_body

pytestmark = pytest.mark.contract


def im(v: int) -> dict[str, str]:
    return {"If-Match": f'"{v}"'}


def deleted_class_and_event(c: TestClient) -> tuple[dict[str, Any], dict[str, Any]]:
    cls = c.post(f"{API}/classes", json=new_class_body()).json()
    key = f"{cls['lineageId']}:2026-09-30"
    create_note(c, key, "Lecture")
    r = c.delete(f"{API}/sessions/{key}", params={"scope": "this"}, headers=im(cls["version"]))
    assert r.status_code == 200, r.text
    ev = make_event(
        c, recurrence={"freq": "weekly", "byWeekday": ["TH"], "end": {"kind": "count", "count": 3}}
    )
    content_for(c, f"{ev['lineageId']}:2026-10-22")
    r = c.delete(
        f"{API}/sessions/{ev['lineageId']}:2026-10-15",
        params={"scope": "all"},
        headers=im(ev["version"]),
    )
    assert r.status_code == 200, r.text
    return cls, ev


def test_list_trash(owner_client: TestClient, make_member: Callable[..., TestClient]) -> None:
    c = owner_client
    assert c.get(f"{API}/trash").json() == []
    cls, ev = deleted_class_and_event(c)
    r = c.get(f"{API}/trash")
    assert r.status_code == 200, r.text
    check(r.json(), "TrashEntry", many=True, spec="009")
    event_entry, class_entry = r.json()  # newest first
    assert event_entry["kind"] == "event" and class_entry["kind"] == "class"
    assert event_entry == {
        **event_entry,
        "label": "AI Seminar",
        "yearName": "2026",
        "semesterName": "Fall 2026",
        "courseName": None,
        "firstDate": "2026-10-15",
        "lastDate": "2026-10-29",
        "startTime": "14:00",
        "endTime": "15:30",
        "occurrenceCount": 3,
        "noteCount": 1,
        "recordingCount": 1,
        "documentCount": 1,
        "purgeError": None,
        "missingFiles": 0,
    }
    assert class_entry["label"] == "CS 201" and class_entry["courseName"] == "CS 201"
    assert class_entry["firstDate"] == class_entry["lastDate"] == "2026-09-30"
    assert [e["kind"] for e in c.get(f"{API}/trash", params={"kind": "class"}).json()] == ["class"]
    assert [e["kind"] for e in c.get(f"{API}/trash", params={"kind": "event"}).json()] == ["event"]
    assert_problem(c.get(f"{API}/trash", params={"kind": "course"}), 422, "validation_failed")
    assert make_member().get(f"{API}/trash").json() == []  # per user


def test_restore(owner_client: TestClient, make_member: Callable[..., TestClient]) -> None:
    c = owner_client
    cls, ev = deleted_class_and_event(c)
    entry = c.get(f"{API}/trash", params={"kind": "event"}).json()[0]
    member = make_member()
    assert_problem(
        member.post(f"{API}/trash/{entry['id']}/restore", headers=im(entry["version"])),
        404,
        "not_found",
    )
    assert_problem(
        c.post(f"{API}/trash/{entry['id']}/restore", headers=im(entry["version"] + 1)),
        412,
        "version_conflict",
    )
    assert_problem(c.post(f"{API}/trash/{entry['id']}/restore"), 428, "if_match_required")
    r = c.post(f"{API}/trash/{entry['id']}/restore", headers=im(entry["version"]))
    assert r.status_code == 200, r.text
    check(r.json(), "RestoreResult", spec="009")
    assert r.json()["kind"] == "event" and r.json()["lineageId"] == ev["lineageId"]
    assert r.json()["firstSessionKey"] == f"{ev['lineageId']}:2026-10-15"
    assert c.get(f"{API}/sessions/{ev['lineageId']}:2026-10-22").status_code == 200
    assert_problem(
        c.post(f"{API}/trash/{entry['id']}/restore", headers=im(entry["version"])),
        404,
        "not_found",
    )


def test_permanent_delete(owner_client: TestClient, make_member: Callable[..., TestClient]) -> None:
    c = owner_client
    deleted_class_and_event(c)
    entry = c.get(f"{API}/trash", params={"kind": "class"}).json()[0]
    assert_problem(
        make_member().delete(f"{API}/trash/{entry['id']}", headers=im(entry["version"])),
        404,
        "not_found",
    )
    assert_problem(
        c.delete(f"{API}/trash/{entry['id']}", headers=im(entry["version"] + 1)),
        412,
        "version_conflict",
    )
    r = c.delete(f"{API}/trash/{entry['id']}", headers=im(entry["version"]))
    assert r.status_code == 204, r.text
    assert [e["kind"] for e in c.get(f"{API}/trash").json()] == ["event"]
    assert_problem(c.delete(f"{API}/trash/{entry['id']}", headers=im(1)), 404, "not_found")


def test_purge_failure_keeps_the_entry(
    app: Any, owner_client: TestClient, tmp_data_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    c = owner_client
    deleted_class_and_event(c)
    entry = c.get(f"{API}/trash", params={"kind": "event"}).json()[0]
    storage = app.state.storage
    locked = "2026/Fall 2026/_Events/2026-10-22 AI Seminar/audios/talk.wav"
    monkeypatch.setattr(storage, "delete_tree", lambda parts: [locked])
    r = c.delete(f"{API}/trash/{entry['id']}", headers=im(entry["version"]))
    body = assert_problem(r, 500, "purge_failed")
    check(body, "PurgeProblem", spec="009")
    assert body["failedPaths"] == [locked]
    (kept,) = c.get(f"{API}/trash", params={"kind": "event"}).json()
    assert kept["id"] == entry["id"] and locked in (kept["purgeError"] or "")
    assert kept["noteCount"] == 1  # rows kept for a retry
    # retry once the files can be removed
    monkeypatch.undo()
    r = c.delete(f"{API}/trash/{entry['id']}", headers=im(kept["version"]))
    assert r.status_code == 204, r.text
    assert not (tmp_data_dir / "files/owner/2026/Fall 2026/_Events/2026-10-22 AI Seminar").exists()


# ---- 012 US5: linked tasks deleted together with their event ---------------------------------


def _trash_event_with_tasks(c: TestClient) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    from tests.contract.test_tasks import link_task

    ev = make_event(
        c, recurrence={"freq": "weekly", "byWeekday": ["TH"], "end": {"kind": "count", "count": 3}}
    )
    lin = ev["lineageId"]
    linked = [link_task(c, f"{lin}:2026-10-15"), link_task(c, f"{lin}:2026-10-22")]
    r = c.delete(
        f"{API}/sessions/{lin}:2026-10-15",
        params={"scope": "all", "linkedTasks": "delete"},
        headers=im(ev["version"]),
    )
    assert r.status_code == 200, r.text
    entry = next(e for e in c.get(f"{API}/trash").json() if e["id"] == r.json()["trashEntryId"])
    return entry, linked


def test_trash_entry_task_count_and_restore_relinks(owner_client: TestClient) -> None:
    from tests.contract.test_task_columns import add_task, tasks
    from tests.contract.test_tasks import task_of

    c = owner_client
    entry, (a, b) = _trash_event_with_tasks(c)
    check(entry, "TrashEntry", spec="009")
    check(entry, "TrashEntryTaskAddition", spec="012")
    assert entry["taskCount"] == 2
    assert task_of(c, a["id"]) is None
    assert_problem(c.get(f"{API}/tasks/{a['id']}"), 404, "not_found")
    assert_problem(c.post(f"{API}/tasks/{a['id']}/restore"), 404, "not_found")  # not an Undo
    add_task(c, "Meanwhile")
    r = c.post(f"{API}/trash/{entry['id']}/restore", headers=im(entry["version"]))
    assert r.status_code == 200, r.text
    ra, rb = task_of(c, a["id"]), task_of(c, b["id"])
    assert ra is not None and rb is not None
    assert ra["event"]["sessionKey"] == a["event"]["sessionKey"]
    assert rb["event"]["sessionKey"] == b["event"]["sessionKey"]
    assert [t["title"] for t in tasks(c)] == ["AI Seminar", "AI Seminar", "Meanwhile"]
    assert [t["position"] for t in tasks(c)] == [0, 1, 2]
    key = a["event"]["sessionKey"]
    assert c.get(f"{API}/sessions/{key}").json()["taskId"] == a["id"]


def test_purge_deletes_the_tasks(app: Any, owner_client: TestClient) -> None:
    from sqlalchemy import func, select

    from unihelper.models import Task, TaskChecklistItem, TaskQuickNote

    c = owner_client
    ev = make_event(c)
    from tests.contract.test_tasks import link_task

    t = link_task(c, f"{ev['lineageId']}:2026-10-15")
    c.put(
        f"{API}/tasks/{t['id']}/checklist",
        json={"items": [{"text": "a", "done": False}]},
        headers=im(1),
    )
    c.post(f"{API}/tasks/{t['id']}/quick-notes", json={"body": "remember"})
    r = c.delete(
        f"{API}/sessions/{ev['lineageId']}:2026-10-15",
        params={"scope": "all", "linkedTasks": "delete"},
        headers=im(ev["version"]),
    )
    assert r.status_code == 200, r.text
    entry = c.get(f"{API}/trash").json()[0]
    assert entry["taskCount"] == 1
    r = c.delete(f"{API}/trash/{entry['id']}", headers=im(entry["version"]))
    assert r.status_code == 204, r.text
    with app.state.sessionmaker() as db:
        for model in (Task, TaskChecklistItem, TaskQuickNote):
            assert db.scalar(select(func.count()).select_from(model)) == 0
