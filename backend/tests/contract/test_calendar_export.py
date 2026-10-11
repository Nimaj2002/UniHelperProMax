"""010 calendar export: `GET /calendar-export` (contracts/openapi.yaml, research R14)."""

from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient
from icalendar import Calendar

from tests.conftest import assert_problem
from tests.contract.calendar_io_helpers import API, import_file, sessions
from tests.contract.event_helpers import make_event
from tests.contract.notes_helpers import create_note

pytestmark = pytest.mark.contract

NEW_SEMESTER = {"new": {"name": "Fall 2026", "year": {"new": {"name": "2026"}}}}


def _today() -> str:
    return datetime.now(UTC).astimezone(ZoneInfo("Europe/Istanbul")).date().isoformat()


def test_export_everything(owner_client: TestClient) -> None:
    c = owner_client
    import_file(c, "google-fall.ics", NEW_SEMESTER, Dentist={"selected": True})
    r = c.get(f"{API}/calendar-export")
    assert r.status_code == 200, r.text
    assert r.headers["content-type"] == "text/calendar; charset=utf-8"
    disposition = r.headers["content-disposition"]
    assert f'filename="UniHelperProMax-calendar-{_today()}.ics"' in disposition
    assert r.headers["x-export-counts"] == "classes=2; events=1"
    cal = Calendar.from_ical(r.content)
    events = cal.walk("VEVENT")
    summaries = sorted({str(e["SUMMARY"]) for e in events})
    assert summaries == ["Dentist", "Linear Algebra", "Physics II"]
    text = r.content.decode()
    assert "EXDATE;TZID=Europe/Istanbul:20261012T100000" in text
    assert "RECURRENCE-ID;TZID=Europe/Istanbul:20261014T100000" in text
    assert "X-UNIHELPER-KIND:class" in text and "X-UNIHELPER-KIND:event" in text


def test_export_one_semester_and_filename(owner_client: TestClient) -> None:
    c = owner_client
    import_file(c, "google-fall.ics", NEW_SEMESTER)
    make_event(c, semester={"new": {"name": "Spring 2027", "year": {"new": {"name": "2027"}}}})
    fall = next(s["semesterId"] for s in sessions(c) if s["courseName"] == "Linear Algebra")
    r = c.get(f"{API}/calendar-export", params={"semesterId": fall})
    assert r.status_code == 200
    assert (
        f'filename="UniHelperProMax-2026-Fall-2026-{_today()}.ics"'
        in r.headers["content-disposition"]
    )
    assert r.headers["x-export-counts"] == "classes=2; events=0"
    assert b"AI Seminar" not in r.content


def test_nothing_to_export(owner_client: TestClient) -> None:
    c = owner_client
    assert_problem(c.get(f"{API}/calendar-export"), 409, "nothing_to_export")
    event = make_event(c)
    assert_problem(c.get(f"{API}/calendar-export", params={"semesterId": "nope"}), 404, "not_found")
    # an emptied semester: its only event went to the Trash
    key = f"{event['lineageId']}:2026-10-15"
    r = c.delete(f"{API}/sessions/{key}", params={"scope": "all"},
                 headers={"If-Match": str(event["version"])})  # fmt: skip
    assert r.status_code == 200, r.text
    assert_problem(
        c.get(f"{API}/calendar-export", params={"semesterId": event["semesterId"]}),
        409,
        "nothing_to_export",
    )


def test_no_notes_in_the_file(owner_client: TestClient) -> None:
    c = owner_client
    event = make_event(c)
    create_note(c, f"{event['lineageId']}:2026-10-15", "Secret", "UNIQUE-MARKER-4711")
    r = c.get(f"{API}/calendar-export")
    assert r.status_code == 200
    assert b"UNIQUE-MARKER-4711" not in r.content and b"Secret" not in r.content


def test_foreign_semester(owner_client: TestClient, make_member: Callable[..., TestClient]) -> None:
    event = make_event(owner_client)
    other = make_member()
    r = other.get(f"{API}/calendar-export", params={"semesterId": event["semesterId"]})
    assert_problem(r, 404, "not_found")
