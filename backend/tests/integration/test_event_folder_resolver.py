"""009 T010: event keys resolve like session keys, and their folders are created under
`<year>/<semester>/_Events/<YYYY-MM-DD Title>/` (research R1, R5). Events are inserted directly
here; the API that creates them comes with US1."""

from __future__ import annotations

from datetime import date, time
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from tests.conftest import assert_problem
from tests.contract.notes_helpers import API, create_note
from unihelper.models import Course, EventSeries, SessionFolder, TrashEntry, User

pytestmark = pytest.mark.integration


def _semester(c: TestClient) -> str:
    year = c.post(f"{API}/years", json={"name": "2026"}).json()
    sem = c.post(f"{API}/semesters", json={"yearId": year["id"], "name": "Fall 2026"}).json()
    return str(sem["id"])


def _event(app: Any, semester_id: str, title: str = "AI Seminar", **kw: Any) -> str:
    with app.state.sessionmaker() as db:
        user = db.query(User).one()
        values: dict[str, Any] = {
            "start_date": date(2026, 10, 15),
            "start_time": time(14, 0),
            "end_time": time(15, 30),
            "freq": "none",
            "end_kind": "never",
            **kw,
        }
        s = EventSeries(user_id=user.id, semester_id=semester_id, title=title, **values)
        s.lineage_id = s.id = f"ev-{title}-{values['start_date']}-{kw.get('location', '')}"
        db.add(s)
        db.commit()
        return f"{s.lineage_id}:{values['start_date']}"


def test_event_content_lands_under_events_folder(
    app: Any, owner_client: TestClient, tmp_data_dir: Path
) -> None:
    c = owner_client
    sem = _semester(c)
    key = _event(app, sem)
    assert c.get(f"{API}/sessions/{key}/notes").json() == []  # resolved, no folder yet
    create_note(c, key, "Lecture", "# AI")
    root = tmp_data_dir / "files/owner/2026/Fall 2026/_Events"
    assert (root / "2026-10-15 AI Seminar/notes/Lecture.md").read_text() == "# AI"

    # same date and title → a readable "(2)"; a directory already on disk is never reused
    (root / "2026-10-15 AI Seminar (3)").mkdir()
    for location in ("B", "C"):
        create_note(c, _event(app, sem, location=location), "Notes")
    assert sorted(p.name for p in root.iterdir()) == [
        "2026-10-15 AI Seminar",
        "2026-10-15 AI Seminar (2)",
        "2026-10-15 AI Seminar (3)",
        "2026-10-15 AI Seminar (4)",
    ]
    assert not any((root / "2026-10-15 AI Seminar (3)").iterdir())
    with app.state.sessionmaker() as db:
        kinds = {
            (f.kind, f.course_id is None, f.semester_id == sem) for f in db.query(SessionFolder)
        }
    assert kinds == {("event", True, True)}


def test_course_holding_events_folder_blocks_event_content(
    app: Any, owner_client: TestClient
) -> None:
    c = owner_client
    sem = _semester(c)
    key = _event(app, sem)
    with app.state.sessionmaker() as db:  # a course created before 009 under the reserved name
        user = db.query(User).one()
        db.add(
            Course(
                user_id=user.id,
                semester_id=sem,
                name="_Events",
                name_key="_events",
                folder_name="_Events",
                folder_key="_events",
            )
        )
        db.commit()
    r = c.post(f"{API}/sessions/{key}/notes", json={"name": "Lecture", "content": ""})
    assert_problem(r, 409, "events_folder_conflict")


def test_trashed_folder_is_never_resolved(app: Any, owner_client: TestClient) -> None:
    c = owner_client
    key = _event(app, _semester(c))
    create_note(c, key, "Lecture")
    with app.state.sessionmaker() as db:
        user = db.query(User).one()
        entry = TrashEntry(
            user_id=user.id,
            kind="event",
            lineage_id=key.split(":")[0],
            label="AI Seminar",
            year_name="2026",
            semester_name="Fall 2026",
            first_date=date(2026, 10, 15),
            last_date=date(2026, 10, 15),
            occurrence_count=1,
            reason="delete",
            payload_json="{}",
        )
        db.add(entry)
        db.flush()
        db.query(SessionFolder).update({"trash_entry_id": entry.id})
        db.commit()
    assert_problem(c.get(f"{API}/sessions/{key}/notes"), 404, "not_found")
    assert_problem(
        c.post(f"{API}/sessions/{key}/notes", json={"name": "Again", "content": ""}),
        404,
        "not_found",
    )
