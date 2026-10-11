"""009 US3/US4 (Constitution I, II): every class/event deletion goes to the Trash with its files
untouched; Restore brings it back exactly; only a permanent delete removes files — real API,
real SQLite, real files."""

from __future__ import annotations

import hashlib
from datetime import date, time
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from tests.conftest import assert_problem
from tests.contract.event_helpers import API, content_for, make_event
from tests.contract.notes_helpers import create_note
from tests.contract.test_classes_sessions_read import new_class_body
from unihelper.models import (
    Document,
    Note,
    Recording,
    SessionFolder,
    TrashEntry,
    User,
    WorkspaceState,
)

pytestmark = pytest.mark.integration
ROOT = "files/owner/2026/Fall 2026"
WEEKLY = {"freq": "weekly", "byWeekday": ["TH"], "end": {"kind": "count", "count": 4}}


def im(v: int) -> dict[str, str]:
    return {"If-Match": f'"{v}"'}


def tree(folder: Path) -> dict[str, str]:
    """Every file under `folder` with its SHA-256 (byte-identity checks)."""
    return {
        p.relative_to(folder).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
        for p in sorted(folder.rglob("*"))
        if p.is_file()
    }


def sessions(c: TestClient, lineage_id: str) -> dict[str, dict[str, Any]]:
    r = c.get(f"{API}/sessions", params={"from": "2026-09-01", "to": "2026-12-31"})
    return {s["key"]: s for s in r.json() if s["lineageId"] == lineage_id}


def make_class(c: TestClient) -> dict[str, Any]:
    r = c.post(f"{API}/classes", json=new_class_body())  # CS 201, Mon+Wed until 31 Oct
    assert r.status_code == 201, r.text
    return r.json()  # type: ignore[no-any-return]


def trash(c: TestClient, **params: str) -> list[dict[str, Any]]:
    r = c.get(f"{API}/trash", params=params)
    assert r.status_code == 200, r.text
    return r.json()  # type: ignore[no-any-return]


def test_delete_moves_to_trash(app: Any, owner_client: TestClient, tmp_data_dir: Path) -> None:
    c = owner_client
    cls = make_class(c)
    ckey = f"{cls['lineageId']}:2026-09-30"
    content_for(c, ckey)
    semester_id = c.get(f"{API}/courses/{cls['courseId']}").json()["semesterId"]
    ev = make_event(c, semester={"id": semester_id}, recurrence=WEEKLY)
    ekey = f"{ev['lineageId']}:2026-10-22"
    content_for(c, ekey)
    class_dir = tmp_data_dir / ROOT / "CS 201" / "2026-09-30"
    event_dir = tmp_data_dir / ROOT / "_Events" / "2026-10-22 AI Seminar"
    before = {"class": tree(class_dir), "event": tree(event_dir)}
    assert len(before["class"]) == 3 and len(before["event"]) == 3

    r = c.delete(f"{API}/sessions/{ekey}", params={"scope": "all"}, headers=im(ev["version"]))
    assert r.status_code == 200, r.text
    r = c.delete(f"{API}/sessions/{ckey}", params={"scope": "this"}, headers=im(cls["version"]))
    assert r.status_code == 200, r.text

    assert sessions(c, ev["lineageId"]) == {}
    assert ckey not in sessions(c, cls["lineageId"]) and len(sessions(c, cls["lineageId"])) == 9
    timeline = c.get(f"{API}/courses/{cls['courseId']}/timeline").json()["entries"]
    assert ckey not in {e["key"] for e in timeline}
    assert c.get(f"{API}/semesters/{ev['semesterId']}/events/timeline").json() == []
    # files untouched, byte for byte
    assert tree(class_dir) == before["class"] and tree(event_dir) == before["event"]

    with app.state.sessionmaker() as db:
        entries = {e.kind: e for e in db.scalars(select(TrashEntry))}
        assert set(entries) == {"class", "event"}
        assert entries["event"].occurrence_count == 4 and entries["event"].label == "AI Seminar"
        assert entries["class"].occurrence_count == 1 and entries["class"].label == "CS 201"
        for e in entries.values():
            assert (e.note_count, e.recording_count, e.document_count) == (1, 1, 1)
            assert e.reason == "delete"
        folders = {f.kind: f for f in db.scalars(select(SessionFolder))}
        assert folders["class"].trash_entry_id == entries["class"].id
        assert folders["class"].origin_path == "2026/Fall 2026/CS 201/2026-09-30"
        assert folders["event"].origin_path == "2026/Fall 2026/_Events/2026-10-22 AI Seminar"
    # the workspace APIs don't reach content in the Trash
    assert_problem(c.get(f"{API}/sessions/{ckey}/notes"), 404, "not_found")


