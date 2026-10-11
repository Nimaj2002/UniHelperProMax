"""Reserved events folder and event folder names (009 research R1, R5)."""

from __future__ import annotations

from datetime import date

import pytest

from unihelper.domain.naming import (
    EVENTS_DIR,
    MAX_NAME_LEN,
    event_folder_name,
    is_reserved_course_folder,
)

pytestmark = pytest.mark.unit


@pytest.mark.parametrize("name", ["_Events", "_events", " _Events. ", "_EVENTS", "  _events  "])
def test_reserved(name: str) -> None:
    assert is_reserved_course_folder(name)


@pytest.mark.parametrize("name", ["Events", "_Events 2", "Events_", "_Event", "My _Events"])
def test_not_reserved(name: str) -> None:
    assert not is_reserved_course_folder(name)


def test_events_dir_is_itself_reserved() -> None:
    assert is_reserved_course_folder(EVENTS_DIR)


def test_event_folder_name() -> None:
    assert event_folder_name(date(2026, 10, 15), "AI Seminar") == "2026-10-15 AI Seminar"


def test_event_folder_name_sanitizes() -> None:
    assert event_folder_name(date(2026, 10, 15), "Q/A: why*? ") == "2026-10-15 Q-A- why--"


def test_event_folder_name_truncates() -> None:
    name = event_folder_name(date(2026, 10, 15), "x" * 120)
    assert len(name) == MAX_NAME_LEN
    assert name.startswith("2026-10-15 xxx")
