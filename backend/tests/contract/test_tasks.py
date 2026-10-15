"""Tasks (012 T012, T054): create, list, details, move, edit, checklist, delete + restore."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import pytest
from fastapi.testclient import TestClient

from tests.conftest import assert_problem
from tests.contract.event_helpers import EVENT_DATE, make_event
from tests.contract.openapi_check import check
from tests.contract.test_task_columns import add_task, columns, tasks, v

pytestmark = pytest.mark.contract
API = "/api/v1"


def link_task(c: TestClient, key: str, **body: Any) -> dict[str, Any]:
    """POST /tasks linked to the event occurrence `key`."""
    r = c.post(f"{API}/tasks", json={"eventKey": key, **body})
    assert r.status_code == 201, r.text
    check(r.json(), "Task", spec="012")
    return r.json()  # type: ignore[no-any-return]


def task_of(c: TestClient, task_id: str) -> dict[str, Any] | None:
    """The live task with this id, or None (deleted, in the Trash or gone)."""
    return next((t for t in tasks(c) if t["id"] == task_id), None)


def course(c: TestClient, name: str = "Algorithms") -> dict[str, Any]:
    year = c.post(f"{API}/years", json={"name": "2026"}).json()
    sem = c.post(f"{API}/semesters", json={"yearId": year["id"], "name": "Fall"}).json()
    r = c.post(f"{API}/courses", json={"semesterId": sem["id"], "name": name})
    assert r.status_code in (200, 201), r.text
    return r.json()  # type: ignore[no-any-return]


def detail(c: TestClient, task_id: str) -> dict[str, Any]:
    r = c.get(f"{API}/tasks/{task_id}")
    assert r.status_code == 200, r.text
    check(r.json(), "TaskDetail", spec="012")
    return r.json()  # type: ignore[no-any-return]


def move(c: TestClient, task: dict[str, Any], column_id: str, index: int) -> dict[str, Any]:
    r = c.post(
        f"{API}/tasks/{task['id']}/move",
        json={"columnId": column_id, "index": index},
        headers=v(task["version"]),
    )
    assert r.status_code == 200, r.text
    check(r.json(), "Task", spec="012")
    return r.json()  # type: ignore[no-any-return]


def by_title(c: TestClient) -> dict[str, dict[str, Any]]:
    return {t["title"]: t for t in tasks(c)}


def order(c: TestClient, column_id: str) -> list[str]:
    return [t["title"] for t in tasks(c) if t["columnId"] == column_id]


# ---- create / read -------------------------------------------------------------------------


def test_create_title_only_lands_at_end_of_first_column(owner_client: TestClient) -> None:
    c = owner_client
    first = add_task(c, "Read ch. 4")
    check(first, "Task", spec="012")
    r = c.post(f"{API}/tasks", json={"title": "  Problem set 3  "})
    assert r.status_code == 201, r.text
    t = r.json()
    todo = columns(c)[0]
    assert t["columnId"] == todo["id"] and t["position"] == 1 and t["title"] == "Problem set 3"
    assert t["description"] == "" and t["dueDate"] is None and t["courseId"] is None
    assert t["event"] is None and t["completedAt"] is None and t["version"] == 1
    assert (t["checklistDone"], t["checklistTotal"], t["quickNoteCount"]) == (0, 0, 0)
    assert columns(c)[0]["taskCount"] == 2


def test_create_with_all_fields(owner_client: TestClient) -> None:
    c = owner_client
    crs = course(c)
    done = columns(c)[2]
    r = c.post(
        f"{API}/tasks",
        json={
            "title": "Submit report",
            "columnId": done["id"],
            "courseId": crs["id"],
            "dueDate": "2026-10-20",
            "dueTime": "23:59",
            "description": "PDF only",
        },
    )
    assert r.status_code == 201, r.text
    t = r.json()
    check(t, "Task", spec="012")
    assert (t["courseId"], t["courseName"], t["courseColor"]) == (
        crs["id"],
        "Algorithms",
        crs["defaultColor"],
    )
    assert (t["dueDate"], t["dueTime"], t["description"]) == ("2026-10-20", "23:59", "PDF only")
    assert t["columnId"] == done["id"] and t["completedAt"] is not None  # done column


def test_create_validation(
    owner_client: TestClient, make_member: Callable[..., TestClient]
) -> None:
    c = owner_client
    assert_problem(
        c.post(f"{API}/tasks", json={"title": "x", "dueTime": "10:00"}), 422, "time_without_date"
    )
    assert_problem(c.post(f"{API}/tasks", json={}), 422, "validation_failed")
    assert_problem(c.post(f"{API}/tasks", json={"title": ""}), 422, "validation_failed")
    assert_problem(c.post(f"{API}/tasks", json={"title": "x" * 201}), 422, "validation_failed")
    assert_problem(c.post(f"{API}/tasks", json={"title": "x", "foo": 1}), 422, "validation_failed")
    assert_problem(
        c.post(f"{API}/tasks", json={"title": "x", "columnId": "nope"}), 404, "not_found"
    )
    other = make_member()
    foreign = course(other)
    assert_problem(
        c.post(f"{API}/tasks", json={"title": "x", "courseId": foreign["id"]}), 404, "not_found"
    )


def test_list_order_and_detail(owner_client: TestClient) -> None:
    c = owner_client
    todo, doing, _ = columns(c)
    add_task(c, "B", doing["id"])
    add_task(c, "A1", todo["id"])
    add_task(c, "A2", todo["id"])
    r = c.get(f"{API}/tasks")
    check(r.json(), "Task", many=True, spec="012")
    assert [(t["title"], t["position"]) for t in r.json()] == [("A1", 0), ("A2", 1), ("B", 0)]
    d = detail(c, r.json()[0]["id"])
    assert d["title"] == "A1" and d["checklist"] == []
    assert_problem(c.get(f"{API}/tasks/nope"), 404, "not_found")


def test_other_users_task_is_not_found(
    owner_client: TestClient, make_member: Callable[..., TestClient]
) -> None:
    t = add_task(owner_client, "Mine")
    other = make_member()
    assert other.get(f"{API}/tasks").json() == []
    assert_problem(other.get(f"{API}/tasks/{t['id']}"), 404, "not_found")
    assert_problem(
        other.patch(f"{API}/tasks/{t['id']}", json={"title": "x"}, headers=v(1)), 404, "not_found"
    )
    assert_problem(other.delete(f"{API}/tasks/{t['id']}", headers=v(1)), 404, "not_found")


# ---- move ----------------------------------------------------------------------------------


def test_move_within_and_across_columns(owner_client: TestClient) -> None:
    c = owner_client
    todo, doing, done = columns(c)
    for name in ("A", "B", "C"):
        add_task(c, name)
    t = by_title(c)
    moved = move(c, t["C"], todo["id"], 0)  # to the top of the same column
    assert moved["position"] == 0 and moved["version"] == 2
    assert order(c, todo["id"]) == ["C", "A", "B"]
    assert [x["position"] for x in tasks(c)] == [0, 1, 2]
    assert by_title(c)["A"]["version"] == 1  # siblings keep their versions

    moved = move(c, by_title(c)["A"], doing["id"], 5)  # index clamped to the end
    assert moved["columnId"] == doing["id"] and moved["position"] == 0
    assert moved["completedAt"] is None
    assert order(c, todo["id"]) == ["C", "B"] and order(c, doing["id"]) == ["A"]
    assert [x["position"] for x in tasks(c) if x["columnId"] == todo["id"]] == [0, 1]

    # into the done column: completion recorded with the column it came from
    moved = move(c, by_title(c)["A"], done["id"], 0)
    assert moved["completedAt"] is not None and moved["previousColumnId"] == doing["id"]
    # leaving it clears completion
    moved = move(c, moved, todo["id"], 1)
    assert moved["completedAt"] is None
    assert order(c, todo["id"]) == ["C", "A", "B"]


def test_move_errors(owner_client: TestClient) -> None:
    c = owner_client
    todo = columns(c)[0]
    t = add_task(c, "A")
    body = {"columnId": todo["id"], "index": 0}
    assert_problem(
        c.post(f"{API}/tasks/{t['id']}/move", json=body, headers=v(7)), 412, "version_conflict"
    )
    assert_problem(c.post(f"{API}/tasks/{t['id']}/move", json=body), 428, "if_match_required")
    assert_problem(
        c.post(f"{API}/tasks/{t['id']}/move", json={**body, "columnId": "x"}, headers=v(1)),
        404,
        "not_found",
    )
    assert_problem(
        c.post(f"{API}/tasks/{t['id']}/move", json={**body, "index": -1}, headers=v(1)),
        422,
        "validation_failed",
    )


# ---- edit ----------------------------------------------------------------------------------


def test_patch_fields(owner_client: TestClient) -> None:
    c = owner_client
    crs = course(c)
    t = add_task(c, "Draft")
    r = c.patch(
        f"{API}/tasks/{t['id']}",
        json={
            "title": "Final",
            "description": "Two pages",
            "dueDate": "2026-11-01",
            "dueTime": "09:30",
            "courseId": crs["id"],
        },
        headers=v(1),
    )
    assert r.status_code == 200, r.text
    check(r.json(), "TaskDetail", spec="012")
    d = r.json()
    assert (d["title"], d["description"], d["dueDate"], d["dueTime"]) == (
        "Final",
        "Two pages",
        "2026-11-01",
        "09:30",
    )
    assert d["courseName"] == "Algorithms" and d["version"] == 2
    # clearing the date clears its time; course back to personal
    r = c.patch(f"{API}/tasks/{t['id']}", json={"dueDate": None, "courseId": None}, headers=v(2))
    assert r.status_code == 200, r.text
    assert (r.json()["dueDate"], r.json()["dueTime"], r.json()["courseId"]) == (None, None, None)
    assert_problem(
        c.patch(f"{API}/tasks/{t['id']}", json={"dueTime": "10:00"}, headers=v(3)),
        422,
        "time_without_date",
    )
    assert_problem(
        c.patch(f"{API}/tasks/{t['id']}", json={}, headers=v(3)), 422, "validation_failed"
    )
    assert_problem(
        c.patch(f"{API}/tasks/{t['id']}", json={"title": None}, headers=v(3)),
        422,
        "validation_failed",
    )
    assert_problem(
        c.patch(f"{API}/tasks/{t['id']}", json={"courseId": "nope"}, headers=v(3)), 404, "not_found"
    )
    assert_problem(
        c.patch(f"{API}/tasks/{t['id']}", json={"title": "x"}, headers=v(1)),
        412,
        "version_conflict",
    )
    assert_problem(c.patch(f"{API}/tasks/{t['id']}", json={"title": "x"}), 428, "if_match_required")


def test_linked_task_title_and_due_are_read_only(owner_client: TestClient) -> None:
    c = owner_client
    ev = make_event(c)
    t = link_task(c, f"{ev['lineageId']}:{EVENT_DATE}")
    for field, value in (("title", "Mine"), ("dueDate", "2026-10-20"), ("dueTime", "09:00")):
        assert_problem(
            c.patch(f"{API}/tasks/{t['id']}", json={field: value}, headers=v(t["version"])),
            409,
            "linked_field_read_only",
        )
    r = c.patch(
        f"{API}/tasks/{t['id']}",
        json={"description": "Bring slides", "courseId": None},
        headers=v(t["version"]),
    )
    assert r.status_code == 200, r.text
    check(r.json(), "TaskDetail", spec="012")
    assert r.json()["description"] == "Bring slides" and r.json()["title"] == "AI Seminar"


def test_replace_checklist_keeps_ids_and_order(owner_client: TestClient) -> None:
    c = owner_client
    t = add_task(c, "Lab")
    r = c.put(
        f"{API}/tasks/{t['id']}/checklist",
        json={
            "items": [
                {"text": "Read", "done": True},
                {"text": "Write", "done": False},
                {"text": "Submit", "done": False},
            ]
        },
        headers=v(1),
    )
    assert r.status_code == 200, r.text
    check(r.json(), "TaskDetail", spec="012")
    d = r.json()
    assert [i["text"] for i in d["checklist"]] == ["Read", "Write", "Submit"]
    assert d["version"] == 2 and (d["checklistDone"], d["checklistTotal"]) == (1, 3)
    read, write, _submit = d["checklist"]
    r = c.put(
        f"{API}/tasks/{t['id']}/checklist",
        json={
            "items": [
                {"id": write["id"], "text": "Write up", "done": True},
                {"id": read["id"], "text": "Read", "done": True},
                {"text": "Review", "done": False},
            ]
        },
        headers=v(2),
    )
    assert r.status_code == 200, r.text
    d = r.json()
    assert [(i["id"], i["text"]) for i in d["checklist"][:2]] == [
        (write["id"], "Write up"),
        (read["id"], "Read"),
    ]
    assert d["checklist"][2]["text"] == "Review" and d["checklist"][2]["id"] not in {
        read["id"],
        write["id"],
    }
    assert d["version"] == 3 and (d["checklistDone"], d["checklistTotal"]) == (2, 3)
    assert detail(c, t["id"])["checklist"] == d["checklist"]
    listed = by_title(c)["Lab"]
    assert (listed["checklistDone"], listed["checklistTotal"]) == (2, 3)
    assert_problem(
        c.put(f"{API}/tasks/{t['id']}/checklist", json={"items": []}, headers=v(2)),
        412,
        "version_conflict",
    )
    assert_problem(
        c.put(
            f"{API}/tasks/{t['id']}/checklist",
            json={"items": [{"text": "", "done": False}]},
            headers=v(3),
        ),
        422,
        "validation_failed",
    )
    r = c.put(f"{API}/tasks/{t['id']}/checklist", json={"items": []}, headers=v(3))
    assert r.status_code == 200 and r.json()["checklist"] == []


# ---- delete / restore ------------------------------------------------------------------------


def test_delete_and_restore(owner_client: TestClient) -> None:
    c = owner_client
    todo = columns(c)[0]
    for name in ("A", "B", "C"):
        add_task(c, name)
    b = by_title(c)["B"]
    r = c.put(
        f"{API}/tasks/{b['id']}/checklist",
        json={"items": [{"text": "step", "done": True}]},
        headers=v(1),
    )
    note = c.post(f"{API}/tasks/{b['id']}/quick-notes", json={"body": "remember"}).json()
    b = by_title(c)["B"]

    assert_problem(c.delete(f"{API}/tasks/{b['id']}", headers=v(1)), 412, "version_conflict")
    assert_problem(c.delete(f"{API}/tasks/{b['id']}"), 428, "if_match_required")
    r = c.delete(f"{API}/tasks/{b['id']}", headers=v(b["version"]))
    assert r.status_code == 204, r.text
    assert order(c, todo["id"]) == ["A", "C"]
    assert [t["position"] for t in tasks(c)] == [0, 1]
    assert_problem(c.get(f"{API}/tasks/{b['id']}"), 404, "not_found")

    r = c.post(f"{API}/tasks/{b['id']}/restore")
    assert r.status_code == 200, r.text
    check(r.json(), "Task", spec="012")
    assert r.json()["position"] == 1 and r.json()["quickNoteCount"] == 1
    assert order(c, todo["id"]) == ["A", "B", "C"]
    d = detail(c, b["id"])
    assert [i["text"] for i in d["checklist"]] == ["step"]
    assert [n["id"] for n in c.get(f"{API}/tasks/{b['id']}/quick-notes").json()] == [note["id"]]

    assert_problem(c.post(f"{API}/tasks/{b['id']}/restore"), 404, "not_found")  # not deleted
    assert_problem(c.post(f"{API}/tasks/nope/restore"), 404, "not_found")


def test_restore_when_column_was_deleted(owner_client: TestClient) -> None:
    c = owner_client
    todo, doing, _ = columns(c)
    t = add_task(c, "Orphan", doing["id"])
    add_task(c, "Stays", todo["id"])
    assert c.delete(f"{API}/tasks/{t['id']}", headers=v(1)).status_code == 204
    r = c.delete(f"{API}/task-columns/{doing['id']}", headers=v(doing["version"]))
    assert r.status_code == 200, r.text  # empty: deleted tasks do not block it
    r = c.post(f"{API}/tasks/{t['id']}/restore")
    assert r.status_code == 200, r.text
    assert r.json()["columnId"] == todo["id"] and r.json()["position"] == 1
    assert order(c, todo["id"]) == ["Stays", "Orphan"]


# ---- linked to an event occurrence (US5) ---------------------------------------------------


def test_create_linked_to_event_occurrence(owner_client: TestClient) -> None:
    c = owner_client
    weekly = {"freq": "weekly", "byWeekday": ["TH"], "end": {"kind": "count", "count": 3}}
    ev = make_event(c, recurrence=weekly)
    key = f"{ev['lineageId']}:2026-10-22"
    doing = columns(c)[1]
    t = link_task(c, key, columnId=doing["id"], description="Prepare questions")
    assert t["title"] == "AI Seminar" and t["columnId"] == doing["id"]
    assert (t["dueDate"], t["dueTime"]) == ("2026-10-22", "14:00")
    assert t["event"] == {
        "sessionKey": key,
        "title": "AI Seminar",
        "date": "2026-10-22",
        "start": "14:00",
    }
    assert t["description"] == "Prepare questions" and t["courseId"] is None
    # a title or due date in the body is not used: they follow the event
    other = link_task(c, f"{ev['lineageId']}:2026-10-29", title="Ignored", dueDate="2027-01-01")
    assert other["title"] == "AI Seminar" and other["dueDate"] == "2026-10-29"
    # sessions show the link (taskId)
    rows = c.get(f"{API}/sessions", params={"from": "2026-10-15", "to": "2026-10-31"}).json()
    assert {s["date"]: s["taskId"] for s in rows} == {
        "2026-10-15": None,
        "2026-10-22": t["id"],
        "2026-10-29": other["id"],
    }


def test_create_linked_errors(
    owner_client: TestClient, make_member: Callable[..., TestClient]
) -> None:
    from tests.contract.test_classes_sessions_read import new_class_body

    c = owner_client
    ev = make_event(c)
    key = f"{ev['lineageId']}:{EVENT_DATE}"
    link_task(c, key)
    assert_problem(c.post(f"{API}/tasks", json={"eventKey": key}), 409, "event_has_task")
    body = new_class_body()
    body["course"]["new"]["semester"]["new"]["name"] = "Fall 2026 classes"  # has an end date
    cls = c.post(f"{API}/classes", json=body).json()
    assert_problem(
        c.post(f"{API}/tasks", json={"eventKey": f"{cls['lineageId']}:2026-09-28"}),
        422,
        "not_an_event",
    )
    for missing in (f"{ev['lineageId']}:2026-10-16", "nope:2026-10-15", "garbage"):
        assert_problem(c.post(f"{API}/tasks", json={"eventKey": missing}), 404, "not_found")
    other = make_member()
    foreign = make_event(other)
    assert_problem(
        c.post(f"{API}/tasks", json={"eventKey": f"{foreign['lineageId']}:{EVENT_DATE}"}),
        404,
        "not_found",
    )
    # deleting the task frees the occurrence
    t = task_of(c, tasks(c)[0]["id"])
    assert t is not None
    assert c.delete(f"{API}/tasks/{t['id']}", headers=v(t["version"])).status_code == 204
    link_task(c, key)
    # restoring the deleted task while the occurrence has another one: restored unlinked
    r = c.post(f"{API}/tasks/{t['id']}/restore")
    assert r.status_code == 200, r.text
    assert r.json()["event"] is None and r.json()["title"] == "AI Seminar"


# ---- CSV export (US7) ----------------------------------------------------------------------


def test_export_csv(owner_client: TestClient) -> None:
    import csv
    import io
    import re

    c = owner_client
    crs = course(c, "Çalışma Yöntemleri")
    t = add_task(c, 'Read "ch. 4", then summarize')
    c.patch(
        f"{API}/tasks/{t['id']}",
        json={"description": "line 1\nline 2", "courseId": crs["id"], "dueDate": "2026-11-02"},
        headers=v(1),
    )
    c.put(
        f"{API}/tasks/{t['id']}/checklist",
        json={"items": [{"text": "Skim", "done": True}, {"text": "Notes", "done": False}]},
        headers=v(2),
    )
    c.post(f"{API}/tasks/{t['id']}/quick-notes", json={"title": "Idea", "body": "Use diagrams"})
    ev = make_event(c)
    link_task(c, f"{ev['lineageId']}:{EVENT_DATE}", columnId=columns(c)[2]["id"])

    r = c.get(f"{API}/tasks/export")
    assert r.status_code == 200, r.text
    assert r.headers["content-type"] == "text/csv; charset=utf-8"
    assert r.headers["cache-control"] == "no-store"
    disposition = r.headers["content-disposition"]
    assert re.fullmatch(
        r'attachment; filename="UniHelperProMax-tasks-\d{4}-\d{2}-\d{2}\.csv"; '
        r"filename\*=UTF-8''UniHelperProMax-tasks-\d{4}-\d{2}-\d{2}\.csv",
        disposition,
    ), disposition
    assert r.content.startswith(b"\xef\xbb\xbf")
    rows = list(csv.reader(io.StringIO(r.content.decode("utf-8-sig"), newline="")))
    assert rows[0] == [
        "Title",
        "Description",
        "Column",
        "Due date",
        "Due time",
        "Course",
        "Linked event",
        "Checklist",
        "Quick notes",
        "Completed at",
    ]
    first, linked = rows[1], rows[2]
    assert first[:7] == [
        'Read "ch. 4", then summarize',
        "line 1\nline 2",
        "To do",
        "2026-11-02",
        "",
        "Çalışma Yöntemleri",
        "",
    ]
    assert first[7] == "[x] Skim\n[ ] Notes" and first[8] == "Idea: Use diagrams"
    assert first[9] == ""
    assert linked[0] == "AI Seminar" and linked[2] == "Done"
    assert linked[3:5] == [EVENT_DATE, "14:00"]
    assert linked[6] == f"AI Seminar ({EVENT_DATE})" and linked[9] != ""
