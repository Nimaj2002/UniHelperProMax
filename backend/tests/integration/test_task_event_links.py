"""012 US5 (research R4): a linked task follows its event occurrence on every write — scoped
edits, moves, recurrence changes, semester changes and calendar imports — and is unlinked with
its last values when its occurrence is no longer scheduled. Real API, real SQLite."""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient

from tests.contract.calendar_io_helpers import apply, default_plan, upload_bytes
from tests.contract.event_helpers import API, make_event
from tests.contract.test_tasks import link_task, task_of

pytestmark = pytest.mark.integration
WEEKLY = {"freq": "weekly", "byWeekday": ["TH"], "end": {"kind": "count", "count": 4}}


def im(v: int) -> dict[str, str]:
    return {"If-Match": f'"{v}"'}


def edit(c: TestClient, key: str, scope: str, body: dict[str, Any]) -> None:
    s = c.get(f"{API}/sessions/{key}").json()
    version = s["exceptionVersion"] if scope == "this" and s["exceptionVersion"] else None
    version = version or s["seriesVersion"]
    r = c.patch(f"{API}/sessions/{key}", params={"scope": scope}, json=body, headers=im(version))
    assert r.status_code == 200, r.text


def live(c: TestClient, task_id: str) -> dict[str, Any]:
    t = task_of(c, task_id)
    assert t is not None
    return t


def test_this_edit_and_move_follow(owner_client: TestClient) -> None:
    c = owner_client
    ev = make_event(c, recurrence=WEEKLY)
    key = f"{ev['lineageId']}:2026-10-22"
    t = link_task(c, key)
    edit(c, key, "this", {"startTime": "16:00", "endTime": "17:00"})
    after = live(c, t["id"])
    assert (after["dueDate"], after["dueTime"]) == ("2026-10-22", "16:00")
    assert after["event"]["start"] == "16:00"
    edit(c, key, "this", {"date": "2026-10-23", "title": "Moved seminar"})
    after = live(c, t["id"])
    assert (after["title"], after["dueDate"], after["dueTime"]) == (
        "Moved seminar",
        "2026-10-23",
        "16:00",
    )
    assert after["event"]["sessionKey"] == key and after["event"]["date"] == "2026-10-23"


@pytest.mark.parametrize("scope", ["following", "all"])
def test_series_title_change_follows(owner_client: TestClient, scope: str) -> None:
    c = owner_client
    ev = make_event(c, recurrence=WEEKLY)
    lin = ev["lineageId"]
    first = link_task(c, f"{lin}:2026-10-15")
    later = link_task(c, f"{lin}:2026-10-29")
    edit(
        c,
        f"{lin}:2026-10-22",
        scope,
        {"title": "ML Seminar", "startTime": "15:00", "endTime": "16:00"},
    )
    assert live(c, later["id"])["title"] == "ML Seminar"
    assert live(c, later["id"])["dueTime"] == "15:00"
    expected = "ML Seminar" if scope == "all" else "AI Seminar"
    assert live(c, first["id"])["title"] == expected


def test_weekday_change_unlinks_with_last_values(owner_client: TestClient) -> None:
    c = owner_client
    ev = make_event(c, recurrence=WEEKLY)
    lin = ev["lineageId"]
    t = link_task(c, f"{lin}:2026-10-22")
    edit(
        c,
        f"{lin}:2026-10-15",
        "all",
        {
            "recurrence": {
                "freq": "weekly",
                "byWeekday": ["FR"],
                "end": {"kind": "count", "count": 4},
            }
        },
    )
    after = live(c, t["id"])
    assert after["event"] is None
    assert (after["title"], after["dueDate"], after["dueTime"]) == (
        "AI Seminar",
        "2026-10-22",
        "14:00",
    )


def test_semester_change_keeps_link(owner_client: TestClient) -> None:
    c = owner_client
    ev = make_event(c, recurrence=WEEKLY)
    key = f"{ev['lineageId']}:2026-10-15"
    t = link_task(c, key)
    year = c.get(f"{API}/years").json()[0]
    other = c.post(f"{API}/semesters", json={"yearId": year["id"], "name": "Spring"}).json()
    edit(c, key, "all", {"semesterId": other["id"]})
    after = live(c, t["id"])
    assert after["event"]["sessionKey"] == key and after["dueDate"] == "2026-10-15"
    assert c.get(f"{API}/sessions/{key}").json()["taskId"] == t["id"]


ICS = """BEGIN:VCALENDAR\r
VERSION:2.0\r
PRODID:-//UniHelper tests//EN\r
BEGIN:VEVENT\r
UID:guest-talk-1@example.test\r
DTSTAMP:20260901T000000Z\r
DTSTART:{start}\r
DTEND:{end}\r
SUMMARY:{title}\r
END:VEVENT\r
END:VCALENDAR\r
"""
NEW_SEMESTER = {"new": {"name": "Fall 2026", "year": {"new": {"name": "2026"}}}}


def _import(c: TestClient, title: str, start: str, end: str) -> None:
    data = ICS.format(title=title, start=start, end=end).encode()
    r = upload_bytes(c, data, "talk.ics")
    assert r.status_code == 201, r.text
    preview = r.json()
    overrides = {g["title"]: {"selected": True, "importAs": "event"} for g in preview["groups"]}
    r = apply(c, preview["uploadId"], default_plan(preview, NEW_SEMESTER, **overrides))
    assert r.status_code == 200, r.text


def test_calendar_import_edit_follows(owner_client: TestClient) -> None:
    c = owner_client
    _import(c, "Guest talk", "20261020T110000Z", "20261020T120000Z")  # 14:00 Istanbul
    (s,) = c.get(f"{API}/sessions", params={"from": "2026-10-01", "to": "2026-10-31"}).json()
    t = link_task(c, s["key"])
    assert (t["title"], t["dueTime"]) == ("Guest talk", "14:00")
    _import(c, "Guest talk (room 2)", "20261020T130000Z", "20261020T140000Z")
    after = live(c, t["id"])
    assert after["event"]["sessionKey"] == s["key"]
    assert (after["title"], after["dueDate"], after["dueTime"]) == (
        "Guest talk (room 2)",
        "2026-10-20",
        "16:00",
    )
