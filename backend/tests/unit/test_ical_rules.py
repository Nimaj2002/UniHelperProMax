"""010: mapping repetition rules and time zones onto the app's model (research R4, R5, R7)."""

from __future__ import annotations

from datetime import date, time

import pytest

from tests.fixtures.ics.make_large import fixture
from unihelper.domain.ical_read import read_calendar
from unihelper.domain.ical_rules import SourceEntry, expand, normalize

pytestmark = pytest.mark.unit

IST = "Europe/Istanbul"


def _entries(data: bytes, tz: str = IST) -> list[SourceEntry]:
    return normalize(read_calendar(data), tz)


def _cal(event: str, header: str = "") -> bytes:
    return (
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//T//T//EN\r\n" + header + "BEGIN:VEVENT\r\n"
        "UID:u1\r\nSUMMARY:S\r\n" + event + "END:VEVENT\r\nEND:VCALENDAR\r\n"
    ).encode()


def _weekly(rule: str, start: str = "20261005T100000", tzid: str = IST) -> SourceEntry:
    (entry,) = _entries(
        _cal(
            f"DTSTART;TZID={tzid}:{start}\r\nDTEND;TZID={tzid}:{start[:-4]}1130\r\nRRULE:{rule}\r\n"
        )
    )
    return entry


@pytest.mark.parametrize(
    ("rule", "weekdays", "end_kind"),
    [
        ("FREQ=WEEKLY;BYDAY=MO,WE;COUNT=10", ("MO", "WE"), "count"),
        ("FREQ=WEEKLY;COUNT=3", ("MO",), "count"),  # no BYDAY → the start's weekday
        ("FREQ=WEEKLY;INTERVAL=2;BYDAY=TU;UNTIL=20261231T205959Z", ("TU",), "until"),
        ("FREQ=WEEKLY;INTERVAL=8;BYDAY=MO;COUNT=2", ("MO",), "count"),
    ],
)
def test_supported_weekly(rule: str, weekdays: tuple[str, ...], end_kind: str) -> None:
    entry = _weekly(rule)
    assert entry.unsupported is None and entry.repeating
    x = expand(entry, IST)
    assert x.unsupported is None
    (seg,) = x.segments
    assert seg.freq == "weekly" and seg.weekdays == weekdays and seg.end_kind == end_kind


def test_count_and_until_mapping() -> None:
    x = expand(_weekly("FREQ=WEEKLY;BYDAY=MO;COUNT=12"), IST)
    assert x.segments[0].count == 12 and len(x.occs) == 12
    x = expand(_weekly("FREQ=WEEKLY;BYDAY=MO;UNTIL=20261026T235959Z"), IST)
    assert x.segments[0].until_date == date(2026, 10, 26)
    assert [o.day for o in x.occs][-1] == date(2026, 10, 26)


def test_open_ended_uses_chosen_end() -> None:
    entry = _weekly("FREQ=WEEKLY;BYDAY=MO")
    assert entry.open_ended
    assert len(expand(entry, IST).occs) == 17  # 16 weeks after the first, inclusive
    x = expand(entry, IST, open_end=date(2026, 10, 19))
    assert [o.day for o in x.occs] == [date(2026, 10, 5), date(2026, 10, 12), date(2026, 10, 19)]


@pytest.mark.parametrize(
    "rule",
    [
        "FREQ=WEEKLY;INTERVAL=9;BYDAY=MO",
        "FREQ=WEEKLY;COUNT=600",
        "FREQ=WEEKLY;BYDAY=2TU",
        "FREQ=WEEKLY;BYDAY=MO,TU;BYSETPOS=1",
        "FREQ=WEEKLY;BYMONTH=10",
        "FREQ=DAILY;COUNT=5",
        "FREQ=MONTHLY;BYDAY=2TU",
        "FREQ=YEARLY",
    ],
)
def test_unsupported(rule: str) -> None:
    entry = _weekly(rule)
    assert entry.unsupported
    x = expand(entry, IST)
    assert [s.freq for s in x.segments] == ["none"] and len(x.occs) == 1


def test_two_rrules_and_exrule_unsupported() -> None:
    (entry,) = _entries(
        _cal(
            "DTSTART;TZID=Europe/Istanbul:20261005T100000\r\nDTEND;TZID=Europe/Istanbul:"
            "20261005T110000\r\nRRULE:FREQ=WEEKLY;BYDAY=MO\r\nRRULE:FREQ=WEEKLY;BYDAY=TU\r\n"
        )
    )
    assert entry.unsupported == "it combines several repetition rules"


def test_wkst_checked_by_expansion() -> None:
    # Sunday-start weeks with interval 2 on SU,MO give other dates than Monday-start weeks
    differs = _weekly("FREQ=WEEKLY;INTERVAL=2;BYDAY=SU,MO;WKST=SU;COUNT=6", start="20261004T100000")
    assert expand(differs, IST).unsupported
    same = _weekly("FREQ=WEEKLY;INTERVAL=2;BYDAY=TU;WKST=SU;COUNT=4", start="20261006T100000")
    assert expand(same, IST).unsupported is None


