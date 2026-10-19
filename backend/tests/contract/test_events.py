"""009 events: creation and detail (US1), the semester's events timeline and the session APIs
on event keys (US2)."""

from __future__ import annotations

from collections.abc import Callable
from datetime import date, time
from typing import Any

import pytest
from fastapi.testclient import TestClient

from tests.conftest import assert_problem
from tests.contract.document_helpers import upload_pdf
from tests.contract.event_helpers import API, EVENT_DATE, content_for, make_event, new_event_body
from tests.contract.notes_helpers import create_note
from tests.contract.openapi_check import check
from tests.pdf_fixtures import text_pdf
from unihelper.models import SessionException, User

pytestmark = pytest.mark.contract


# ---- US1: create and read ---------------------------------------------------------------------


def test_create_event_inline_and_by_reference(owner_client: TestClient) -> None:
    c = owner_client
    r = c.post(
        f"{API}/events",
        json=new_event_body(
            title="  AI Seminar  ",
            location="FENS L045",
            links=[{"label": "Talk page", "url": "https://ai.example.edu/seminar"}],
        ),
    )
    assert r.status_code == 201, r.text
    body = r.json()
    check(body, "EventCreated", spec="009")
    created = body["created"]
    assert created["lineageId"] == body["lineageId"]
    assert created["semesterId"] == body["semesterId"] and created["yearId"]
    assert created["courseId"] is None

    by_ref = make_event(c, semester={"id": body["semesterId"]}, title="Office hour")
    check(by_ref, "EventCreated", spec="009")
    assert by_ref["semesterId"] == body["semesterId"]
    assert by_ref["created"]["semesterId"] is None and by_ref["created"]["yearId"] is None

    detail = c.get(f"{API}/events/{body['lineageId']}")
    assert detail.status_code == 200, detail.text
    check(detail.json(), "EventDetail", spec="009")
    d = detail.json()
    assert d["semesterName"] == "Fall 2026" and d["yearName"] == "2026"
    assert d["semesterLocked"] is False and d["exceptionCount"] == 0
    (seg,) = d["segments"]
    assert seg["title"] == "AI Seminar"  # trimmed
    assert seg["color"] == "blue"  # default (FR-006)
    assert seg["location"] == "FENS L045"
    assert seg["startTime"] == "14:00" and seg["endTime"] == "15:30"
    assert seg["links"] == [{"label": "Talk page", "url": "https://ai.example.edu/seminar"}]
    assert seg["recurrence"]["freq"] == "none"


def test_create_event_weekly_until_semester_end(owner_client: TestClient) -> None:
    c = owner_client
    ev = make_event(
        c,
        semester={
            "new": {
                "name": "Fall 2026",
                "startDate": "2026-09-21",
                "endDate": "2026-11-06",
                "year": {"new": {"name": "2026"}},
            }
        },
        color="violet",
        recurrence={"freq": "weekly", "byWeekday": ["TH"], "end": {"kind": "semester_end"}},
    )
    r = c.get(f"{API}/sessions", params={"from": "2026-10-01", "to": "2026-12-31"})
    dates = [s["date"] for s in r.json() if s["lineageId"] == ev["lineageId"]]
    assert dates == ["2026-10-15", "2026-10-22", "2026-10-29", "2026-11-05"]  # every Thursday
    seg = c.get(f"{API}/events/{ev['lineageId']}").json()["segments"][0]
    assert seg["color"] == "violet"
    assert seg["recurrence"]["end"]["kind"] == "semester_end"


def test_create_event_errors(
    owner_client: TestClient, make_member: Callable[..., TestClient]
) -> None:
    c = owner_client
    for title in ("", "   ", "x" * 121):
        assert_problem(
            c.post(f"{API}/events", json=new_event_body(title=title)), 422, "validation_failed"
        )
    bad = assert_problem(
        c.post(f"{API}/events", json=new_event_body(endTime="14:00")), 422, "invalid_time_range"
    )
    assert bad["errors"][0]["field"] == "/endTime"
    bad = assert_problem(
        c.post(
            f"{API}/events",
            json=new_event_body(
                recurrence={"freq": "weekly", "byWeekday": ["TH"], "end": {"kind": "semester_end"}}
            ),
        ),
        422,
        "semester_end_missing",
    )
    assert bad["errors"][0]["field"] == "/recurrence/end/kind"
    assert_problem(
        c.post(
            f"{API}/events",
            json=new_event_body(
                recurrence={
                    "freq": "weekly",
                    "byWeekday": ["TH"],
                    "end": {"kind": "count", "count": 501},
                }
            ),
        ),
        422,
        "validation_failed",
    )
    # nothing was created by the refused requests (no stray year/semester)
    assert c.get(f"{API}/course-tree").json() == []

    ev = make_event(c)
    member = make_member()
    assert_problem(
        member.post(f"{API}/events", json=new_event_body(semester={"id": ev["semesterId"]})),
        404,
        "not_found",
    )
    assert_problem(member.get(f"{API}/events/{ev['lineageId']}"), 404, "not_found")
    assert_problem(c.get(f"{API}/events/unknown"), 404, "not_found")


