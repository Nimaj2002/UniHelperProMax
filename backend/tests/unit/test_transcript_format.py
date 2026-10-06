from __future__ import annotations

from datetime import datetime

import pytest

from unihelper.domain import transcript as t

pytestmark = pytest.mark.unit


@pytest.mark.parametrize(
    ("ms", "text"),
    [
        (0, "0s"),
        (42_000, "42s"),
        (725_000, "12m 05s"),
        (5_040_000, "1h 24m"),
        (3_600_000, "1h 00m"),
    ],
)
def test_format_duration(ms: int, text: str) -> None:
    assert t.format_duration(ms) == text


def test_heading() -> None:
    h = t.heading("Recording 10:02", datetime(2026, 10, 5, 10, 2), 5_040_000)
    assert h == "## Transcript — Recording 10:02 · 2026-10-05 10:02 · 1h 24m"


@pytest.mark.parametrize(
    ("existing", "sep"),
    [(b"", ""), (b"text", "\n\n"), (b"text\n", "\n"), (b"text\n\n", ""), (b"# T\n\n\n", "")],
)
def test_separator(existing: bytes, sep: str) -> None:
    assert t.separator_for(existing) == sep


def test_section_parts_and_no_speech() -> None:
    assert t.section("## H", ["a ", "", " b"]) == "## H\n\na\n\nb\n"
    assert t.section("## H", ["", "  "]) == "## H\n\n(No speech detected)\n"
