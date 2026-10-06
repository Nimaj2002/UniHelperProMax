from __future__ import annotations

import time
from collections.abc import Callable
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from tests import fake_transcriber
from tests.conftest import assert_problem
from tests.contract.notes_helpers import create_note
from tests.contract.openapi_check import check
from tests.contract.transcription_helpers import (
    API,
    KEY,
    configure,
    finished_recording,
    job,
    make_session,
    note_content,
    run_jobs,
    transcribe,
)

pytestmark = pytest.mark.contract


def setup_job(app: FastAPI, c: TestClient, **config: object) -> tuple[dict, dict, dict]:  # type: ignore[type-arg]
    configure(app, **config)  # type: ignore[arg-type]
    key = make_session(c)
    note = create_note(c, key, "Lecture notes", "keep me")
    rec = finished_recording(c, key)
    started = transcribe(c, rec["id"], noteId=note["id"]).json()
    return rec, note, started


@pytest.mark.parametrize(
    ("model", "category", "settings"),
    [
        ("fail-401", "invalid_credentials", True),
        ("fail-404-model", "unknown", True),
        ("fail-413", "file_rejected", False),
        ("fail-429-quota", "quota_exceeded", False),
        ("fail-503", "unavailable", False),
    ],
)
def test_failures_leave_the_note_unchanged(
    app: FastAPI, owner_client: TestClient, model: str, category: str, settings: bool
) -> None:
    c = owner_client
    _rec, note, started = setup_job(app, c, model=model)
    run_jobs(c)
    failed = job(c, started["id"])
    check(failed, "TranscriptionJob", spec="004")
    assert failed["status"] == "failed" and failed["errorCategory"] == category
    assert failed["settingsRelated"] is settings and failed["errorMessage"]
    assert note_content(c, note["id"]) == "keep me"