def test_event_key_reads_like_a_session(owner_client: TestClient) -> None:
    c = owner_client
    ev = make_event(c)
    key = f"{ev['lineageId']}:{EVENT_DATE}"
    r = c.get(f"{API}/sessions/{key}")
    assert r.status_code == 200, r.text
    s = r.json()
    assert s["kind"] == "event" and s["title"] == "AI Seminar"
    assert s["courseId"] is None and s["courseName"] is None
    assert s["semesterId"] == ev["semesterId"]
    check(s, "SessionAddition", spec="009")


# ---- US2: the semester's events timeline and the workspace on event keys ----------------------


def _frozen(app: Any, lineage_id: str, day: date, **values: Any) -> None:
    """A `modified` exception written directly (series edits that freeze occurrences come with
    US3): `detached` keeps a date no rule generates."""
    with app.state.sessionmaker() as db:
        user = db.query(User).filter_by(username="owner").one()
        db.add(
            SessionException(
                user_id=user.id, lineage_id=lineage_id, original_date=day, kind="modified", **values
            )
        )
        db.commit()


def test_semester_events_timeline(
    app: Any, owner_client: TestClient, make_member: Callable[..., TestClient]
) -> None:
    c = owner_client
    weekly = make_event(
        c,
        title="Office hour",
        startDate="2020-10-01",  # long past
        startTime="09:00",
        endTime="10:00",
        recurrence={"freq": "weekly", "byWeekday": ["TH"], "end": {"kind": "count", "count": 2}},
    )
    sem = weekly["semesterId"]
    upcoming = make_event(c, semester={"id": sem}, startDate="2099-01-05")
    past_key = f"{weekly['lineageId']}:2020-10-08"
    content_for(c, past_key)
    # a frozen occurrence the rule no longer generates is still listed (research R4)
    _frozen(
        app,
        weekly["lineageId"],
        date(2020, 10, 15),
        detached=True,
        start_time=time(9, 0),
        end_time=time(10, 0),
        title="Office hour (kept)",
    )

    r = c.get(f"{API}/semesters/{sem}/events/timeline")
    assert r.status_code == 200, r.text
    check(r.json(), "EventTimelineEntry", many=True, spec="009")
    entries = r.json()
    assert [e["date"] for e in entries] == ["2020-10-01", "2020-10-08", "2020-10-15", "2099-01-05"]
    assert [e["status"] for e in entries] == ["past", "past", "past", "upcoming"]
    assert entries[2]["title"] == "Office hour (kept)"
    by_key = {e["sessionKey"]: e for e in entries}
    assert (
        by_key[past_key]["noteCount"],
        by_key[past_key]["audioCount"],
        by_key[past_key]["documentCount"],
    ) == (1, 1, 1)
    first = by_key[f"{weekly['lineageId']}:2020-10-01"]
    assert (first["noteCount"], first["audioCount"], first["documentCount"]) == (0, 0, 0)
    assert first["title"] == "Office hour" and first["startTime"] == "09:00"
    assert by_key[f"{upcoming['lineageId']}:2099-01-05"]["title"] == "AI Seminar"

    # the semester lock now applies to the event with content
    assert c.get(f"{API}/events/{weekly['lineageId']}").json()["semesterLocked"] is True
    assert c.get(f"{API}/events/{upcoming['lineageId']}").json()["semesterLocked"] is False

    member = make_member()
    assert_problem(member.get(f"{API}/semesters/{sem}/events/timeline"), 404, "not_found")
    empty = c.post(
        f"{API}/semesters", json={"yearId": c.get(f"{API}/years").json()[0]["id"], "name": "Spring"}
    )
    assert c.get(f"{API}/semesters/{empty.json()['id']}/events/timeline").json() == []


