"""Helpers for 009 event tests: request bodies, an event factory and session content."""

from __future__ import annotations

from typing import Any

from fastapi.testclient import TestClient

from tests.audio_fixtures import wav
from tests.contract.document_helpers import upload_pdf
from tests.contract.import_helpers import import_audio
from tests.contract.notes_helpers import API, create_note
from tests.pdf_fixtures import text_pdf

__all__ = ["API", "content_for", "make_event", "new_event_body"]

EVENT_DATE = "2026-10-15"  # a Thursday


def new_event_body(**overrides: Any) -> dict[str, Any]:
    """ "AI Seminar" on Thu 15 Oct 2026, 14:00–15:30, in an inline Fall 2026 / 2026."""
    body: dict[str, Any] = {
        "title": "AI Seminar",
        "semester": {"new": {"name": "Fall 2026", "year": {"new": {"name": "2026"}}}},
        "startDate": EVENT_DATE,
        "startTime": "14:00",
        "endTime": "15:30",
        "recurrence": {"freq": "none"},
    }
    body.update(overrides)
    return body


def make_event(c: TestClient, **kw: Any) -> dict[str, Any]:
    """POST /events and return the `EventCreated` body (its first key: `{lineageId}:{date}`)."""
    r = c.post(f"{API}/events", json=new_event_body(**kw))
    assert r.status_code == 201, r.text
    return r.json()  # type: ignore[no-any-return]


def content_for(c: TestClient, session_key: str) -> dict[str, Any]:
    """One note, one imported audio and one PDF in the session's folder."""
    note = create_note(c, session_key, "Lecture", "# Notes")
    audio = import_audio(c, session_key, "talk.wav", wav(1500))
    assert audio.status_code == 201, audio.text
    pdf = upload_pdf(c, session_key, "slides.pdf", text_pdf())
    assert pdf.status_code == 201, pdf.text
    return {"note": note, "recording": audio.json(), "document": pdf.json()}
