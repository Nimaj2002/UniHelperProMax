"""009 T035: event scope rules (research R3, R4) — what a "This event" edit writes, what a
frozen occurrence keeps, and how the planners treat frozen (detached) occurrences."""

from __future__ import annotations

import json
from datetime import UTC, date, datetime, time
from types import SimpleNamespace
from typing import Any
from zoneinfo import ZoneInfo

import pytest

from unihelper.domain.recurrence import ExceptionView, Rule, occurrence_view
from unihelper.domain.scopes import Segment, plan_edit
from unihelper.schemas.events import EventEdit
from unihelper.services.event_service import _frozen_values, _this_values

pytestmark = pytest.mark.unit
THU = date(2026, 10, 15)
ZONE = "Europe/Istanbul"


def seg() -> Segment:
    return Segment(
        id="S1",
        start_date=THU,
        rule=Rule(
            freq="weekly",
            interval_weeks=1,
            by_weekday=("TH",),
            end_kind="count",
            until_date=None,
            count=4,
            start_date=THU,
            start_time=time(14, 0),
            end_time=time(15, 30),
        ),
        title="AI Seminar",
        location=None,
        color="blue",
        links=(),
        semester_end=None,
    )


def test_this_edit_writes_a_modified_exception_with_moved_date() -> None:
    body = EventEdit.model_validate(
        {
            "title": "Moved",
            "color": "red",
            "date": "2026-10-23",
            "links": [{"url": "https://a.edu"}],
        }
    )
    changes: dict[str, Any] = {
        "title": "Moved",
        "color": "red",
        "links": [(None, "https://a.edu")],
    }
    values = _this_values(changes, body, date(2026, 10, 22), None)
    assert values["kind"] == "modified"
    assert values["moved_date"] == date(2026, 10, 23)
    assert values["title"] == "Moved" and values["color"] == "red"
    assert json.loads(values["links_json"]) == [{"label": None, "url": "https://a.edu"}]
    assert values["start_time"] is None and values["detached"] is False


def test_this_edit_merges_with_the_existing_exception_and_moving_back_clears_the_date() -> None:
    existing = SimpleNamespace(
        kind="modified",
        start_time=time(9, 0),
        end_time=time(10, 0),
        location="Hall",
        title="Kept",
        color=None,
        links_json=None,
        moved_date=date(2026, 10, 23),
        detached=True,
    )
    body = EventEdit.model_validate({"date": "2026-10-22", "location": "Annex"})
    values = _this_values({"location": "Annex"}, body, date(2026, 10, 22), existing)  # type: ignore[arg-type]
    assert values["moved_date"] is None  # back on its own date
    assert values["location"] == "Annex" and values["title"] == "Kept"
    assert values["start_time"] == time(9, 0) and values["detached"] is True


def test_frozen_values_hold_everything_the_occurrence_shows() -> None:
    row = SimpleNamespace(
        title="AI Seminar", color="blue", links=[SimpleNamespace(label="L", url="https://x.edu")]
    )
    exc = ExceptionView(
        original_date=date(2026, 10, 22),
        kind="modified",
        start_time=None,
        end_time=None,
        location="Hall C",
        version=1,
        moved_date=date(2026, 10, 23),
    )
    view = occurrence_view(
        date(2026, 10, 22),
        exc,
        lineage_id="L1",
        series_id="S1",
        start_time=time(14, 0),
        end_time=time(15, 30),
        location=None,
        zone=ZoneInfo(ZONE),
        now=datetime(2026, 1, 1, tzinfo=UTC),
    )
    values = _frozen_values(view, row)  # type: ignore[arg-type]
    assert values == {
        "kind": "modified",
        "start_time": time(14, 0),
        "end_time": time(15, 30),
        "location": "Hall C",
        "title": "AI Seminar",
        "color": "blue",
        "links_json": json.dumps([{"label": "L", "url": "https://x.edu"}]),
        "moved_date": date(2026, 10, 23),
        "detached": True,
    }


def test_planner_keeps_a_frozen_occurrence_whose_date_drops_out() -> None:
    frozen = ExceptionView(
        original_date=date(2026, 10, 29),
        kind="modified",
        start_time=time(14, 0),
        end_time=time(15, 30),
        location=None,
        version=1,
        title="AI Seminar",
        detached=True,
    )
    plain = ExceptionView(
        original_date=date(2026, 11, 5),
        kind="modified",
        start_time=None,
        end_time=None,
        location="Hall",
        version=1,
    )
    cs = plan_edit(
        [seg()],
        [frozen, plain],
        THU,
        "all",
        {
            "recurrence": {
                "freq": "weekly",
                "by_weekday": ["TH"],
                "end": {"kind": "count", "count": 2},
            }
        },
    )
    assert date(2026, 10, 29) not in cs.exception_deletes  # frozen: stays scheduled
    assert date(2026, 11, 5) in cs.exception_deletes  # a plain override follows the rule
    assert cs.preserved_overrides == 1 and cs.removed_overrides == 1
