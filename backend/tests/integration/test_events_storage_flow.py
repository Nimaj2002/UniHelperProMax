"""009 US2 (Constitution II): event content created through the real API lands in
`<user>/<year>/<semester>/_Events/<YYYY-MM-DD Title>/{notes,audios,documents}` — real SQLite,
real files."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from tests.conftest import assert_problem
from tests.contract.event_helpers import API, EVENT_DATE, content_for, make_event
from tests.contract.notes_helpers import create_note
from tests.contract.transcription_helpers import (
    configure,
    finished_recording,
    job,
    note_content,
    run_jobs,
    transcribe,
)
from unihelper.models import Course, User

pytestmark = pytest.mark.integration
EVENTS = "files/owner/2026/Fall 2026/_Events"


def test_event_content_lands_under_events_folder(
    owner_client: TestClient, tmp_data_dir: Path
) -> None:
    c = owner_client
    ev = make_event(c)
    key = f"{ev['lineageId']}:{EVENT_DATE}"
    content_for(c, key)
    folder = tmp_data_dir / EVENTS / "2026-10-15 AI Seminar"
    assert (folder / "notes/Lecture.md").read_text() == "# Notes"
    assert [p.suffix for p in (folder / "audios").iterdir()] == [".wav"]
    assert (folder / "documents/slides.pdf").is_file()
    # separate from every course folder
    assert sorted(p.name for p in (tmp_data_dir / "files/owner/2026/Fall 2026").iterdir()) == [
        "_Events"
    ]

    # same date and title → "(2)"; a directory already on disk is skipped, never reused
    root = tmp_data_dir / EVENTS
    (root / "2026-10-15 AI Seminar (2)").mkdir()
    (root / "2026-10-15 AI Seminar (2)" / "mine.txt").write_text("hands off")
    again = make_event(c, semester={"id": ev["semesterId"]})
    create_note(c, f"{again['lineageId']}:{EVENT_DATE}", "Second")
    assert (root / "2026-10-15 AI Seminar (3)/notes/Second.md").is_file()
    assert sorted(p.name for p in (root / "2026-10-15 AI Seminar (2)").iterdir()) == ["mine.txt"]


def test_transcription_appends_into_the_event_note(
    app: Any, owner_client: TestClient, tmp_data_dir: Path
) -> None:
    c = owner_client
    configure(app)
    ev = make_event(c, startDate="2020-10-15")  # past: the usual case for recordings
    key = f"{ev['lineageId']}:2020-10-15"
    note = create_note(c, key, "Talk", "# Talk\n")
    path = tmp_data_dir / EVENTS / "2020-10-15 AI Seminar/notes/Talk.md"
    before = path.read_bytes()
    rec = finished_recording(c, key, 3)
    assert (tmp_data_dir / EVENTS / "2020-10-15 AI Seminar/audios" / rec["fileName"]).is_file()
    r = transcribe(c, rec["id"], noteId=note["id"])
    assert r.status_code == 202, r.text
    assert r.json()["courseId"] is None and r.json()["sessionKey"] == key
    run_jobs(c)
    after = path.read_bytes()
    assert after.startswith(before) and b"## Transcript" in after[len(before) :]
    assert job(c, r.json()["id"])["status"] == "completed"
    assert note_content(c, note["id"]) == after.decode()


def test_semester_rename_carries_events_folder(
    owner_client: TestClient, tmp_data_dir: Path
) -> None:
    c = owner_client
    ev = make_event(c)
    key = f"{ev['lineageId']}:{EVENT_DATE}"
    note = create_note(c, key, "Lecture", "kept")
    sem = c.get(f"{API}/course-tree").json()[0]["semesters"][0]["semester"]
    r = c.patch(
        f"{API}/semesters/{sem['id']}",
        json={"name": "Autumn 2026"},
        headers={"If-Match": f'"{sem["version"]}"'},
    )
    assert r.status_code == 200, r.text
    moved = tmp_data_dir / "files/owner/2026/Autumn 2026/_Events/2026-10-15 AI Seminar"
    assert (moved / "notes/Lecture.md").read_text() == "kept"
    assert not (tmp_data_dir / EVENTS).exists()
    assert c.get(f"{API}/notes/{note['id']}").json()["content"] == "kept"
    create_note(c, key, "After rename")
    assert (moved / "notes/After rename.md").is_file()


def test_course_holding_events_folder_blocks_event_content(
    app: Any, owner_client: TestClient
) -> None:
    c = owner_client
    ev = make_event(c)
    with app.state.sessionmaker() as db:  # a course created before 009 under the reserved name
        user = db.query(User).one()
        db.add(
            Course(
                user_id=user.id,
                semester_id=ev["semesterId"],
                name="_Events",
                name_key="_events",
                folder_name="_Events",
                folder_key="_events",
            )
        )
        db.commit()
    r = c.post(
        f"{API}/sessions/{ev['lineageId']}:{EVENT_DATE}/notes",
        json={"name": "Lecture", "content": ""},
    )
    assert_problem(r, 409, "events_folder_conflict")
    tree = c.get(f"{API}/course-tree").json()
    (course,) = tree[0]["semesters"][0]["courses"]
    assert course["reservedNameConflict"] is True
    assert tree[0]["semesters"][0]["eventCount"] == 1


def test_deleting_a_semester_with_event_content_keeps_files(
    owner_client: TestClient, tmp_data_dir: Path
) -> None:
    """A semester delete moves the event to the Trash (US4); the files stay on disk."""
    c = owner_client
    ev = make_event(c)
    create_note(c, f"{ev['lineageId']}:{EVENT_DATE}", "Lecture", "kept")
    sem = c.get(f"{API}/course-tree").json()[0]["semesters"][0]["semester"]
    r = c.delete(f"{API}/semesters/{sem['id']}", headers={"If-Match": f'"{sem["version"]}"'})
    assert r.status_code == 204, r.text
    assert (tmp_data_dir / EVENTS / "2026-10-15 AI Seminar/notes/Lecture.md").read_text() == "kept"
    assert c.get(f"{API}/sessions", params={"from": EVENT_DATE, "to": EVENT_DATE}).json() == []
    (entry,) = c.get(f"{API}/trash").json()
    assert entry["kind"] == "event" and entry["noteCount"] == 1