def test_restore_after_delete_is_exact(owner_client: TestClient, tmp_data_dir: Path) -> None:
    c = owner_client
    cls = make_class(c)
    lin = cls["lineageId"]
    keys_before = sessions(c, lin)
    # a single-session change, then content on a later session
    c.patch(
        f"{API}/sessions/{lin}:2026-10-07",
        params={"scope": "this"},
        json={"location": "Room B"},
        headers=im(cls["version"]),
    )
    key = f"{lin}:2026-10-12"
    content_for(c, key)
    folder = tmp_data_dir / ROOT / "CS 201" / "2026-10-12"
    files = tree(folder)
    before = sessions(c, lin)

    v = before[key]["seriesVersion"]
    r = c.delete(f"{API}/sessions/{key}", params={"scope": "following"}, headers=im(v))
    assert r.status_code == 200, r.text
    assert sorted(sessions(c, lin)) == sorted(k for k in before if k < key)
    (entry,) = trash(c)
    assert entry["occurrenceCount"] == 6 and entry["firstDate"] == "2026-10-12"
    assert entry["lastDate"] == "2026-10-28"
    assert entry["startTime"] == "10:00" and entry["endTime"] == "11:30"

    r = c.post(f"{API}/trash/{entry['id']}/restore", headers=im(entry["version"]))
    assert r.status_code == 200, r.text
    assert r.json()["firstSessionKey"] == key
    assert r.json()["recreated"] == {"year": False, "semester": False, "course": False}
    after = sessions(c, lin)
    assert sorted(after) == sorted(keys_before)  # same keys
    strip = ("seriesVersion", "exceptionVersion")
    assert {k: {f: x for f, x in s.items() if f not in strip} for k, s in after.items()} == {
        k: {f: x for f, x in s.items() if f not in strip} for k, s in before.items()
    }
    assert after[f"{lin}:2026-10-07"]["location"] == "Room B"
    notes = c.get(f"{API}/sessions/{key}/notes")
    assert notes.status_code == 200 and [n["name"] for n in notes.json()] == ["Lecture"]
    assert tree(folder) == files  # nothing moved, nothing rewritten
    assert trash(c) == []


def test_restore_after_the_series_was_edited_again(owner_client: TestClient) -> None:
    c = owner_client
    cls = make_class(c)
    lin = cls["lineageId"]
    create_note(c, f"{lin}:2026-10-14", "Kept")
    v = sessions(c, lin)[f"{lin}:2026-10-14"]["seriesVersion"]
    c.delete(f"{API}/sessions/{lin}:2026-10-14", params={"scope": "following"}, headers=im(v))
    # the remaining series changes time afterwards
    v = sessions(c, lin)[f"{lin}:2026-09-28"]["seriesVersion"]
    r = c.patch(
        f"{API}/sessions/{lin}:2026-09-28",
        params={"scope": "all"},
        json={"startTime": "08:00", "endTime": "09:00"},
        headers=im(v),
    )
    assert r.status_code == 200, r.text
    (entry,) = trash(c)
    r = c.post(f"{API}/trash/{entry['id']}/restore", headers=im(entry["version"]))
    assert r.status_code == 200, r.text
    after = sessions(c, lin)
    restored = [k for k in after if k >= f"{lin}:2026-10-14"]
    assert [k[-10:] for k in restored] == [
        "2026-10-14",
        "2026-10-19",
        "2026-10-21",
        "2026-10-26",
        "2026-10-28",
    ]
    # the restored dates come back as they were (their own segments of the same lineage)
    assert {after[k]["start"][11:16] for k in restored} == {"10:00"}
    assert after[f"{lin}:2026-09-28"]["start"][11:16] == "08:00"
    assert [n["name"] for n in c.get(f"{API}/sessions/{lin}:2026-10-14/notes").json()] == ["Kept"]
    assert c.get(f"{API}/classes/{lin}").json()["segments"][-1]["recurrence"]["freq"] == "none"


