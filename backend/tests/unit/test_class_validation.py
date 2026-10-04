"""Request-level validation of class payloads (schemas) — FR-013, edge cases."""

from __future__ import annotations

from typing import Any

import pytest
from pydantic import ValidationError

from unihelper.schemas.classes import ClassCreate

pytestmark = pytest.mark.unit


def payload(**kw: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "course": {"id": "c1"},
        "startDate": "2026-09-28",
        "startTime": "10:00",
        "endTime": "11:30",
        "color": "blue",
        "recurrence": {
            "freq": "weekly",
            "byWeekday": ["MO", "WE"],
            "end": {"kind": "until", "untilDate": "2026-12-31"},
        },
    }
    base.update(kw)
    return base


def test_valid_payload_with_ids() -> None:
    m = ClassCreate.model_validate(payload(links=[{"label": "Site", "url": "https://x.edu"}]))
    assert m.start_time == "10:00" and m.links[0].url == "https://x.edu"


def test_valid_payload_with_nested_new() -> None:
    m = ClassCreate.model_validate(
        payload(
            course={
                "new": {
                    "name": "CS 201",
                    "semester": {
                        "new": {
                            "name": "Fall 2026",
                            "endDate": "2027-01-10",
                            "year": {"new": {"name": "2026"}},
                        }
                    },
                }
            }
        )
    )
    assert m.course.new.name == "CS 201"  # type: ignore[union-attr]


@pytest.mark.parametrize(
    ("kw", "loc"),
    [
        ({"title": "x" * 61}, "title"),
        ({"location": "x" * 121}, "location"),
        ({"color": "mauve"}, "color"),
        ({"startTime": "25:00"}, "startTime"),
        ({"links": [{"url": "ftp://x.edu"}]}, "links"),
        ({"links": [{"url": "notaurl"}]}, "links"),
        ({"links": [{"url": "https://x.edu/" + "a" * 2048}]}, "links"),
        ({"links": [{"label": "x" * 61, "url": "https://x.edu"}]}, "links"),
        ({"links": [{"url": "https://x.edu"}] * 11}, "links"),
        ({"recurrence": {"freq": "weekly", "byWeekday": ["XX"]}}, "recurrence"),
        (
            {
                "recurrence": {
                    "freq": "weekly",
                    "byWeekday": ["MO"],
                    "end": {"kind": "count", "count": 501},
                }
            },
            "recurrence",
        ),
        ({"course": {"id": "c1", "new": {"name": "x"}}}, "course"),
    ],
)
def test_invalid(kw: dict[str, Any], loc: str) -> None:
    with pytest.raises(ValidationError) as info:
        ClassCreate.model_validate(payload(**kw))
    assert any(e["loc"][0] == loc for e in info.value.errors())
