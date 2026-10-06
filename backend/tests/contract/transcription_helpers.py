from __future__ import annotations

import json
from typing import Any

from fastapi import FastAPI
from fastapi.testclient import TestClient

from tests.contract.recording_helpers import API, make_session, start, stop, upload_all
from tests.webm_fixture import chunks, make_webm
from unihelper.models import ProviderConfig, TranscriptionSettings, User

__all__ = ["API", "configure", "finished_recording", "make_session", "run_jobs", "transcribe"]
KEY = "sk-test-secret-9876"


def configure(
    app: FastAPI,
    username: str = "owner",
    provider: str = "voice-studio",
    model: str | None = None,
    api_key: str | None = None,
    language: str = "auto",
    address: str = "http://fake",
) -> None:
    with app.state.sessionmaker() as db:
        user = db.query(User).filter_by(username=username).one()
        settings = db.get(TranscriptionSettings, user.id) or TranscriptionSettings(user_id=user.id)
        settings.active_provider_id = provider
        settings.default_language = language
        db.add(settings)
        config = db.get(ProviderConfig, (user.id, provider)) or ProviderConfig(
            user_id=user.id, provider_id=provider
        )
        config.values_json = json.dumps({"address": address} | ({"model": model} if model else {}))
        config.secret = api_key
        db.add(config)
        db.commit()


def finished_recording(c: TestClient, key: str, seconds: float = 3) -> dict[str, Any]:
    rec = start(c, key)
    upload_all(c, rec["id"], chunks(make_webm(seconds), 3))
    r = stop(c, rec["id"])
    assert r.status_code == 200, r.text
    return r.json()  # type: ignore[no-any-return]


def transcribe(c: TestClient, rec_id: str, **body: Any) -> Any:
    return c.post(f"{API}/recordings/{rec_id}/transcriptions", json=body)


def run_jobs(c: TestClient) -> None:
    """Run every queued job to completion inside the app's event loop."""
    worker = c.app.state.transcription_worker  # type: ignore[attr-defined]
    c.portal.call(worker.run_pending)  # type: ignore[union-attr]


def job(c: TestClient, job_id: str) -> dict[str, Any]:
    r = c.get(f"{API}/transcriptions/{job_id}")
    assert r.status_code == 200, r.text
    return r.json()  # type: ignore[no-any-return]


def note_content(c: TestClient, note_id: str) -> str:
    return c.get(f"{API}/notes/{note_id}").json()["content"]  # type: ignore[no-any-return]