def test_workspace_endpoints_accept_event_keys(owner_client: TestClient) -> None:
    c = owner_client
    ev = make_event(
        c, recurrence={"freq": "weekly", "byWeekday": ["TH"], "end": {"kind": "count", "count": 2}}
    )
    key = f"{ev['lineageId']}:{EVENT_DATE}"
    made = content_for(c, key)

    notes = c.get(f"{API}/sessions/{key}/notes")
    assert notes.status_code == 200 and [n["name"] for n in notes.json()] == ["Lecture"]
    recs = c.get(f"{API}/sessions/{key}/recordings")
    assert recs.status_code == 200 and len(recs.json()) == 1
    docs = c.get(f"{API}/sessions/{key}/documents")
    assert docs.status_code == 200 and [d["name"] for d in docs.json()] == ["slides"]

    # documents are shared by the occurrences of the event series (research R5)
    next_key = f"{ev['lineageId']}:2026-10-22"
    assert [d["id"] for d in c.get(f"{API}/sessions/{next_key}/documents").json()] == [
        made["document"]["id"]
    ]
    other = make_event(c, semester={"id": ev["semesterId"]}, title="Other")
    assert c.get(f"{API}/sessions/{other['lineageId']}:{EVENT_DATE}/documents").json() == []
    # names are unique across the series: a second "slides.pdf" gets a new name
    second = upload_pdf(c, next_key, "slides.pdf", text_pdf())
    assert second.status_code == 201, second.text
    assert second.json()["name"] == "slides (2)"
    renamed = c.patch(
        f"{API}/documents/{second.json()['id']}",
        json={"name": "slides"},
        headers={"If-Match": f'"{second.json()["version"]}"'},
    )
    assert_problem(renamed, 409, "name_taken")

    doc_tab = {"kind": "document", "id": made["document"]["id"]}
    note_tab = {"kind": "note", "id": made["note"]["id"]}
    put = c.put(f"{API}/workspace/{key}", json={"tabs": [note_tab, doc_tab], "active": doc_tab})
    assert put.status_code == 200, put.text
    state = c.get(f"{API}/workspace/{key}").json()
    assert state["tabs"] == [note_tab, doc_tab] and state["active"] == doc_tab

    session = c.get(f"{API}/sessions/{key}").json()
    assert session["kind"] == "event" and session["scheduled"] is True


# ---- US3: edit and delete (FR-016–FR-021) ------------------------------------------------------

WEEKLY = {"freq": "weekly", "byWeekday": ["TH"], "end": {"kind": "count", "count": 4}}
THURSDAYS = ["2026-10-15", "2026-10-22", "2026-10-29", "2026-11-05"]


def _im(v: int) -> dict[str, str]:
    return {"If-Match": f'"{v}"'}


def _occurrences(c: TestClient, lineage_id: str) -> dict[str, dict[str, Any]]:
    """Event occurrences by original date (from the key)."""
    r = c.get(f"{API}/sessions", params={"from": "2026-10-01", "to": "2026-12-31"})
    return {s["key"][-10:]: s for s in r.json() if s["lineageId"] == lineage_id}


def test_edit_this_event_changes_every_field_and_keeps_the_key(owner_client: TestClient) -> None:
    c = owner_client
    ev = make_event(c, recurrence=WEEKLY)
    lin = ev["lineageId"]
    key = f"{lin}:2026-10-22"
    r = c.patch(
        f"{API}/sessions/{key}",
        params={"scope": "this"},
        json={
            "title": "Seminar (moved)",
            "color": "red",
            "date": "2026-10-23",
            "startTime": "16:00",
            "endTime": "17:00",
            "location": "Hall B",
            "links": [{"label": "Notes", "url": "https://notes.example.edu"}],
        },
        headers=_im(ev["version"]),
    )
    assert r.status_code == 200, r.text
    check(r.json(), "ScopeResult")
    check(r.json(), "ScopeResultAddition", spec="009")
    occ = _occurrences(c, lin)
    moved = occ["2026-10-22"]
    assert moved["key"] == key and moved["date"] == "2026-10-23"  # key keeps the original date
    assert moved["title"] == "Seminar (moved)" and moved["color"] == "red"
    assert moved["start"][11:16] == "16:00" and moved["location"] == "Hall B"
    assert moved["links"] == [{"label": "Notes", "url": "https://notes.example.edu"}]
    assert moved["isException"] is True
    assert {d: s["title"] for d, s in occ.items() if d != "2026-10-22"} == {
        d: "AI Seminar" for d in THURSDAYS if d != "2026-10-22"
    }
    # repetition only changes for following/all; the semester never with "this" alone
    assert_problem(
        c.patch(
            f"{API}/sessions/{lin}:2026-10-29",
            params={"scope": "this"},
            json={"recurrence": {"freq": "none"}},
            headers=_im(ev["version"]),
        ),
        422,
        "field_not_allowed",
    )
    assert_problem(
        c.patch(
            f"{API}/sessions/{lin}:2026-10-29",
            params={"scope": "this"},
            json={"startTime": "18:00", "endTime": "17:00"},
            headers=_im(ev["version"]),
        ),
        422,
        "invalid_time_range",
    )
    assert_problem(
        c.patch(
            f"{API}/sessions/{lin}:2026-10-29",
            params={"scope": "this"},
            json={"title": "x" * 121},
            headers=_im(ev["version"]),
        ),
        422,
        "validation_failed",
    )