def test_restore_one_occurrence_rejoins_its_series(owner_client: TestClient) -> None:
    c = owner_client
    ev = make_event(c, recurrence=WEEKLY)
    lin = ev["lineageId"]
    key = f"{lin}:2026-10-29"
    content_for(c, key)
    c.delete(f"{API}/sessions/{key}", params={"scope": "this"}, headers=im(ev["version"]))
    assert key not in sessions(c, lin)
    (entry,) = trash(c, kind="event")
    assert trash(c, kind="class") == []
    r = c.post(f"{API}/trash/{entry['id']}/restore", headers=im(entry["version"]))
    assert r.status_code == 200, r.text
    s = sessions(c, lin)
    assert key in s and s[key]["isException"] is False and len(s) == 4
    assert len(c.get(f"{API}/events/{lin}").json()["segments"]) == 1


def test_restore_when_the_folder_name_is_now_taken(
    app: Any, owner_client: TestClient, tmp_data_dir: Path
) -> None:
    """A folder of another class now has the trashed folder's name in the same course (and so
    shares its directory): the restored folder gets a unique readable name, only its own files
    move, nothing is overwritten."""
    c = owner_client
    cls = make_class(c)
    key = f"{cls['lineageId']}:2026-09-30"
    create_note(c, key, "Mine", "mine")
    course = c.get(f"{API}/courses/{cls['courseId']}").json()
    assert (
        c.delete(f"{API}/courses/{course['id']}", headers=im(course["version"])).status_code == 204
    )
    again = c.post(f"{API}/classes", json=new_class_body(title="Lab")).json()
    shared = tmp_data_dir / ROOT / "CS 201" / "2026-09-30"
    (shared / "notes" / "Theirs.md").write_text("theirs")
    with app.state.sessionmaker() as db:  # e.g. made before 009 checked names against the disk
        user = db.scalar(select(User))
        assert user is not None
        db.add(
            SessionFolder(
                user_id=user.id,
                course_id=again["courseId"],
                lineage_id=again["lineageId"],
                original_date=date(2026, 9, 30),
                folder_name="2026-09-30",
                folder_key="2026-09-30",
                start_time=time(10, 0),
                end_time=time(11, 30),
            )
        )
        db.commit()
    (entry,) = trash(c)
    r = c.post(f"{API}/trash/{entry['id']}/restore", headers=im(entry["version"]))
    assert r.status_code == 200, r.text
    assert r.json()["movedFolders"] == 1
    moved = tmp_data_dir / ROOT / "CS 201" / "2026-09-30 (2)"
    assert (moved / "notes" / "Mine.md").read_text() == "mine"
    assert (shared / "notes" / "Theirs.md").read_text() == "theirs"
    assert not (shared / "notes" / "Mine.md").exists()
    notes = c.get(f"{API}/sessions/{key}/notes").json()
    assert [n["name"] for n in notes] == ["Mine"]
    r = c.get(f"{API}/notes/{notes[0]['id']}")
    assert r.status_code == 200 and r.json()["content"] == "mine"


def test_permanent_delete_removes_only_that_folder(
    app: Any, owner_client: TestClient, tmp_data_dir: Path
) -> None:
    c = owner_client
    ev = make_event(c, recurrence=WEEKLY)
    lin = ev["lineageId"]
    gone, kept = f"{lin}:2026-10-15", f"{lin}:2026-10-22"
    content_for(c, gone)
    content_for(c, kept)
    assert c.put(f"{API}/workspace/{gone}", json={"openNoteIds": []}).status_code == 200
    events = tmp_data_dir / ROOT / "_Events"
    kept_files = tree(events / "2026-10-22 AI Seminar")
    c.delete(f"{API}/sessions/{gone}", params={"scope": "this"}, headers=im(ev["version"]))
    (entry,) = trash(c)
    # "No" in the dialog sends nothing; a stale version changes nothing either
    assert_problem(
        c.delete(f"{API}/trash/{entry['id']}", headers=im(entry["version"] + 1)),
        412,
        "version_conflict",
    )
    assert (events / "2026-10-15 AI Seminar" / "notes" / "Lecture.md").exists()
    r = c.delete(f"{API}/trash/{entry['id']}", headers=im(entry["version"]))
    assert r.status_code == 204, r.text
    assert not (events / "2026-10-15 AI Seminar").exists()
    assert tree(events / "2026-10-22 AI Seminar") == kept_files
    assert trash(c) == []
    with app.state.sessionmaker() as db:
        keys = {f.session_key for f in db.scalars(select(SessionFolder))}
        assert keys == {kept}
        assert len(list(db.scalars(select(Note)))) == 1
        assert len(list(db.scalars(select(Recording)))) == 1
        assert len(list(db.scalars(select(Document)))) == 1
        assert list(db.scalars(select(WorkspaceState))) == []


