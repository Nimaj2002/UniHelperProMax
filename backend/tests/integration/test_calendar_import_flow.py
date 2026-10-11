"""010 calendar import end to end (Constitution I, II, VI): real API, real SQLite, real files.
Imports land as ordinary classes and events, repeated imports update without duplicates,
occurrences with content never move, a failed import changes nothing, undo is safe."""

from __future__ import annotations

import time as clock
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from tests.conftest import assert_problem
from tests.contract.calendar_io_helpers import (
    API,
    apply,
    default_plan,
    import_file,
    preview_of,
    seed_semester,
    sessions,
    upload_bytes,
)
from tests.contract.notes_helpers import create_note
from tests.fixtures.ics.make_large import large_4000
from unihelper.models import (
    CalendarImportRun,
    CalendarImportSource,
    CalendarImportUpload,
    ClassSeries,
    Course,
    Semester,
    SessionException,
)
from unihelper.services import calendar_import_service

pytestmark = pytest.mark.integration

NEW_SEMESTER = {"new": {"name": "Fall 2026", "year": {"new": {"name": "2026"}}}}
FILES = "files/owner/2026/Fall 2026"


def _by_course(c: TestClient, name: str) -> list[dict[str, Any]]:
    return [s for s in sessions(c) if s["courseName"] == name]


def test_google_import(app: Any, owner_client: TestClient, tmp_data_dir: Path) -> None:
    c = owner_client
    ids = seed_semester(c, courses=("linear algebra ",))
    preview = preview_of(c, "google-fall.ics")
    r = apply(c, preview["uploadId"], default_plan(preview, {"id": ids["semester"]}))
    assert r.status_code == 200, r.text
    body = r.json()
    assert [x["name"] for x in body["coursesCreated"]] == ["Physics II"]

    la_id = ids["courses"]["linear algebra "]
    la = [s for s in sessions(c) if s["courseId"] == la_id and s["date"] >= "2026-09-28"]
    assert len(la) == 27
    assert "2026-10-12" not in {s["date"] for s in la}  # the EXDATE
    moved = next(s for s in la if s["date"] == "2026-10-14")
    assert (moved["start"][11:16], moved["end"][11:16]) == ("10:30", "12:00")
    assert {s["start"][11:16] for s in la if s["date"] != "2026-10-14"} == {"10:00"}
    assert la[0]["links"] == [
        {"label": "Google Meet", "url": "https://meet.google.com/abc-defg-hij"},
        {"label": "Course page", "url": "https://lms.example.edu/la"},
    ]
    assert la[0]["location"] == "FENS G032"
    phys = _by_course(c, "Physics II")
    assert len(phys) == 17 and phys[-1]["date"] == "2027-01-19"
    with app.state.sessionmaker() as db:
        course = db.scalar(select(Course).where(Course.name == "Physics II"))
        assert course is not None and course.default_color == "blue"  # first free colour
        assert phys[0]["color"] == "blue"

    # the course timeline lists the imported sessions
    timeline = c.get(f"{API}/courses/{course.id}/timeline")
    assert timeline.status_code == 200 and timeline.text.count(phys[0]["lineageId"]) >= 1

    # a note creates the usual readable folder
    create_note(c, phys[0]["key"], "Lecture", "# one")
    assert (tmp_data_dir / FILES / "Physics II").is_dir()
    assert list((tmp_data_dir / FILES / "Physics II").glob("2026-09-29*/notes/Lecture.md"))

    with app.state.sessionmaker() as db:
        assert len(list(db.scalars(select(CalendarImportRun)))) == 1
        sources = {s.source_uid for s in db.scalars(select(CalendarImportSource))}
        assert sources == {"la-2026-fall@google.com", "phys2-2026-fall@google.com"}
        assert list(db.scalars(select(CalendarImportUpload))) == []
    assert not list((tmp_data_dir / "files" / ".uploads").glob("*.part"))


