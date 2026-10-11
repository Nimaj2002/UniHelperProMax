"""010: writing the export file — structure, rules, overrides, app fields (research R5, R9, R10)."""

from __future__ import annotations

from datetime import UTC, date, datetime, time
from zoneinfo import ZoneInfo

import pytest
from dateutil.rrule import rrulestr
from icalendar import Calendar

from unihelper.domain.ical_write import (
    PRODID,
    ExportLineage,
    ExportOccurrence,
    ExportSegment,
    write_calendar,
)
from unihelper.domain.recurrence import Rule, occurrence_dates

pytestmark = pytest.mark.unit

BERLIN = "Europe/Berlin"
NOW = datetime(2026, 10, 12, 8, 0, tzinfo=UTC)


def _weekly(**kw: object) -> ExportSegment:
    values: dict[str, object] = {
        "id": "seg1",
        "title": "Linear Algebra",
        "freq": "weekly",
        "start_date": date(2026, 9, 28),
        "start_time": time(10, 0),
        "end_time": time(11, 30),
        "weekdays": ("MO", "WE"),
        "until_date": date(2026, 12, 30),
        "location": "FENS G032",
        "links": [("Course page", "https://lms.example.edu/la"), (None, "https://x.example.org")],
        "color": "teal",
    }
    values.update(kw)
    return ExportSegment(**values)  # type: ignore[arg-type]


def _lineage(*segments: ExportSegment, **kw: object) -> ExportLineage:
    values: dict[str, object] = {
        "kind": "class",
        "lineage_id": "lin1",
        "year_name": "2026",
        "semester_name": "Fall 2026",
        "semester_start": date(2026, 9, 21),
        "semester_end": date(2027, 1, 8),
        "course_name": "Linear Algebra",
        "segments": list(segments),
    }
    values.update(kw)
    return ExportLineage(**values)  # type: ignore[arg-type]


def _events(data: bytes) -> list[object]:
    return list(Calendar.from_ical(data).walk("VEVENT"))


def test_structure() -> None:
    data = write_calendar([_lineage(_weekly())], BERLIN, NOW)
    text = data.decode()
    assert text.startswith("BEGIN:VCALENDAR\r\n") and text.endswith("END:VCALENDAR\r\n")
    assert f"PRODID:{PRODID}" in text and "VERSION:2.0" in text
    assert all(len(line.encode()) <= 75 for line in text.split("\r\n"))
    cal = Calendar.from_ical(data)
    assert [str(tz["TZID"]) for tz in cal.walk("VTIMEZONE")] == [BERLIN]
    (event,) = cal.walk("VEVENT")
    assert str(event["UID"]) == "seg1@unihelperpromax"
    assert "DTSTAMP" in event
    assert event.decoded("DTSTART") == datetime(2026, 9, 28, 10, 0, tzinfo=ZoneInfo(BERLIN))
    assert "DTSTART;TZID=Europe/Berlin:20260928T100000" in text


def test_rrule_until_in_utc_and_count() -> None:
    text = write_calendar([_lineage(_weekly())], BERLIN, NOW).decode()
    assert "RRULE:FREQ=WEEKLY;UNTIL=20261230T225959Z;BYDAY=MO,WE;WKST=MO" in text
    text = write_calendar(
        [_lineage(_weekly(until_date=None, count=12, interval_weeks=2))], BERLIN, NOW
    ).decode()
    assert "COUNT=12" in text and "INTERVAL=2" in text and "UNTIL" not in text


def test_exdate_and_override() -> None:
    seg = _weekly(
        exdates=[date(2026, 10, 12)],
        overrides=[
            ExportOccurrence(
                date(2026, 10, 14),
                date(2026, 10, 14),
                time(10, 30),
                time(12, 0),
                "Linear Algebra",
                "FENS L045",
                [],
            )  # fmt: skip
        ],
    )
    data = write_calendar([_lineage(seg)], BERLIN, NOW)
    text = data.decode()
    assert "EXDATE;TZID=Europe/Berlin:20261012T100000" in text
    master, override = _events(data)
    assert str(override["UID"]) == str(master["UID"])  # type: ignore[index]
    assert "RECURRENCE-ID;TZID=Europe/Berlin:20261014T100000" in text
    assert override.decoded("DTSTART").time() == time(10, 30)  # type: ignore[attr-defined]
    assert str(override["LOCATION"]) == "FENS L045"  # type: ignore[index]


