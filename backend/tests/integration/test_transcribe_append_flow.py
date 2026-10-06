"""Constitution VI critical flow: transcribe → append to note (existing content preserved,
exactly once, across restarts) — real SQLite, real files."""

from __future__ import annotations

import dataclasses
import json
import time
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from tests import fake_transcriber
from tests.contract.notes_helpers import create_note
from tests.contract.transcription_helpers import (
    API,
    configure,
    finished_recording,
    job,
    make_session,
    note_content,
    run_jobs,
    transcribe,
)
from unihelper.models import TranscriptionJob
from unihelper.transcription import providers

pytestmark = pytest.mark.integration
NOTES = "files/owner/2026/Fall 2026/CS 201/2026-09-28/notes"


def note_path(tmp_data_dir: Path, note: dict) -> Path:  # type: ignore[type-arg]
    return tmp_data_dir / NOTES / note["fileName"]


def start_job(c: TestClient, rec: dict, note: dict, **kw: object) -> dict:  # type: ignore[type-arg]
    r = transcribe(c, rec["id"], noteId=note["id"], **kw)
    assert r.status_code == 202, r.text
    return r.json()  # type: ignore[no-any-return]


def test_transcribe_appends_without_touching_existing_bytes(
    app: FastAPI, owner_client: TestClient, tmp_data_dir: Path
) -> None:
    c = owner_client
    configure(app)
    key = make_session(c)
    original = "# Trees\n\nRed–black trees — **balanced**.\n- ünïcödé ✓\nlast line without newline"
    note = create_note(c, key, "Lecture notes", original)
    path = note_path(tmp_data_dir, note)
    before = path.read_bytes()
    rec1 = finished_recording(c, key, 3)
    first = start_job(c, rec1, note)
    run_jobs(c)
    after = path.read_bytes()
    assert after.startswith(before)  # every existing byte unchanged
    added = after[len(before) :].decode()
    assert added.startswith("\n\n## Transcript — " + rec1["name"] + " · 2026-")
    assert "· 3s\n\nTranscript of " + rec1["fileName"] in added
    assert job(c, first["id"])["appended"]["text"] == added

    # an external edit before the next completion is kept; transcripts accumulate in order
    path.write_bytes(after + b"\nedited outside\n")
    rec2 = finished_recording(c, key, 2)
    start_job(c, rec2, note)
    run_jobs(c)
    final = path.read_bytes()
    assert final.startswith(after + b"\nedited outside\n")
    tail = final[len(after) + len(b"\nedited outside\n") :].decode()
    assert tail.startswith("\n## Transcript — " + rec2["name"])
    assert final.decode().count("## Transcript — ") == 2
    assert note_content(c, note["id"]) == final.decode()


def test_empty_note_and_no_speech(
    app: FastAPI, owner_client: TestClient, tmp_data_dir: Path
) -> None:
    c = owner_client
    configure(app, model="silent")
    key = make_session(c)
    note = create_note(c, key, "Empty")
    rec = finished_recording(c, key)
    start_job(c, rec, note)
    run_jobs(c)
    text = note_path(tmp_data_dir, note).read_text()
    assert text.startswith("## Transcript — ") and text.endswith("\n\n(No speech detected)\n")


def _limit(monkeypatch: pytest.MonkeyPatch, max_bytes: int) -> None:
    spec = dataclasses.replace(providers.VOICE_STUDIO, max_upload_bytes=max_bytes)
    monkeypatch.setitem(providers.SPECS, "voice-studio", spec)


