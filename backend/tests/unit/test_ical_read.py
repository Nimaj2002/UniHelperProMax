"""010: reading .ics files — checks, text and links (research R3, R8)."""

from __future__ import annotations

import pytest

from tests.fixtures.ics.make_large import fixture, ics, too_many
from unihelper.domain.ical_read import (
    IcsError,
    description_urls,
    read_calendar,
    strip_google_block,
)

pytestmark = pytest.mark.unit


def _one(body: str) -> bytes:
    return (
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//T//T//EN\r\nBEGIN:VEVENT\r\nUID:u1\r\n"
        "DTSTART:20261005T100000Z\r\nDTEND:20261005T110000Z\r\n" + body + "END:VEVENT\r\n"
        "END:VCALENDAR\r\n"
    ).encode()


@pytest.mark.parametrize(
    ("data", "code"),
    [
        (b"", "file_empty"),
        (b"  \r\n ", "file_empty"),
        (fixture("not-ical.ics"), "not_icalendar"),
        (b"BEGIN:VCARD\r\nEND:VCARD\r\n", "not_icalendar"),
        (b"\xff\xfe\x00garbage", "not_icalendar"),
    ],
)
def test_rejections(data: bytes, code: str) -> None:
    with pytest.raises(IcsError) as err:
        read_calendar(data)
    assert err.value.code == code


def test_too_many_events() -> None:
    with pytest.raises(IcsError) as err:
        read_calendar(too_many())
    assert err.value.code == "too_many_events"
    assert len(read_calendar(ics(5000)).events) == 5000


def test_bom_folding_and_escapes() -> None:
    data = b"\xef\xbb\xbf" + _one("SUMMARY:Hello\\, wor\r\n ld\\; and\\nmore\r\n")
    (event,) = read_calendar(data).events
    assert event.summary == "Hello, world; and more"


def test_text_is_plain_and_trimmed() -> None:
    cal = read_calendar(fixture("edge.ics"))
    markup = next(e for e in cal.events if e.uid == "markup")
    assert markup.summary == "<script>alert(1)</script> <b>Bold</b> talk"
    assert markup.location == "<i>Room</i> 5"


def test_links_order_and_filtering() -> None:
    cal = read_calendar(fixture("edge.ics"))
    markup = next(e for e in cal.events if e.uid == "markup")
    assert markup.links == [
        ("Slides.pdf", "https://drive.google.com/file/d/abc/view"),
        (None, "https://example.org/talk"),
    ]
    assert any("not a web address" in n for n in markup.notes)


def test_google_meet_and_join_block() -> None:
    cal = read_calendar(fixture("google-fall.ics"))
    la = next(e for e in cal.events if e.summary == "Linear Algebra" and not e.recurrence_id)
    assert la.links == [
        ("Google Meet", "https://meet.google.com/abc-defg-hij"),
        ("Course page", "https://lms.example.edu/la"),
    ]
    assert cal.calendar_tz == "Europe/Istanbul"


def test_conference_and_url_labels() -> None:
    data = _one(
        "URL:https://course.example.edu\r\n"
        "CONFERENCE;VALUE=URI;LABEL=Zoom room:https://zoom.us/j/1\r\n"
        "CONFERENCE;VALUE=URI:https://teams.example.com/x\r\n"
    )
    (event,) = read_calendar(data).events
    assert event.links == [
        (None, "https://course.example.edu"),
        ("Zoom room", "https://zoom.us/j/1"),
        ("Meeting", "https://teams.example.com/x"),
    ]


def test_at_most_ten_links_deduplicated() -> None:
    urls = " ".join(f"https://e{i}.example.org" for i in range(12))
    data = _one(f"URL:https://e0.example.org\r\nDESCRIPTION:{urls}\r\n")
    (event,) = read_calendar(data).events
    assert len(event.links) == 10
    assert event.links[0] == (None, "https://e0.example.org")
    assert any("first 10 of 12" in n for n in event.notes)


def test_long_labels_cut() -> None:
    data = _one("ATTACH;FILENAME=" + "a" * 80 + ".pdf:https://files.example.org/x\r\n")
    (event,) = read_calendar(data).events
    label = event.links[0][0]
    assert label is not None and len(label) == 60


def test_ignored_properties() -> None:
    data = _one(
        "ATTENDEE:mailto:a@b.c\r\nTRANSP:TRANSPARENT\r\nBEGIN:VALARM\r\nACTION:DISPLAY\r\n"
        "TRIGGER:-PT10M\r\nDESCRIPTION:https://alarm.example.org\r\nEND:VALARM\r\n"
    )
    (event,) = read_calendar(data).events
    assert event.links == []


def test_labelled_lines_and_late_labels() -> None:
    data = _one(
        "URL:https://lms.example.edu/la\r\n"
        "DESCRIPTION:Page: https://lms.example.edu/la\\nhttps://x.example.org\\nnot: a link\r\n"
    )
    (event,) = read_calendar(data).events
    assert event.links == [("Page", "https://lms.example.edu/la"), (None, "https://x.example.org")]


def test_description_helpers() -> None:
    text = "Intro https://a.example.org/x.\n-::~:~::~:~::-\nJoin: https://meet.google.com/q\n-::~:~::~:~::-"
    assert "meet.google.com" not in strip_google_block(text)
    assert description_urls(text) == ["https://a.example.org/x"]
    assert description_urls('<a href="https://b.example.org">b</a>') == ["https://b.example.org"]


def test_app_fields_and_missing_uid() -> None:
    data = (
        b"BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//UniHelperProMax//Calendar Export 1.0//EN\r\n"
        b"BEGIN:VEVENT\r\nDTSTART:20261005T100000Z\r\nDTEND:20261005T110000Z\r\n"
        b"X-UNIHELPER-KIND:class\r\nX-UNIHELPER-COLOR:teal\r\nSUMMARY:CS\r\nEND:VEVENT\r\n"
        b"END:VCALENDAR\r\n"
    )
    (event,) = read_calendar(data).events
    assert event.x_props == {"X-UNIHELPER-KIND": "class", "X-UNIHELPER-COLOR": "teal"}
    assert event.uid.startswith("nouid-")