def test_apply_is_atomic(
    app: Any, owner_client: TestClient, tmp_data_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    c = owner_client
    preview = preview_of(c, "google-fall.ics")
    plan = default_plan(preview, NEW_SEMESTER, Dentist={"selected": True})

    def boom(run: Any, group: Any) -> None:
        if group.title == "Physics II":
            raise RuntimeError("disk on fire")

    monkeypatch.setattr(calendar_import_service, "_after_group", boom)
    assert_problem(apply(c, preview["uploadId"], plan), 500, "import_failed")
    with app.state.sessionmaker() as db:
        assert list(db.scalars(select(ClassSeries))) == []
        assert list(db.scalars(select(Course))) == []
        assert list(db.scalars(select(Semester))) == []
        assert list(db.scalars(select(CalendarImportRun))) == []
        assert len(list(db.scalars(select(CalendarImportUpload)))) == 1  # kept for a retry
    assert not (tmp_data_dir / "files" / "owner" / "2026").exists()

    monkeypatch.setattr(calendar_import_service, "_after_group", None)
    r = apply(c, preview["uploadId"], plan)
    assert r.status_code == 200, r.text


def test_reimport_updates_without_duplicates(owner_client: TestClient) -> None:
    c = owner_client
    first = import_file(c, "google-fall.ics", NEW_SEMESTER)
    count = len(sessions(c))
    second = import_file(c, "google-fall.ics", NEW_SEMESTER)
    assert second["classes"] == {"created": 0, "updated": 0, "skipped": 0}
    assert second["unchanged"] == first["classes"]["created"]
    assert len(sessions(c)) == count
    assert second["coursesCreated"] == []


def test_reimport_v2_freezes_content(app: Any, owner_client: TestClient) -> None:
    c = owner_client
    import_file(c, "google-fall.ics", NEW_SEMESTER)
    noted = next(s for s in _by_course(c, "Linear Algebra") if s["date"] == "2026-10-19")
    create_note(c, noted["key"], "Lecture", "# keep me")
    preview = preview_of(c, "google-fall-v2.ics")
    la = next(g for g in preview["groups"] if g["title"] == "Linear Algebra")
    assert la["matches"]["update"] == 27 and la["matches"]["create"] == 0
    r = apply(c, preview["uploadId"], default_plan(preview, NEW_SEMESTER))
    body = r.json()
    assert body["classes"]["updated"] >= 1
    assert body["classes"]["created"] == 0
    assert any(
        s["reason"] == "has_content" and s["date"] == "2026-10-19" and s["startTime"] == "10:00"
        for s in body["skipped"]
    )
    la_sessions = _by_course(c, "Linear Algebra")
    by_date = {s["date"]: s for s in la_sessions}
    assert by_date["2026-10-19"]["start"][11:16] == "10:00"  # frozen, not moved
    assert by_date["2026-10-21"]["start"][11:16] == "10:40"
    assert len(la_sessions) == 27  # no duplicates
    with app.state.sessionmaker() as db:
        frozen = db.scalar(select(SessionException).where(SessionException.detached.is_(True)))
        assert frozen is not None and str(frozen.original_date) == "2026-10-19"
    # "Midterm" is new and one-time: not selected by default, so not created
    assert "Midterm" not in {s["title"] for s in sessions(c)}


def test_missing_entries_untouched(owner_client: TestClient) -> None:
    c = owner_client
    import_file(c, "google-fall.ics", NEW_SEMESTER)
    before = len(_by_course(c, "Physics II"))
    v2 = Path(__file__).resolve().parents[1] / "fixtures" / "ics" / "google-fall-v2.ics"
    text = v2.read_bytes()
    start = text.index(b"BEGIN:VEVENT\r\nDTSTART;TZID=Europe/Istanbul:20260929T134000")
    end = text.index(b"END:VEVENT\r\n", start) + len(b"END:VEVENT\r\n")
    without_physics = text[:start] + text[end:]
    r = upload_bytes(c, without_physics, "v2.ics")
    assert r.status_code == 201, r.text
    assert apply(c, r.json()["uploadId"], default_plan(r.json(), NEW_SEMESTER)).status_code == 200
    assert len(_by_course(c, "Physics II")) == before


def test_trashed_match_skipped(owner_client: TestClient) -> None:
    c = owner_client
    import_file(c, "google-fall.ics", NEW_SEMESTER)
    phys = _by_course(c, "Physics II")[0]
    r = c.delete(f"{API}/sessions/{phys['key']}", params={"scope": "all"},
                 headers={"If-Match": f'"{phys["seriesVersion"]}"'})  # fmt: skip
    assert r.status_code == 200, r.text
    preview = preview_of(c, "google-fall.ics")
    group = next(g for g in preview["groups"] if g["title"] == "Physics II")
    assert group["matches"]["skip"] == 1
    body = apply(c, preview["uploadId"], default_plan(preview, NEW_SEMESTER)).json()
    assert ("Physics II", "in_trash") in {(s["title"], s["reason"]) for s in body["skipped"]}
    assert _by_course(c, "Physics II") == []


def test_kind_mismatch(owner_client: TestClient) -> None:
    c = owner_client
    import_file(c, "google-fall.ics", NEW_SEMESTER)
    preview = preview_of(c, "google-fall.ics")
    body = apply(
        c,
        preview["uploadId"],
        default_plan(preview, NEW_SEMESTER, **{"Physics II": {"importAs": "event"}}),
    ).json()
    assert {
        "title": "Physics II",
        "reason": "kind_mismatch",
        "message": "already imported as a class",
    }.items() <= next(s for s in body["skipped"] if s["reason"] == "kind_mismatch").items()
    assert body["events"]["created"] == 0


def test_dst_split_lineage(owner_client: TestClient) -> None:
    c = owner_client
    body = import_file(c, "newyork-weekly.ics", NEW_SEMESTER)
    assert body["classes"]["created"] == 6
    assert any("Times change on 2026-11-03" in n for n in body["notes"])
    seminar = _by_course(c, "Remote seminar")
    assert [s["start"][11:16] for s in seminar] == ["17:00", "17:00"] + ["18:00"] * 4
    assert len({s["lineageId"] for s in seminar}) == 1  # one lineage, two segments


def test_event_moved_override_and_orphan(owner_client: TestClient) -> None:
    c = owner_client
    preview = preview_of(c, "edge.ics")
    body = apply(
        c,
        preview["uploadId"],
        default_plan(
            preview,
            NEW_SEMESTER,
            Tutorial={"importAs": "event"},
            **{"_Events": {"selected": False}},
        ),
    ).json()
    tutorial = sorted(
        (s["date"], s["start"][11:16]) for s in sessions(c) if s["title"] == "Tutorial"
    )
    # 4 Mondays, the RDATE Friday and the Wednesday override the rule doesn't produce
    assert tutorial == [
        ("2026-10-05", "16:00"),
        ("2026-10-07", "17:00"),
        ("2026-10-09", "16:00"),
        ("2026-10-12", "16:00"),
        ("2026-10-19", "16:00"),
        ("2026-10-26", "16:00"),
    ]
    assert body["events"]["created"] == 6


def test_large_file_preview_time(owner_client: TestClient) -> None:
    c = owner_client
    started = clock.perf_counter()
    r = upload_bytes(c, large_4000(), "large.ics")
    elapsed = clock.perf_counter() - started
    assert r.status_code == 201, r.text
    assert r.json()["eventCount"] == 4000 and len(r.json()["groups"]) == 25
    assert elapsed < 10  # SC-008 (server side well under; generous for slow CI disks)