def test_wrong_key_never_leaks(
    app: FastAPI, owner_client: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    c = owner_client
    fake_transcriber.app.state.required_key = "sk-the-right-one"
    _rec, _note, started = setup_job(
        app, c, provider="openai-compatible", model="whisper-1", api_key=KEY
    )
    run_jobs(c)
    r = c.get(f"{API}/transcriptions/{started['id']}")
    assert r.json()["errorCategory"] == "invalid_credentials"
    assert KEY not in r.text and KEY not in caplog.text
    assert fake_transcriber.app.state.calls[-1]["authorized"] is True


def test_transient_errors_are_retried_in_job(app: FastAPI, owner_client: TestClient) -> None:
    c = owner_client
    _rec, note, started = setup_job(app, c, model="fail-429-once")
    run_jobs(c)
    assert job(c, started["id"])["status"] == "completed"
    assert len(fake_transcriber.app.state.calls) == 2
    assert "## Transcript — " in note_content(c, note["id"])


def test_retry(app: FastAPI, owner_client: TestClient) -> None:
    c = owner_client
    rec, note, started = setup_job(app, c, model="fail-401")
    assert_problem(c.post(f"{API}/transcriptions/{started['id']}/retry"), 409, "job_not_retryable")
    run_jobs(c)
    configure(app, model="whisper-1")  # "fix the settings"
    r = c.post(f"{API}/transcriptions/{started['id']}/retry")
    assert r.status_code == 202, r.text
    again = r.json()
    check(again, "TranscriptionJob", spec="004")
    assert again["status"] == "queued" and again["attempts"] == 2 and again["errorCategory"] is None
    assert again["noteId"] == note["id"]
    other = finished_recording(c, rec["sessionKey"], 2)
    assert_problem(transcribe(c, other["id"], noteId=note["id"]), 409, "transcription_in_progress")
    run_jobs(c)
    assert job(c, started["id"])["status"] == "completed"
    assert note_content(c, note["id"]).startswith("keep me\n\n## Transcript")
    assert_problem(c.post(f"{API}/transcriptions/{started['id']}/retry"), 409, "job_not_retryable")


def test_cancel_queued_and_finished(app: FastAPI, owner_client: TestClient) -> None:
    c = owner_client
    _rec, note, started = setup_job(app, c)
    r = c.post(f"{API}/transcriptions/{started['id']}/cancel")
    assert r.status_code == 200 and r.json()["status"] == "cancelled"
    check(r.json(), "TranscriptionJob", spec="004")
    run_jobs(c)
    assert note_content(c, note["id"]) == "keep me"
    assert_problem(c.post(f"{API}/transcriptions/{started['id']}/cancel"), 409, "job_finished")
    assert c.post(f"{API}/transcriptions/{started['id']}/retry").status_code == 202


def test_cancel_running_job_appends_nothing(app: FastAPI, owner_client: TestClient) -> None:
    c = owner_client
    _rec, note, started = setup_job(app, c, model="slow-3")
    worker = app.state.transcription_worker
    future = c.portal.start_task_soon(worker.run_pending)  # type: ignore[union-attr]
    deadline = time.monotonic() + 10
    while job(c, started["id"])["status"] != "transcribing":
        assert time.monotonic() < deadline
        time.sleep(0.05)
    r = c.post(f"{API}/transcriptions/{started['id']}/cancel")
    assert r.status_code == 200 and r.json()["cancelRequested"] is True
    future.result(timeout=10)
    assert job(c, started["id"])["status"] == "cancelled"
    assert note_content(c, note["id"]) == "keep me"
    assert c.get(f"{API}/transcriptions/active").json() is None


def test_unseen_and_seen(app: FastAPI, owner_client: TestClient) -> None:
    c = owner_client
    _rec, _note, started = setup_job(app, c)
    assert c.get(f"{API}/transcriptions", params={"unseen": "true"}).json() == []
    run_jobs(c)
    unseen = c.get(f"{API}/transcriptions", params={"unseen": "true"}).json()
    check(unseen, "TranscriptionJob", many=True, spec="004")
    assert [j["id"] for j in unseen] == [started["id"]]
    r = c.post(f"{API}/transcriptions/{started['id']}/seen")
    assert r.status_code == 204
    assert c.get(f"{API}/transcriptions", params={"unseen": "true"}).json() == []
    assert_problem(c.post(f"{API}/transcriptions/nope/seen"), 404, "not_found")


def test_recording_delete_blocked_while_transcribing(
    app: FastAPI, owner_client: TestClient
) -> None:
    c = owner_client
    rec, _note, started = setup_job(app, c)
    headers = {"If-Match": f'"{rec["version"]}"'}
    assert_problem(
        c.delete(f"{API}/recordings/{rec['id']}", headers=headers), 409, "recording_transcribing"
    )
    run_jobs(c)
    assert c.delete(f"{API}/recordings/{rec['id']}", headers=headers).status_code == 204
    assert c.get(f"{API}/transcriptions/{started['id']}").status_code == 404  # cascades


# ---- US2: new note ------------------------------------------------------------------------


def test_new_note_is_created_before_queuing(app: FastAPI, owner_client: TestClient) -> None:
    c = owner_client
    configure(app)
    key = make_session(c)
    rec = finished_recording(c, key)
    create_note(c, key, "Transcript")
    assert_problem(transcribe(c, rec["id"], newNoteName="transcript"), 409, "name_taken")
    assert transcribe(c, rec["id"], newNoteName="   ").status_code == 422
    r = transcribe(c, rec["id"], newNoteName="Transcript (2)")
    assert r.status_code == 202, r.text
    started = r.json()
    notes = c.get(f"{API}/sessions/{key}/notes").json()
    created = next(n for n in notes if n["name"] == "Transcript (2)")
    assert created["id"] == started["noteId"] and created["size"] == 0
    run_jobs(c)
    assert note_content(c, created["id"]).startswith("## Transcript — ")


# ---- US4: provider and language from settings ------------------------------------------------


def test_default_and_override_language(app: FastAPI, owner_client: TestClient) -> None:
    c = owner_client
    configure(app, language="de")
    key = make_session(c)
    note = create_note(c, key, "N")
    rec = finished_recording(c, key)
    first = transcribe(c, rec["id"], noteId=note["id"]).json()
    assert first["language"] == "de"
    run_jobs(c)
    assert fake_transcriber.app.state.calls[-1]["language"] == "de"
    second = transcribe(c, rec["id"], noteId=note["id"], language="auto").json()
    assert second["language"] == "auto"
    run_jobs(c)
    assert fake_transcriber.app.state.calls[-1]["language"] is None


def test_key_is_read_live(app: FastAPI, owner_client: TestClient) -> None:
    c = owner_client
    fake_transcriber.app.state.required_key = "sk-new"
    _rec, note, started = setup_job(
        app, c, provider="openai-compatible", model="whisper-1", api_key="sk-old"
    )
    configure(app, provider="openai-compatible", model="whisper-1", api_key="sk-new")  # replaced
    run_jobs(c)
    assert job(c, started["id"])["status"] == "completed"
    rec2 = finished_recording(c, make_session(c, title="Lab"), 2)
    note2 = create_note(c, rec2["sessionKey"], "N")
    j2 = transcribe(c, rec2["id"], noteId=note2["id"]).json()
    configure(app, provider="openai-compatible", model="whisper-1", api_key=None)  # removed
    run_jobs(c)
    removed = job(c, j2["id"])
    assert removed["status"] == "failed" and removed["errorCategory"] == "invalid_credentials"
    assert removed["settingsRelated"] is True
    assert note_content(c, note["id"]).count("## Transcript") == 1


# ---- US5: history ---------------------------------------------------------------------------


def test_session_history(
    app: FastAPI,
    owner_client: TestClient,
    make_member: Callable[..., TestClient],
    tmp_data_dir: Path,
) -> None:
    c = owner_client
    configure(app)
    key = make_session(c)
    note = create_note(c, key, "Lecture notes")
    rec = finished_recording(c, key)
    assert c.get(f"{API}/sessions/{key}/transcriptions").json() == []
    first = transcribe(c, rec["id"], noteId=note["id"]).json()
    run_jobs(c)
    second = transcribe(c, rec["id"], noteId=note["id"]).json()
    run_jobs(c)
    c.patch(
        f"{API}/notes/{note['id']}",
        json={"name": "Renamed"},
        headers={"If-Match": f'"{c.get(f"{API}/notes/{note['id']}").json()["version"]}"'},
    )
    history = c.get(f"{API}/sessions/{key}/transcriptions").json()
    check(history, "TranscriptionJob", many=True, spec="004")
    assert [h["id"] for h in history] == [second["id"], first["id"]]
    assert {h["noteName"] for h in history} == {"Renamed"}
    member = make_member()
    assert_problem(member.get(f"{API}/sessions/{key}/transcriptions"), 404, "not_found")
