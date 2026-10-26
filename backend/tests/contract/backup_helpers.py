"""Helpers for the 016 backup and restore tests: seed one of every kind of item, run a backup,
upload a backup for restore. Backup jobs run inline (`backup_jobs.sync = True`)."""

from __future__ import annotations

import io
import json
import zipfile
from pathlib import Path
from typing import Any

from fastapi import FastAPI
from fastapi.testclient import TestClient

from tests.contract.ai_helpers import create_endpoint
from tests.contract.event_helpers import make_event
from tests.contract.notes_helpers import API, create_note, make_session
from tests.contract.recording_helpers import start, stop, upload_all
from tests.contract.test_themes import body as theme_body
from tests.pdf_fixtures import text_pdf
from tests.webm_fixture import make_webm

TRANSCRIPTION_KEY = "sk-backup-transcribe-0123456789"
AI_KEY = "sk-backup-ai-endpoint-9876543210"


def inline_jobs(app: FastAPI) -> None:
    app.state.backup_jobs.sync = True


def seed_everything(c: TestClient, files_root: Path, username: str = "owner") -> dict[str, Any]:
    """A class session with a note, a recording and a PDF; an event; a task; a custom theme; a
    transcription provider and an AI endpoint, both with a key; a file added by hand."""
    from tests.conftest import register_test_key

    key = make_session(c)
    note = create_note(c, key, "Lecture 1", "# Hello\n\nSome notes.")
    rec = start(c, key)
    upload_all(c, rec["id"], [make_webm(seconds=1)])
    assert stop(c, rec["id"]).status_code == 200
    r = c.post(
        f"{API}/sessions/{key}/documents/import",
        params={"fileName": "slides.pdf"},
        content=text_pdf(),
        headers={"Content-Type": "application/octet-stream"},
    )
    assert r.status_code == 201, r.text
    event = make_event(c)
    task = c.post(f"{API}/tasks", json={"title": "Problem set 3"})
    assert task.status_code == 201, task.text
    theme = c.post(f"{API}/themes", json=theme_body())
    assert theme.status_code == 201, theme.text
    provider = c.put(
        f"{API}/settings/transcription",
        json={
            "activeProviderId": "openai-compatible",
            "defaultLanguage": "auto",
            "provider": {
                "providerId": "openai-compatible",
                "values": {"address": "https://fake", "model": "whisper-1"},
                "apiKey": register_test_key(TRANSCRIPTION_KEY),
            },
        },
    )
    assert provider.status_code == 200, provider.text
    endpoint = create_endpoint(c, name="My endpoint", api_key=AI_KEY)
    folders = sorted((files_root / username).rglob("notes"))
    extra = folders[0].parent / "extra.txt"
    extra.write_text("added by hand")
    return {"sessionKey": key, "note": note, "event": event, "endpoint": endpoint,
            "extra": extra}


def make_backup(c: TestClient) -> tuple[dict[str, Any], bytes]:
    r = c.post(f"{API}/backup/exports")
    assert r.status_code == 202, r.text
    job = c.get(f"{API}/backup/jobs/{r.json()['id']}").json()
    assert job["phase"] == "ready", job
    data = c.get(f"{API}/backup/exports/{job['id']}/file")
    assert data.status_code == 200, data.text
    return job, data.content


def upload(c: TestClient, data: bytes) -> dict[str, Any]:
    r = c.post(
        f"{API}/backup/restores",
        content=data,
        headers={"Content-Type": "application/octet-stream"},
    )
    assert r.status_code == 202, r.text
    return c.get(f"{API}/backup/jobs/{r.json()['id']}").json()  # type: ignore[no-any-return]


def restore(c: TestClient, data: bytes) -> dict[str, Any]:
    job = upload(c, data)
    assert job["phase"] == "awaiting_confirmation", job
    r = c.post(f"{API}/backup/restores/{job['id']}/confirm", json={"confirm": True})
    assert r.status_code == 202, r.text
    return c.get(f"{API}/backup/jobs/{job['id']}").json()  # type: ignore[no-any-return]


def tree(root: Path) -> dict[str, bytes]:
    return {p.relative_to(root).as_posix(): p.read_bytes() for p in root.rglob("*") if p.is_file()}


def zip_files(data: bytes) -> dict[str, bytes]:
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        return {n: zf.read(n) for n in zf.namelist()}


def rebuild(files: dict[str, bytes], manifest: dict[str, Any] | None = None) -> bytes:
    """A zip with exactly `files` (and `manifest`, if given, as manifest.json)."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for name, content in files.items():
            if name == "manifest.json" and manifest is not None:
                continue
            zf.writestr(name, content)
        if manifest is not None:
            zf.writestr("manifest.json", json.dumps(manifest))
    return buf.getvalue()
