"""010: preview grouping, defaults, colours and plan checks (research R6, R12)."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, time
from typing import Any

import pytest

from tests.fixtures.ics.make_large import fixture
from unihelper.domain.ical_read import read_calendar
from unihelper.domain.ical_rules import normalize
from unihelper.domain.import_plan import (
    COLOR_KEYS,
    COURSE_COLOR_ORDER,
    NO_TITLE,
    PreviewGroup,
    assign_colors,
    default_course,
    group_entries,
    next_color,
    validate_plan,
)
from unihelper.models.course import COLOR_KEYS as MODEL_COLORS

pytestmark = pytest.mark.unit

IST = "Europe/Istanbul"


def _groups(data: bytes) -> list[PreviewGroup]:
    return group_entries(normalize(read_calendar(data), IST), IST)


def _by_title(groups: list[PreviewGroup]) -> dict[str, PreviewGroup]:
    return {g.title: g for g in groups}


@dataclass
class Plan:
    group_id: str
    selected: bool = True
    import_as: str = "class"
    title: str | None = None
    course: Any = None
    semester: str = "saved"
    end_date: date | None = None
    unsupported: str | None = None


@dataclass
class NewCourse:
    new: str


def test_palettes_match_the_model() -> None:
    assert set(COLOR_KEYS) == set(MODEL_COLORS) == set(COURSE_COLOR_ORDER)


def test_google_groups_and_defaults() -> None:
    groups = _by_title(_groups(fixture("google-fall.ics")))
    assert list(groups) == ["Linear Algebra", "Physics II", "Dentist"]  # all-day, cancelled out
    la, phys, dentist = groups["Linear Algebra"], groups["Physics II"], groups["Dentist"]
    assert (la.default_selected, la.default_kind) == (True, "class")
    assert (dentist.default_selected, dentist.default_kind) == (False, "event")
    assert la.occurrence_count == 27  # 28 dates minus the EXDATE
    assert la.patterns[0] == (("MO", "WE"), time(10, 0), time(11, 30))
    assert la.location == "FENS G032"
    assert phys.open_ended and phys.suggested_end == date(2027, 1, 19)
    assert not la.open_ended and la.suggested_end is None


def test_grouping_ignores_case_and_spaces_and_ids_are_stable() -> None:
    data = fixture("apple-floating.ics").replace(
        b"SUMMARY:Choir rehearsal", b"SUMMARY: reading GROUP "
    )
    groups = _groups(data)
    assert len(groups) == 1 and len(groups[0].entries) == 2
    assert [g.group_id for g in _groups(data)] == [g.group_id for g in groups]


def test_missing_title_and_reserved_name() -> None:
    groups = _by_title(_groups(fixture("edge.ics")))
    assert groups[NO_TITLE].title_missing and "title_required" in groups[NO_TITLE].issues
    assert "reserved_name" in groups["_Events"].issues
    assert groups["Tutorial"].occurrence_count == 6  # 4 weekly + RDATE + moved orphan


def test_unsupported_group() -> None:
    groups = _by_title(_groups(fixture("unsupported.ics")))
    gym = groups["Gym"]
    assert gym.unsupported and gym.repeating and gym.default_selected
    assert gym.occurrence_count == 1


def test_colors() -> None:
    assert next_color([]) == "blue"
    assert next_color(["blue", "green"]) == "orange"
    assert assign_colors(["blue"], 3) == ["green", "orange", "violet"]
    every = list(COURSE_COLOR_ORDER) + ["blue"]
    assert next_color(every) == "green"  # all used: the least used, palette order


def test_default_course() -> None:
    courses = {"linear algebra": "c1"}
    assert default_course("  Linear ALGEBRA ", courses) == "c1"
    assert default_course("Physics II", courses) is None


def test_validate_plan() -> None:
    groups = _by_title(_groups(fixture("edge.ics")))
    no_title, reserved = groups[NO_TITLE], groups["_Events"]
    assert (
        validate_plan([Plan(no_title.group_id, selected=False)], list(groups.values()))[0]["code"]
        == "nothing_selected"
    )
    errors = validate_plan(
        [
            Plan(no_title.group_id, import_as="event"),
            Plan(reserved.group_id),
            Plan(groups["Tutorial"].group_id, end_date=date(2026, 1, 1)),
            Plan("nope"),
        ],
        list(groups.values()),
    )
    codes = {(e["field"], e["code"]) for e in errors}
    assert (f"/groups/{no_title.group_id}/title", "title_required") in codes
    assert (f"/groups/{reserved.group_id}/course", "reserved_name") in codes
    assert (f"/groups/{groups['Tutorial'].group_id}/endDate", "invalid_end_date") in codes
    assert ("/groups/nope", "unknown_group") in codes
    ok = validate_plan(
        [
            Plan(no_title.group_id, import_as="event", title="Talk"),
            Plan(reserved.group_id, course=NewCourse("Seminars")),
        ],
        list(groups.values()),
    )
    assert ok == []


def test_unsupported_needs_a_choice() -> None:
    groups = _groups(fixture("unsupported.ics"))
    gid = groups[0].group_id
    (error,) = validate_plan([Plan(gid)], groups)
    assert error == {
        "field": f"/groups/{gid}/unsupported",
        "code": "choice_required",
        "message": "Choose what to do with this repetition.",
    }
    assert validate_plan([Plan(gid, unsupported="first_only")], groups) == []


def test_app_export_groups_per_saved_semester() -> None:
    def ev(uid: str, year: str, sem: str) -> str:
        return (
            f"BEGIN:VEVENT\r\nUID:{uid}\r\nSUMMARY:Calculus\r\nDTSTART:20261005T070000Z\r\n"
            f"DTEND:20261005T080000Z\r\nX-UNIHELPER-KIND:class\r\nX-UNIHELPER-YEAR:{year}\r\n"
            f"X-UNIHELPER-SEMESTER:{sem}\r\nX-UNIHELPER-COURSE:Calculus\r\n"
            "X-UNIHELPER-COLOR:teal\r\nEND:VEVENT\r\n"
        )

    data = (
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//UniHelperProMax//Calendar Export 1.0//EN\r\n"
        + ev("a", "2025", "Fall")
        + ev("b", "2026", "Fall")
        + "END:VCALENDAR\r\n"
    ).encode()
    groups = _groups(data)
    assert len(groups) == 2
    assert all(g.default_selected and g.default_kind == "class" for g in groups)
    assert {g.saved.year_name for g in groups if g.saved} == {"2025", "2026"}
    assert groups[0].default_color == "teal"