def test_long_webm_is_split_and_joined_in_order(
    app: FastAPI, owner_client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    c = owner_client
    configure(app)
    key = make_session(c)
    note = create_note(c, key, "N")
    rec = finished_recording(c, key, 20)
    _limit(monkeypatch, rec["size"] // 3)
    started = start_job(c, rec, note)
    run_jobs(c)
    done = job(c, started["id"])
    assert done["status"] == "completed" and done["partCount"] >= 3
    calls = fake_transcriber.app.state.calls
    stem = rec["fileName"].rsplit(".", 1)[0]
    assert [x["file"] for x in calls] == [
        f"{stem}.part{i}.webm" for i in range(1, done["partCount"] + 1)
    ]
    content = note_content(c, note["id"])
    positions = [content.index(f".part{i}.webm") for i in range(1, done["partCount"] + 1)]
    assert positions == sorted(positions) and content.count("## Transcript — ") == 1


def _set(app: FastAPI, job_id: str, **values: object) -> None:
    with app.state.sessionmaker() as db:
        row = db.get(TranscriptionJob, job_id)
        for k, v in values.items():
            setattr(row, k, v)
        db.commit()


def test_restart_resumes_after_last_finished_part(
    app: FastAPI, owner_client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    c = owner_client
    configure(app)
    key = make_session(c)
    note = create_note(c, key, "N")
    rec = finished_recording(c, key, 20)
    _limit(monkeypatch, rec["size"] // 2)
    started = start_job(c, rec, note)
    run_jobs(c)  # learn the real part count, then rewind the job as if the server died
    count = job(c, started["id"])["partCount"]
    assert count >= 2
    path_text = note_content(c, note["id"])
    note2 = create_note(c, key, "N2")
    fake_transcriber.app.state.calls.clear()
    with app.state.sessionmaker() as db:
        row = db.get(TranscriptionJob, started["id"])
        source_size = row.source_size
    _set(
        app,
        started["id"],
        status="transcribing",
        note_id=note2["id"],
        part_count=count,
        part_index=1,
        source_size=source_size,
        part_texts_json=json.dumps(["FIRST PART (from before the restart)"]),
        appended_text=None,
        result_hash=None,
        previous_hash=None,
        finished_at=None,
    )
    run_jobs(c)  # recovery requeues it
    assert [x["file"].rsplit(".", 2)[-2] for x in fake_transcriber.app.state.calls] == [
        f"part{i}" for i in range(2, count + 1)
    ]
    resumed = note_content(c, note2["id"])
    assert "FIRST PART (from before the restart)" in resumed and resumed.count("## Transcript") == 1
    assert note_content(c, note["id"]) == path_text  # the first note is untouched


def test_restart_while_appending_appends_exactly_once(
    app: FastAPI, owner_client: TestClient
) -> None:
    c = owner_client
    configure(app)
    key = make_session(c)
    note = create_note(c, key, "N", "start")
    rec = finished_recording(c, key)
    started = start_job(c, rec, note)
    run_jobs(c)
    once = note_content(c, note["id"])
    section = once[len("start\n\n") :]
    # crash after the file write but before the commit: section already in the file
    _set(app, started["id"], status="appending", appended_text=section, finished_at=None)
    run_jobs(c)
    assert note_content(c, note["id"]) == once
    recovered = job(c, started["id"])
    assert recovered["status"] == "completed"
    assert recovered["appended"] is None  # base unknown after a tail-check recovery: clients reload

    # crash before the file write: section not in the file yet → appended once
    note2 = create_note(c, key, "N2", "other")
    _set(app, started["id"], status="appending", note_id=note2["id"], finished_at=None)
    run_jobs(c)
    run_jobs(c)
    assert note_content(c, note2["id"]) == "other\n\n" + section
    assert job(c, started["id"])["appended"]["text"] == "\n\n" + section


def test_deleted_target_note_gets_a_fallback(app: FastAPI, owner_client: TestClient) -> None:
    c = owner_client
    configure(app)
    key = make_session(c)
    note = create_note(c, key, "Doomed")
    rec = finished_recording(c, key)
    started = start_job(c, rec, note)
    r = c.delete(f"{API}/notes/{note['id']}", headers={"If-Match": f'"{note["version"]}"'})
    assert r.status_code == 204, r.text
    run_jobs(c)
    done = job(c, started["id"])
    assert done["status"] == "completed" and done["fallbackNoteCreated"] is True
    assert done["noteName"] == f"Transcript – {rec['name']}"
    assert note_content(c, done["noteId"]).startswith("## Transcript — ")


def test_background_worker_runs_jobs_on_its_own(tmp_path: Path) -> None:
    """The real lifespan worker: woken after the request commits, no test hooks."""
    import httpx

    from tests.conftest import OWNER, _attach_csrf
    from unihelper.config import Settings
    from unihelper.main import create_app

    application = create_app(Settings(data_dir=tmp_path / "data"))
    worker = application.state.transcription_worker
    worker.transport = httpx.ASGITransport(app=fake_transcriber.app)
    with TestClient(application) as client:
        assert client.post(f"{API}/setup/owner", json=OWNER).status_code == 201
        c = _attach_csrf(client)
        configure(application)
        key = make_session(c)
        note = create_note(c, key, "N")
        rec = finished_recording(c, key)
        started = start_job(c, rec, note)
        deadline = time.monotonic() + 15
        while job(c, started["id"])["status"] != "completed":
            assert time.monotonic() < deadline, job(c, started["id"])
            time.sleep(0.1)
        assert note_content(c, note["id"]).startswith("## Transcript — ")