def test_series_edit_leaves_occurrences_with_content_unchanged(owner_client: TestClient) -> None:
    c = owner_client
    ev = make_event(c, recurrence=WEEKLY)
    lin = ev["lineageId"]
    create_note(c, f"{lin}:2026-10-22", "Minutes", "kept")
    # an individually edited occurrence counts as unchanged too
    c.patch(
        f"{API}/sessions/{lin}:2026-11-05",
        params={"scope": "this"},
        json={"location": "Hall C"},
        headers=_im(ev["version"]),
    )
    r = c.patch(
        f"{API}/sessions/{lin}:2026-10-15",
        params={"scope": "all"},
        json={"title": "AI Talks", "color": "green"},
        headers=_im(ev["version"]),
    )
    assert r.status_code == 200, r.text
    assert r.json()["unchangedCount"] == 2
    occ = _occurrences(c, lin)
    assert {d: (s["title"], s["color"]) for d, s in occ.items()} == {
        "2026-10-15": ("AI Talks", "green"),
        "2026-10-22": ("AI Seminar", "blue"),  # has a note: frozen
        "2026-10-29": ("AI Talks", "green"),
        "2026-11-05": ("AI Seminar", "blue"),  # edited individually: left unchanged (FR-020)
    }
    assert occ["2026-11-05"]["location"] == "Hall C"

    v = occ["2026-10-15"]["seriesVersion"]
    r = c.patch(
        f"{API}/sessions/{lin}:2026-10-29",
        params={"scope": "following"},
        json={"startTime": "09:00", "endTime": "10:00"},
        headers=_im(v),
    )
    assert r.status_code == 200, r.text
    occ = _occurrences(c, lin)
    assert occ["2026-10-22"]["start"][11:16] == "14:00"  # before the split, and frozen
    assert occ["2026-10-29"]["start"][11:16] == "09:00"
    assert occ["2026-11-05"]["start"][11:16] == "14:00"  # frozen by the first series edit
    with_note = c.get(f"{API}/sessions/{lin}:2026-10-22").json()
    assert with_note["title"] == "AI Seminar"


def test_frozen_occurrence_stays_when_its_date_drops_out(owner_client: TestClient) -> None:
    c = owner_client
    ev = make_event(c, recurrence=WEEKLY)
    lin = ev["lineageId"]
    create_note(c, f"{lin}:2026-10-29", "Minutes")
    r = c.patch(
        f"{API}/sessions/{lin}:2026-10-15",
        params={"scope": "all"},
        json={
            "recurrence": {
                "freq": "weekly",
                "byWeekday": ["TH"],
                "end": {"kind": "count", "count": 2},
            }
        },
        headers=_im(ev["version"]),
    )
    assert r.status_code == 200, r.text
    assert r.json()["unchangedCount"] == 1
    occ = _occurrences(c, lin)
    assert sorted(occ) == ["2026-10-15", "2026-10-22", "2026-10-29"]
    assert occ["2026-10-29"]["title"] == "AI Seminar"
    # the frozen occurrence can still be edited and deleted on its own
    frozen = occ["2026-10-29"]
    r = c.patch(
        f"{API}/sessions/{frozen['key']}",
        params={"scope": "this"},
        json={"location": "Annex"},
        headers=_im(frozen["exceptionVersion"]),
    )
    assert r.status_code == 200, r.text
    assert _occurrences(c, lin)["2026-10-29"]["location"] == "Annex"