def test_zone_conversions() -> None:
    ny = _weekly("FREQ=WEEKLY;BYDAY=MO;COUNT=1", tzid="America/New_York")
    assert expand(ny, IST).occs[0].start == time(17, 0)
    (outlook, berlin) = _entries(fixture("outlook-windows-tz.ics"))
    assert expand(outlook, IST).segments[0].start_time == time(9, 0)
    assert expand(berlin, IST).occs[0].start == time(15, 0)  # 14:00 CEST
    (apple, floating) = _entries(fixture("apple-floating.ics"))
    assert expand(apple, IST).segments[0].start_time == time(15, 0)
    assert expand(floating, "Europe/Berlin").occs[0].start == time(18, 0)


@pytest.mark.parametrize(
    ("event", "skip"),
    [
        ("DTSTART;VALUE=DATE:20261005\r\nDTEND;VALUE=DATE:20261006\r\n", "all_day"),
        ("DTSTART:20261005T200000Z\r\nDTEND:20261006T010000Z\r\n", "all_day"),  # past midnight
        ("DTSTART:20261005T100000Z\r\nDTEND:20261005T100000Z\r\n", "invalid_times"),
        ("DTSTART:20261005T100000Z\r\nDTEND:20261005T090000Z\r\n", "invalid_times"),
        ("DTSTART:20261005T100000Z\r\n", "invalid_times"),
        ("DTSTART:20261005T100000Z\r\nDTEND:20261005T110000Z\r\nSTATUS:CANCELLED\r\n", "cancelled"),
    ],
)
def test_skips(event: str, skip: str) -> None:
    (entry,) = _entries(_cal(event))
    assert entry.skip == skip


def test_duration_instead_of_end() -> None:
    (entry,) = _entries(_cal("DTSTART:20261005T100000Z\r\nDURATION:PT1H30M\r\n"))
    assert (entry.first_start, entry.first_end) == (time(13, 0), time(14, 30))


def test_exdate_and_overrides() -> None:
    entries = _entries(fixture("google-fall.ics"))
    la = next(e for e in entries if e.title == "Linear Algebra")
    x = expand(la, IST)
    assert x.cancelled == {date(2026, 10, 12)}
    ov = x.modified[date(2026, 10, 14)]
    assert (ov.start, ov.end) == (time(10, 30), time(12, 0))


def test_dst_split_into_segments() -> None:
    (entry,) = _entries(fixture("newyork-weekly.ics"))
    x = expand(entry, IST)
    assert [(s.start_date, s.start_time) for s in x.segments] == [
        (date(2026, 10, 20), time(17, 0)),
        (date(2026, 11, 3), time(18, 0)),
    ]
    assert x.segments[0].until_date == date(2026, 10, 27)
    assert x.segments[1].count == 4
    assert x.notes == ["Times change on 2026-11-03 (daylight saving in America/New_York)."]
    (same_zone,) = _entries(fixture("newyork-weekly.ics"), "America/New_York")
    assert len(expand(same_zone, "America/New_York").segments) == 1


def test_utc_series_anchored_in_calendar_zone() -> None:
    (entry,) = _entries(fixture("utc-weekly.ics"), "Europe/Berlin")
    x = expand(entry, "Europe/Berlin")
    assert len(x.segments) == 1 and {o.start for o in x.occs} == {time(10, 0)}
    no_zone = fixture("utc-weekly.ics").replace(b"X-WR-TIMEZONE:Europe/Berlin\r\n", b"")
    (entry,) = _entries(no_zone, "Europe/Berlin")
    assert {o.start for o in expand(entry, "Europe/Berlin").occs} == {time(10, 0)}


def test_rdate_and_orphan_override() -> None:
    entries = _entries(fixture("edge.ics"))
    tutorial = [e for e in entries if e.title == "Tutorial"]
    assert [e.recurrence_key[:6] for e in tutorial] == ["", "rdate:"]
    assert tutorial[1].first_day == date(2026, 10, 9)
    x = expand(tutorial[0], IST)
    assert len(x.orphans) == 1 and x.orphans[0].day == date(2026, 10, 7)
    assert not x.cancelled


def test_override_without_series_is_its_own_entry() -> None:
    data = _cal(
        "RECURRENCE-ID:20261007T100000Z\r\nDTSTART:20261008T100000Z\r\nDTEND:20261008T110000Z\r\n"
    )
    (entry,) = _entries(data)
    assert entry.recurrence_key and entry.first_day == date(2026, 10, 8)


def test_skipped_entries_keep_their_day() -> None:
    entries = _entries(fixture("google-fall.ics"))
    holiday = next(e for e in entries if e.title == "Holiday")
    assert holiday.skip == "all_day" and holiday.first_day == date(2026, 10, 29)
    old_lab = next(e for e in entries if e.title == "Old Lab")
    assert old_lab.skip == "cancelled" and (old_lab.first_day, old_lab.first_start) == (
        date(2026, 10, 1),
        time(15, 0),
    )
