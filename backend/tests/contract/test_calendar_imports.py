"""010 calendar import: upload/preview, rejections, discard, apply and undo (contracts)."""

from __future__ import annotations

from collections.abc import Callable

import pytest
from fastapi.testclient import TestClient

from tests.conftest import assert_problem
from tests.contract.calendar_io_helpers import (
    API,
    apply,
    default_plan,
    group,
    import_file,
    preview_of,
    seed_semester,
    sessions,
    upload_bytes,
    upload_ics,
)
from tests.contract.notes_helpers import create_note
from tests.contract.openapi_check import check
from tests.fixtures.ics.make_large import fixture, too_big, too_many

pytestmark = pytest.mark.contract

NEW_SEMESTER = {"new": {"name": "Fall 2026", "year": {"new": {"name": "2026"}}}}


# ---- upload and preview (US1) -----------------------------------------------------------------


def test_preview_of_google_export(owner_client: TestClient) -> None:
    r = upload_ics(owner_client, "google-fall.ics")
    assert r.status_code == 201, r.text
    body = r.json()
    check(body, "ImportPreview", spec="010")
    assert body["fileName"] == "google-fall.ics" and body["timezone"] == "Europe/Istanbul"
    assert [g["title"] for g in body["groups"]] == ["Linear Algebra", "Physics II", "Dentist"]
    la, phys, dentist = (group(body, t) for t in ("Linear Algebra", "Physics II", "Dentist"))
    assert la["defaults"] == {"selected": True, "importAs": "class", "color": None}
    assert la["repeating"] and la["occurrenceCount"] == 27
    assert la["patterns"] == [{"weekdays": ["MO", "WE"], "startTime": "10:00", "endTime": "11:30"}]
    assert la["location"] == "FENS G032"
    assert la["matches"]["create"] == 27
    assert phys["openEnded"] == {"suggestedEndDate": "2027-01-19"}
    assert dentist["defaults"]["selected"] is False and dentist["defaults"]["importAs"] == "event"
    skipped = {s["title"]: s for s in body["skipped"]}
    assert skipped["Holiday"]["reason"] == "all_day"
    assert skipped["Holiday"]["message"] == "all-day events are not supported yet"
    assert skipped["Old Lab"]["reason"] == "cancelled"


@pytest.mark.parametrize(
    ("data", "status", "code"),
    [
        (fixture("not-ical.ics"), 422, "not_icalendar"),
        (b"   \r\n", 422, "file_empty"),
        (b"", 422, "file_empty"),
    ],
)
def test_rejections(owner_client: TestClient, data: bytes, status: int, code: str) -> None:
    assert_problem(upload_bytes(owner_client, data), status, code)


def test_too_many_events(owner_client: TestClient) -> None:
    assert_problem(upload_bytes(owner_client, too_many()), 422, "too_many_events")


def test_too_large(owner_client: TestClient) -> None:
    assert_problem(upload_bytes(owner_client, too_big()), 413, "file_too_large")
    # a body longer than it declared is refused while streaming
    r = owner_client.post(
        f"{API}/calendar-imports",
        params={"fileName": "x.ics"},
        content=iter([b"x" * 1024 * 1024] * 6),
        headers={"Content-Type": "text/calendar", "Content-Length": "100"},
    )
    assert r.status_code in (413, 422)


def test_length_required(owner_client: TestClient) -> None:
    r = owner_client.post(
        f"{API}/calendar-imports",
        params={"fileName": "x.ics"},
        content=iter([b"BEGIN:VCALENDAR"]),
        headers={"Content-Type": "text/calendar"},
    )
    assert_problem(r, 411, "length_required")


def test_discard_is_idempotent(owner_client: TestClient) -> None:
    preview = preview_of(owner_client, "google-fall.ics")
    for _ in range(2):
        r = owner_client.delete(f"{API}/calendar-imports/{preview['uploadId']}")
        assert r.status_code == 204
    plan = default_plan(preview, NEW_SEMESTER)
    assert_problem(apply(owner_client, preview["uploadId"], plan), 409, "upload_expired")


def test_a_new_upload_replaces_the_previous(owner_client: TestClient) -> None:
    first = preview_of(owner_client, "google-fall.ics")
    preview_of(owner_client, "apple-floating.ics")
    plan = default_plan(first, NEW_SEMESTER)
    assert_problem(apply(owner_client, first["uploadId"], plan), 409, "upload_expired")


