from __future__ import annotations

from collections.abc import Callable

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from tests.conftest import assert_problem
from tests.contract.notes_helpers import create_note
from tests.contract.openapi_check import check
from tests.contract.recording_helpers import start
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


def test_providers_and_status(app: FastAPI, owner_client: TestClient) -> None:
    c = owner_client
    specs = c.get(f"{API}/transcription/providers").json()
    check(specs, "ProviderSpec", many=True, spec="004")
    assert [s["id"] for s in specs] == ["voice-studio", "openai-compatible"]
    oa = specs[1]
    assert [f["key"] for f in oa["fields"]] == ["address", "apiKey", "model"]
    assert oa["maxUploadBytes"] == 25 * 1024 * 1024 and specs[0]["maxUploadBytes"] is None

    status = c.get(f"{API}/transcription/status").json()
    check(status, "TranscriptionStatus", spec="004")
    assert status == {
        "configured": False,
        "providerId": None,
        "providerName": None,
        "defaultLanguage": "auto",
    }
    configure(app, provider="openai-compatible", model="whisper-1")  # no key yet
    assert c.get(f"{API}/transcription/status").json()["configured"] is False
    configure(app, provider="openai-compatible", model="whisper-1", api_key=KEY, language="tr")
    r = c.get(f"{API}/transcription/status")
    assert r.json() == {
        "configured": True,
        "providerId": "openai-compatible",
        "providerName": "OpenAI-compatible",
        "defaultLanguage": "tr",
    }
    assert KEY not in r.text


def test_start_validation(
    app: FastAPI, owner_client: TestClient, make_member: Callable[..., TestClient]
) -> None:
    c = owner_client
    key = make_session(c)
    note = create_note(c, key, "Lecture notes", "My notes")
    rec = finished_recording(c, key)
    assert_problem(transcribe(c, rec["id"], noteId=note["id"]), 409, "provider_not_configured")
    configure(app)
    assert transcribe(c, rec["id"]).status_code == 422  # neither target
    assert transcribe(c, rec["id"], noteId=note["id"], newNoteName="X").status_code == 422
    assert transcribe(c, rec["id"], noteId=note["id"], language="english").status_code == 422
    assert_problem(transcribe(c, rec["id"], noteId="nope"), 404, "not_found")
    live = start(c, key)
    assert_problem(transcribe(c, live["id"], noteId=note["id"]), 409, "recording_not_finished")
    member = make_member()
    assert_problem(transcribe(member, rec["id"], noteId=note["id"]), 404, "not_found")

    r = transcribe(c, rec["id"], noteId=note["id"])
    assert r.status_code == 202, r.text
    body = r.json()
    check(body, "TranscriptionJob", spec="004")
    assert body["status"] == "queued" and body["noteName"] == "Lecture notes"
    assert body["providerName"] == "Voice Studio" and body["language"] == "auto"
    assert body["sessionKey"] == key and body["appended"] is None
    assert_problem(transcribe(c, rec["id"], noteId=note["id"]), 409, "transcription_in_progress")
    active = c.get(f"{API}/transcriptions/active").json()
    check(active, "TranscriptionJob", spec="004")
    assert active["id"] == body["id"]
    assert member.get(f"{API}/transcriptions/active").json() is None
    assert_problem(member.get(f"{API}/transcriptions/{body['id']}"), 404, "not_found")


def test_missing_file(app: FastAPI, owner_client: TestClient, tmp_data_dir) -> None:  # type: ignore[no-untyped-def]
    c = owner_client
    configure(app)
    key = make_session(c)
    note = create_note(c, key, "N")
    rec = finished_recording(c, key)
    next(tmp_data_dir.glob(f"files/**/audios/{rec['fileName']}")).unlink()
    assert_problem(transcribe(c, rec["id"], noteId=note["id"]), 409, "file_missing")


def test_run_appends_and_completes(app: FastAPI, owner_client: TestClient) -> None:
    c = owner_client
    configure(app)
    key = make_session(c)
    note = create_note(c, key, "Lecture notes", "My notes")
    rec = finished_recording(c, key)
    started = transcribe(c, rec["id"], noteId=note["id"], language="en").json()
    run_jobs(c)
    done = job(c, started["id"])
    check(done, "TranscriptionJob", spec="004")
    assert done["status"] == "completed" and done["progress"] == 1.0
    assert c.get(f"{API}/transcriptions/active").json() is None
    content = note_content(c, note["id"])
    assert content.startswith("My notes\n\n## Transcript — " + rec["name"] + " · ")
    assert content.endswith("lang=en\n")
    assert done["appended"]["text"] == content[len("My notes") :]
    assert done["appended"]["hash"] == c.get(f"{API}/notes/{note['id']}").json()["hash"]
    assert done["appended"]["version"] == c.get(f"{API}/notes/{note['id']}").json()["version"]
