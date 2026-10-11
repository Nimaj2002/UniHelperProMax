"""Large .ics files generated at test time (010 T003) — not committed."""

from __future__ import annotations

from datetime import date, timedelta
from pathlib import Path

FIXTURES = Path(__file__).resolve().parent
MAX_BYTES = 5 * 1024 * 1024


def fixture(name: str) -> bytes:
    return (FIXTURES / name).read_bytes()


def ics(events: int, description_bytes: int = 0) -> bytes:
    """`events` one-time events (09:00–10:00 on consecutive days from 2026-10-01)."""
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Test//Large//EN"]
    start = date(2026, 10, 1)
    for i in range(events):
        day = (start + timedelta(days=i)).strftime("%Y%m%d")
        lines += [
            "BEGIN:VEVENT",
            f"UID:large-{i}@test",
            f"DTSTART;TZID=Europe/Istanbul:{day}T090000",
            f"DTEND;TZID=Europe/Istanbul:{day}T100000",
            f"SUMMARY:Item {i % 25}",
            "END:VEVENT",
        ]
    if description_bytes:
        body = "x" * description_bytes
        lines += ["BEGIN:VEVENT", "UID:big@test", "DTSTART:20261001T090000Z",
                  "DTEND:20261001T100000Z", "SUMMARY:Big"]  # fmt: skip
        lines += ["DESCRIPTION:" + body[:60]] + [
            " " + body[i : i + 74] for i in range(60, len(body), 74)
        ]
        lines.append("END:VEVENT")
    lines.append("END:VCALENDAR")
    return ("\r\n".join(lines) + "\r\n").encode()


def large_4000() -> bytes:
    return ics(4000)


def too_many() -> bytes:
    return ics(5001)


def too_big() -> bytes:
    data = ics(1, description_bytes=MAX_BYTES)
    assert len(data) > MAX_BYTES
    return data