def test_app_fields_and_links() -> None:
    (event,) = _events(write_calendar([_lineage(_weekly())], BERLIN, NOW))
    get = event.get  # type: ignore[attr-defined]
    assert str(get("X-UNIHELPER-KIND")) == "class"
    assert str(get("X-UNIHELPER-YEAR")) == "2026"
    assert str(get("X-UNIHELPER-SEMESTER")) == "Fall 2026"
    assert str(get("X-UNIHELPER-SEMESTER-START")) == "2026-09-21"
    assert str(get("X-UNIHELPER-SEMESTER-END")) == "2027-01-08"
    assert str(get("X-UNIHELPER-COURSE")) == "Linear Algebra"
    assert str(get("X-UNIHELPER-COLOR")) == "teal"
    assert str(get("X-UNIHELPER-LINEAGE")) == "lin1"
    assert str(get("URL")) == "https://lms.example.edu/la"
    assert (
        str(get("DESCRIPTION")) == "Course page: https://lms.example.edu/la\nhttps://x.example.org"
    )


def test_segments_and_standalone() -> None:
    first = _weekly(id="s1", until_date=date(2026, 10, 21))
    second = _weekly(id="s2", start_date=date(2026, 10, 26), start_time=time(11, 0),
                     end_time=time(12, 30), until_date=date(2026, 12, 30))  # fmt: skip
    lin = _lineage(first, second)
    lin.standalone = [
        ExportOccurrence(
            date(2026, 10, 7),
            date(2026, 10, 9),
            time(9, 0),
            time(10, 0),
            "Linear Algebra",
            None,
            [],
        )  # fmt: skip
    ]
    events = _events(write_calendar([lin], BERLIN, NOW))
    assert [str(e["UID"]) for e in events] == [  # type: ignore[index]
        "s1@unihelperpromax",
        "s2@unihelperpromax",
        "lin1-2026-10-07@unihelperpromax",
    ]
    assert {str(e["X-UNIHELPER-LINEAGE"]) for e in events} == {"lin1"}  # type: ignore[index]
    assert str(events[2]["X-UNIHELPER-ORIGINAL-DATE"]) == "2026-10-07"  # type: ignore[index]


def test_round_trip_across_dst() -> None:
    """Expanding the written rule in the zone gives the app's dates at the same wall time,
    on both sides of the 25 Oct 2026 change in Berlin."""
    seg = _weekly(start_date=date(2026, 10, 5), weekdays=("MO",), until_date=date(2026, 11, 30))
    (event,) = _events(write_calendar([_lineage(seg)], BERLIN, NOW))
    start = event.decoded("DTSTART")  # type: ignore[attr-defined]
    rule = rrulestr(event["RRULE"].to_ical().decode(), dtstart=start)  # type: ignore[index]
    got = list(rule)
    app = occurrence_dates(
        Rule(
            "weekly",
            1,
            ("MO",),
            "until",
            date(2026, 11, 30),
            None,
            date(2026, 10, 5),
            time(10, 0),
            time(11, 30),
        ),  # fmt: skip
        None,
        date(2026, 10, 1),
        date(2026, 12, 31),
    )
    assert [d.date() for d in got] == app
    assert {d.astimezone(ZoneInfo(BERLIN)).time() for d in got} == {time(10, 0)}
    assert {d.utcoffset().total_seconds() for d in got} == {7200, 3600}  # type: ignore[union-attr]


def test_one_time_event_and_utc_user() -> None:
    seg = ExportSegment(id="e1", title="AI Seminar", freq="none", start_date=date(2026, 10, 15),
                        start_time=time(14, 0), end_time=time(15, 30))  # fmt: skip
    lin = _lineage(seg, kind="event", course_name=None)
    text = write_calendar([lin], "UTC", NOW).decode()
    assert "RRULE" not in text and "VTIMEZONE" not in text
    assert "DTSTART:20261015T140000Z" in text
    assert "X-UNIHELPER-COURSE" not in text and "X-UNIHELPER-KIND:event" in text