# ---- apply (US1) ----------------------------------------------------------------------------


def test_apply_creates_classes_and_reports(owner_client: TestClient) -> None:
    c = owner_client
    preview = preview_of(c, "google-fall.ics")
    plan = default_plan(preview, NEW_SEMESTER, Dentist={"selected": True})
    r = apply(c, preview["uploadId"], plan)
    assert r.status_code == 200, r.text
    body = r.json()
    check(body, "ImportResult", spec="010")
    assert body["classes"] == {"created": 27 + 17, "updated": 0, "skipped": 0}
    assert body["events"] == {"created": 1, "updated": 0, "skipped": 0}
    assert sorted(c["name"] for c in body["coursesCreated"]) == ["Linear Algebra", "Physics II"]
    reasons = {(s["title"], s["reason"]) for s in body["skipped"]}
    assert ("Holiday", "all_day") in reasons and ("Old Lab", "cancelled") in reasons
    assert body["undoAvailable"] is True
    # the staged file is gone
    assert_problem(apply(c, preview["uploadId"], plan), 409, "upload_expired")


def test_apply_validation(owner_client: TestClient) -> None:
    c = owner_client
    preview = preview_of(c, "google-fall.ics")
    uid = preview["uploadId"]
    nothing = default_plan(
        preview, NEW_SEMESTER, **{t: {"selected": False} for t in ("Linear Algebra", "Physics II")}
    )
    assert_problem(apply(c, uid, nothing), 422, "nothing_selected")
    unnamed = default_plan(preview, {"new": {"name": " ", "year": {"new": {"name": "2026"}}}})
    assert_problem(apply(c, uid, unnamed), 422, "destination_required")
    reserved = default_plan(preview, NEW_SEMESTER, **{"Physics II": {"course": {"new": "_Events"}}})
    assert_problem(apply(c, uid, reserved), 422, "reserved_name")
    foreign = default_plan(preview, {"id": "no-such-semester"})
    assert_problem(apply(c, uid, foreign), 404, "not_found")
    bad_course = default_plan(
        preview, NEW_SEMESTER, **{"Physics II": {"course": {"existing": "no-such-course"}}}
    )
    assert_problem(apply(c, uid, bad_course), 404, "not_found")
    # nothing was created by the refused attempts
    assert c.get(f"{API}/course-tree").json() == []


def test_existing_course_is_reused(owner_client: TestClient) -> None:
    c = owner_client
    ids = seed_semester(c, courses=("linear algebra ",))
    result = import_file(c, "google-fall.ics", {"id": ids["semester"]})
    assert [x["name"] for x in result["coursesCreated"]] == ["Physics II"]
    la = [s for s in sessions(c) if s["courseId"] == ids["courses"]["linear algebra "]]
    assert len(la) == 1 + 27


def test_other_users_upload_is_invisible(
    owner_client: TestClient, make_member: Callable[..., TestClient]
) -> None:
    preview = preview_of(owner_client, "google-fall.ics")
    other = make_member()
    plan = default_plan(preview, NEW_SEMESTER)
    assert_problem(apply(other, preview["uploadId"], plan), 409, "upload_expired")
    assert other.delete(f"{API}/calendar-imports/{preview['uploadId']}").status_code == 204
    assert apply(owner_client, preview["uploadId"], plan).status_code == 200


# ---- unsupported rules and edge entries (US4) -------------------------------------------------


def test_unsupported_needs_a_choice(owner_client: TestClient) -> None:
    c = owner_client
    preview = preview_of(c, "unsupported.ics")
    assert all(g["unsupported"] and g["defaults"]["selected"] for g in preview["groups"])
    plan = default_plan(preview, NEW_SEMESTER)
    gym = group(preview, "Gym")
    for g in plan["groups"]:
        g.pop("unsupported")
    r = apply(c, preview["uploadId"], plan)
    problem = assert_problem(r, 422, "choice_required")
    assert {"field": f"/groups/{gym['groupId']}/unsupported", "code": "choice_required",
            "message": "Choose what to do with this repetition."} in problem["errors"]  # fmt: skip
    for g in plan["groups"]:
        g["unsupported"] = "skip" if g["groupId"] == gym["groupId"] else "first_only"
    body = apply(c, preview["uploadId"], plan).json()
    assert body["classes"]["created"] == 3  # one first occurrence per kept group
    assert [s["reason"] for s in body["skipped"] if s["title"] == "Gym"] == ["unsupported_skipped"]