def test_missing_files_are_reported_never_recreated(
    owner_client: TestClient, tmp_data_dir: Path
) -> None:
    c = owner_client
    ev = make_event(c)
    key = f"{ev['lineageId']}:2026-10-15"
    content_for(c, key)
    c.delete(f"{API}/sessions/{key}", params={"scope": "all"}, headers=im(ev["version"]))
    folder = tmp_data_dir / ROOT / "_Events" / "2026-10-15 AI Seminar"
    (folder / "notes" / "Lecture.md").unlink()
    (entry,) = trash(c)
    assert entry["missingFiles"] == 1 and entry["noteCount"] == 1
    r = c.post(f"{API}/trash/{entry['id']}/restore", headers=im(entry["version"]))
    assert r.status_code == 200, r.text
    assert not (folder / "notes" / "Lecture.md").exists()
    assert (folder / "documents" / "slides.pdf").exists()


def test_two_deletions_of_one_series_restore_independently(owner_client: TestClient) -> None:
    c = owner_client
    cls = make_class(c)
    lin = cls["lineageId"]
    everything = sorted(sessions(c, lin))
    v = sessions(c, lin)[f"{lin}:2026-10-19"]["seriesVersion"]
    c.delete(f"{API}/sessions/{lin}:2026-10-19", params={"scope": "following"}, headers=im(v))
    v = sessions(c, lin)[f"{lin}:2026-09-28"]["seriesVersion"]
    c.delete(f"{API}/sessions/{lin}:2026-09-28", params={"scope": "all"}, headers=im(v))
    assert sessions(c, lin) == {}
    rest, tail = trash(c)  # newest first
    # the tail first: only its own dates come back
    r = c.post(f"{API}/trash/{tail['id']}/restore", headers=im(tail["version"]))
    assert r.status_code == 200, r.text
    assert [k[-10:] for k in sorted(sessions(c, lin))] == [
        "2026-10-19",
        "2026-10-21",
        "2026-10-26",
        "2026-10-28",
    ]
    r = c.post(f"{API}/trash/{rest['id']}/restore", headers=im(rest["version"]))
    assert r.status_code == 200, r.text
    assert sorted(sessions(c, lin)) == everything  # no date twice, none missing


def test_permanent_delete_forgets_the_import_source(app: Any, owner_client: TestClient) -> None:
    """010 R11: a re-import skips an imported entry while it is in the Trash, and creates it
    again once it has been deleted for good."""
    from tests.contract.calendar_io_helpers import import_file, sessions
    from unihelper.models import CalendarImportSource

    c = owner_client
    semester = {"new": {"name": "Fall 2026", "year": {"new": {"name": "2026"}}}}
    import_file(c, "google-fall.ics", semester)
    phys = next(s for s in sessions(c) if s["courseName"] == "Physics II")
    r = c.delete(f"{API}/sessions/{phys['key']}", params={"scope": "all"},
                 headers=im(phys["seriesVersion"]))  # fmt: skip
    assert r.status_code == 200, r.text
    with app.state.sessionmaker() as db:
        assert db.scalar(select(CalendarImportSource).where(
            CalendarImportSource.lineage_id == phys["lineageId"])) is not None  # fmt: skip
    (entry,) = trash(c)
    assert c.delete(f"{API}/trash/{entry['id']}", headers=im(entry["version"])).status_code == 204
    with app.state.sessionmaker() as db:
        assert db.scalar(select(CalendarImportSource).where(
            CalendarImportSource.lineage_id == phys["lineageId"])) is None  # fmt: skip
    again = import_file(c, "google-fall.ics", semester)
    assert again["classes"]["created"] == 17