def test_change_semester(owner_client: TestClient, tmp_data_dir: Any) -> None:
    c = owner_client
    ev = make_event(c, recurrence=WEEKLY)
    lin = ev["lineageId"]
    spring = make_event(
        c,
        title="Other",
        semester={"new": {"name": "Spring 2027", "year": {"new": {"name": "2027"}}}},
    )["semesterId"]
    # an empty folder (its only note deleted) moves with the series
    note = create_note(c, f"{lin}:2026-10-15", "Draft")
    assert c.delete(f"{API}/notes/{note['id']}", headers=_im(note["version"])).status_code == 204
    old = tmp_data_dir / "files/owner/2026/Fall 2026/_Events/2026-10-15 AI Seminar"
    assert old.is_dir()
    r = c.patch(
        f"{API}/sessions/{lin}:2026-10-22",
        params={"scope": "this"},
        json={"semesterId": spring},
        headers=_im(ev["version"]),
    )
    assert r.status_code == 200, r.text
    assert not old.exists()
    assert (tmp_data_dir / "files/owner/2027/Spring 2027/_Events/2026-10-15 AI Seminar").is_dir()
    detail = c.get(f"{API}/events/{lin}").json()
    assert detail["semesterId"] == spring and detail["semesterName"] == "Spring 2027"
    assert {s["semesterId"] for s in _occurrences(c, lin).values()} == {spring}

    # with content the semester is locked (FR-018)
    create_note(c, f"{lin}:2026-10-29", "Minutes")
    detail = c.get(f"{API}/events/{lin}").json()
    assert detail["semesterLocked"] is True
    v = detail["segments"][0]["version"]
    assert_problem(
        c.patch(
            f"{API}/sessions/{lin}:2026-10-15",
            params={"scope": "all"},
            json={"semesterId": ev["semesterId"]},
            headers=_im(v),
        ),
        409,
        "semester_locked",
    )
    assert_problem(
        c.patch(
            f"{API}/sessions/{lin}:2026-10-15",
            params={"scope": "all"},
            json={"semesterId": "nope"},
            headers=_im(v),
        ),
        404,
        "not_found",
    )


def test_session_deletion_impact(owner_client: TestClient) -> None:
    from tests.contract.test_classes_sessions_read import new_class_body

    c = owner_client
    ev = make_event(c, recurrence=WEEKLY)
    lin = ev["lineageId"]
    content_for(c, f"{lin}:2026-10-22")
    r = c.get(f"{API}/sessions/{lin}:2026-10-15/deletion-impact", params={"scope": "following"})
    assert r.status_code == 200, r.text
    check(r.json(), "DeletionImpact", spec="009")
    assert r.json() == {
        "kind": "event",
        "occurrences": 4,
        "notes": 1,
        "recordings": 1,
        "documents": 1,
        "linkedTaskCount": 0,  # 012
    }
    this = c.get(f"{API}/sessions/{lin}:2026-10-29/deletion-impact", params={"scope": "this"})
    assert this.json() == {
        "kind": "event",
        "occurrences": 1,
        "notes": 0,
        "recordings": 0,
        "documents": 0,
        "linkedTaskCount": 0,  # 012
    }
    body = new_class_body()
    body["course"]["new"]["semester"]["new"]["name"] = "Fall 2026 classes"  # has an end date
    cls = c.post(f"{API}/classes", json=body).json()
    create_note(c, f"{cls['lineageId']}:2026-09-30", "Lecture")
    r = c.get(
        f"{API}/sessions/{cls['lineageId']}:2026-09-28/deletion-impact", params={"scope": "all"}
    )
    assert r.status_code == 200, r.text
    check(r.json(), "DeletionImpact", spec="009")
    assert r.json()["kind"] == "class" and r.json()["occurrences"] == 10
    assert r.json()["notes"] == 1
    assert_problem(
        c.get(f"{API}/sessions/{lin}:2026-10-16/deletion-impact", params={"scope": "all"}),
        404,
        "not_found",
    )
    assert_problem(
        c.get(f"{API}/sessions/{lin}:2026-10-15/deletion-impact", params={"scope": "nope"}),
        422,
        "validation_failed",
    )


def test_delete_event_moves_it_to_the_trash(owner_client: TestClient) -> None:
    c = owner_client
    ev = make_event(c, recurrence=WEEKLY)
    lin = ev["lineageId"]
    content_for(c, f"{lin}:2026-10-22")
    r = c.delete(
        f"{API}/sessions/{lin}:2026-10-22", params={"scope": "this"}, headers=_im(ev["version"])
    )
    assert r.status_code == 200, r.text
    check(r.json(), "ScopeResultAddition", spec="009")
    entry_id = r.json()["trashEntryId"]
    assert entry_id
    assert "2026-10-22" not in _occurrences(c, lin)
    assert_problem(c.get(f"{API}/sessions/{lin}:2026-10-22"), 404, "not_found")
    timeline = c.get(f"{API}/semesters/{ev['semesterId']}/events/timeline").json()
    assert [e["date"] for e in timeline] == ["2026-10-15", "2026-10-29", "2026-11-05"]
    (entry,) = c.get(f"{API}/trash").json()
    assert entry["id"] == entry_id and entry["kind"] == "event" and entry["label"] == "AI Seminar"
    assert (entry["noteCount"], entry["recordingCount"], entry["documentCount"]) == (1, 1, 1)
