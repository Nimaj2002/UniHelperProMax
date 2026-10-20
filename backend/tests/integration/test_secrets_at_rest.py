"""014 T017: a copy of the database and the data folder reveals no key (FR-064); a lost master
key makes keys unreadable, is reported, and can be reset without touching other data (FR-068)."""

from __future__ import annotations

import base64
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from tests.conftest import OWNER, _attach_csrf
from tests.contract.notes_helpers import create_note
from tests.contract.transcription_helpers import API, make_session
from unihelper.models import User

pytestmark = pytest.mark.integration

TRANSCRIPTION_KEY = "sk-transcribe-AT-REST-000111"
ENDPOINT_KEY = "sk-endpoint-AT-REST-000222"


def forms(secret: str) -> list[bytes]:
    raw = secret.encode()
    return [
        raw,
        base64.b64encode(raw),
        base64.urlsafe_b64encode(raw),
        raw.hex().encode(),
        secret.encode("utf-16-le"),
    ]


def scan(root: Path, secret: str) -> list[str]:
    hits = []
    for path in root.rglob("*"):
        if path.is_file():
            data = path.read_bytes()
            if any(f in data for f in forms(secret)):
                hits.append(str(path))
    return hits


def save_keys(app: FastAPI, c: TestClient) -> None:
    r = c.put(
        f"{API}/settings/transcription",
        json={
            "activeProviderId": "openai-compatible",
            "defaultLanguage": "auto",
            "provider": {
                "providerId": "openai-compatible",
                "values": {"address": "https://fake", "model": "whisper-1"},
                "apiKey": TRANSCRIPTION_KEY,
            },
        },
    )
    assert r.status_code == 200, r.text
    with app.state.sessionmaker() as db:
        user = db.query(User).filter_by(username="owner").one()
        app.state.secrets.put(db, user.id, "ai_endpoint", "endpoint-1", ENDPOINT_KEY)
        db.commit()


def test_database_and_data_folder_hold_no_key(
    app: FastAPI, tmp_data_dir: Path, key_file: Path
) -> None:
    with TestClient(app) as c:
        assert c.post(f"{API}/setup/owner", json=OWNER).status_code == 201
        _attach_csrf(c)
        save_keys(app, c)
        key = make_session(c)
        create_note(c, key, "Lecture", "some text")
    # after shutdown, everything in the data folder (SQLite, its WAL, notes) is what a backup has
    for secret in (TRANSCRIPTION_KEY, ENDPOINT_KEY):
        assert scan(tmp_data_dir, secret) == []
    assert not key_file.is_relative_to(tmp_data_dir)


def test_lost_master_key_is_reported_and_reset(
    app: FastAPI, tmp_data_dir: Path, key_file: Path
) -> None:
    with TestClient(app) as c:
        assert c.post(f"{API}/setup/owner", json=OWNER).status_code == 201
        _attach_csrf(c)
        save_keys(app, c)
        key = make_session(c)
        note = create_note(c, key, "Lecture", "keep me")
        assert c.post(f"{API}/secrets/reset", json={"confirm": True}).status_code == 409

    key_file.unlink()  # the key store was lost (or the data restored on another machine)
    with TestClient(app) as c:
        r = c.post(f"{API}/auth/login", json={k: OWNER[k] for k in ("username", "password")})
        assert r.status_code == 200
        _attach_csrf(c)
        status = c.get(f"{API}/secrets/status").json()
        assert status["readable"] is False and status["unreadableSecrets"] == 2
        view = c.get(f"{API}/settings/transcription").json()
        oa = next(p for p in view["providers"] if p["providerId"] == "openai-compatible")
        assert oa["secret"]["configured"] is True and oa["secret"]["readable"] is False
        # other data is unaffected
        assert c.get(f"{API}/notes/{note['id']}").json()["content"] == "keep me"

        reset = c.post(f"{API}/secrets/reset", json={"confirm": True})
        assert reset.status_code == 200, reset.text
        assert reset.json()["readable"] is True and reset.json()["unreadableSecrets"] == 0
        view = c.get(f"{API}/settings/transcription").json()
        oa = next(p for p in view["providers"] if p["providerId"] == "openai-compatible")
        assert oa["secret"] == {"configured": False, "last4": None, "readable": True}
        assert c.get(f"{API}/notes/{note['id']}").json()["content"] == "keep me"
        assert key_file.exists()
