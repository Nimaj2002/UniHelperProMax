from __future__ import annotations

from datetime import date, time

import pytest

from unihelper.domain.naming import (
    GENERAL_NOTES_DIR,
    class_date_folder_name,
    name_key,
    safe_name,
    unique_sibling,
)

pytestmark = pytest.mark.unit


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("CS 201: Intro", "CS 201- Intro"),
        ("Fall/Spring", "Fall-Spring"),
        ("con", "con_"),
        ("CON.txt", "CON_.txt"),
        ("lpt9", "lpt9_"),
        ("  Notes.  ", "Notes"),
        ("a\x00b\x1fc\x7fd", "a-b-c-d"),
        ('w*h?a"t<e>v|e\\r', "w-h-a-t-e-v-e-r"),
        ("multiple    spaces\there", "multiple spaces here"),
        ("", "Untitled"),
        ("...", "Untitled"),
        ("Café", "Café"),  # NFC
    ],
)
def test_safe_name(raw: str, expected: str) -> None:
    assert safe_name(raw) == expected


def test_safe_name_truncates_to_80_and_retrims() -> None:
    out = safe_name("x" * 79 + " " + "y" * 10)
    assert len(out) <= 80
    assert not out.endswith(" ")
    assert len(safe_name("z" * 200)) == 80


def test_unique_sibling_case_insensitive() -> None:
    assert unique_sibling("CS 201", []) == "CS 201"
    assert unique_sibling("CS 201", ["cs 201"]) == "CS 201 (2)"
    assert unique_sibling("CS 201", ["cs 201", "CS 201 (2)"]) == "CS 201 (3)"
    assert unique_sibling("notes.md", ["NOTES.md"]) == "notes (2).md"


def test_name_key() -> None:
    assert name_key("  Fall   2026 ") == "fall 2026"
    assert name_key("FALL 2026") == name_key("fall 2026")


def test_class_date_folder_name() -> None:
    d, t = date(2026, 10, 5), time(14, 0)
    assert class_date_folder_name(d, t, []) == "2026-10-05"
    assert class_date_folder_name(d, t, ["2026-10-05"]) == "2026-10-05 1400"
    assert class_date_folder_name(d, t, ["2026-10-05", "2026-10-05 1400"]) == "2026-10-05 1400 (2)"


def test_general_notes_dir_is_a_safe_readable_name() -> None:
    assert GENERAL_NOTES_DIR == "General Notes"
    assert safe_name(GENERAL_NOTES_DIR) == GENERAL_NOTES_DIR