def test_edge_entries(owner_client: TestClient) -> None:
    c = owner_client
    preview = preview_of(c, "edge.ics")
    skipped = {s["title"]: s["reason"] for s in preview["skipped"]}
    assert skipped == {"Conference": "all_day", "Night shift": "all_day"}
    no_title = group(preview, "(No title)")
    assert no_title["titleMissing"] and "title_required" in no_title["issues"]
    assert "reserved_name" in group(preview, "_Events")["issues"]
    markup = group(preview, "<script>alert(1)</script> <b>Bold</b> talk")
    plan = default_plan(
        preview,
        NEW_SEMESTER,
        **{
            "(No title)": {"selected": True, "importAs": "event"},
            markup["title"]: {"selected": True},
            "Duration talk": {"selected": True},
            "_Events": {"selected": False},
        },
    )
    problem = assert_problem(apply(c, preview["uploadId"], plan), 422, "title_required")
    assert problem["errors"][0]["field"] == f"/groups/{no_title['groupId']}/title"
    plan["groups"][[g["groupId"] for g in plan["groups"]].index(no_title["groupId"])]["title"] = (
        "Talk"
    )
    assert apply(c, preview["uploadId"], plan).status_code == 200
    by_title = {s["title"]: s for s in sessions(c) if s["kind"] == "event"}
    talk = by_title[markup["title"]]
    assert talk["links"] == [
        {"label": "Slides.pdf", "url": "https://drive.google.com/file/d/abc/view"},
        {"label": None, "url": "https://example.org/talk"},
    ]
    assert talk["location"] == "<i>Room</i> 5"
    assert by_title["Duration talk"]["end"][11:16] == "15:30"
    assert "Talk" in by_title


# ---- undo (US3) -------------------------------------------------------------------------------


def test_undo(owner_client: TestClient) -> None:
    c = owner_client
    result = import_file(c, "google-fall.ics", NEW_SEMESTER)
    noted = next(s for s in sessions(c) if s["courseName"] == "Physics II")
    create_note(c, noted["key"], "Notes", "# kept")
    r = c.post(f"{API}/calendar-imports/runs/{result['runId']}/undo")
    assert r.status_code == 200, r.text
    body = r.json()
    check(body, "UndoResult", spec="010")
    assert body["removed"]["classes"] == 1  # Linear Algebra; Physics II has a note
    assert body["removed"]["courses"] == 1 and body["removed"]["semesters"] == 0
    kept = {(k["title"], k["message"]) for k in body["kept"]}
    assert ("Physics II", "it has notes, recordings or documents") in kept
    assert ("Physics II", "the course still has classes") in kept
    assert {s["courseName"] for s in sessions(c)} == {"Physics II"}
    assert_problem(c.post(f"{API}/calendar-imports/runs/{result['runId']}/undo"), 409,
                   "undo_unavailable")  # fmt: skip


def test_undo_removes_created_semester_and_year(owner_client: TestClient) -> None:
    c = owner_client
    result = import_file(c, "google-fall.ics", NEW_SEMESTER)
    body = c.post(f"{API}/calendar-imports/runs/{result['runId']}/undo").json()
    assert body["removed"] == {"classes": 2, "events": 0, "courses": 2, "semesters": 1, "years": 1}
    assert c.get(f"{API}/course-tree").json() == []


def test_undo_never_reverts_updates(owner_client: TestClient) -> None:
    c = owner_client
    import_file(c, "google-fall.ics", NEW_SEMESTER)
    second = import_file(c, "google-fall-v2.ics", NEW_SEMESTER)
    assert second["classes"]["updated"] > 0
    body = c.post(f"{API}/calendar-imports/runs/{second['runId']}/undo").json()
    assert body["removed"]["classes"] == 0
    starts = {s["start"][11:16] for s in sessions(c) if s["courseName"] == "Linear Algebra"}
    assert "10:40" in starts


def test_undo_unknown_or_foreign_run(
    owner_client: TestClient, make_member: Callable[..., TestClient]
) -> None:
    result = import_file(owner_client, "google-fall.ics", NEW_SEMESTER)
    assert_problem(owner_client.post(f"{API}/calendar-imports/runs/nope/undo"), 404, "not_found")
    other = make_member()
    assert_problem(other.post(f"{API}/calendar-imports/runs/{result['runId']}/undo"), 404,
                   "not_found")  # fmt: skip
