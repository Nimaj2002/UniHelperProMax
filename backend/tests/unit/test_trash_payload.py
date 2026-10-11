"""009 T039: Trash before-images (`TrashPayloadV1`) — built from a scope planner's ChangeSet
and round-tripped through JSON for this/following/all deletes of classes and events."""

from __future__ import annotations

from datetime import date, time

import pytest

from unihelper.domain.recurrence import ExceptionView, Rule
from unihelper.domain.scopes import Segment, plan_delete
from unihelper.domain.trash_payload import (
    BeforeState,
    ExceptionImage,
    Owner,
    Removed,
    SegmentImage,
    TrashPayloadV1,
    build,
)

pytestmark = pytest.mark.unit
MON = date(2026, 9, 28)
LATER = date(2026, 11, 2)


def image(sid: str, start: date, title: str | None, split: str | None = None) -> SegmentImage:
    return SegmentImage(
        id=sid,
        split_from_id=split,
        title=title,
        location="Room A",
        color="teal",
        start_date=start,
        start_time=time(10, 0),
        end_time=time(11, 30),
        freq="weekly",
        interval_weeks=1,
        by_weekday="MO,WE",
        end_kind="until",
        until_date=date(2026, 12, 31) if split else LATER - date.resolution,
        count=None,
        version=3,
        links=((None, "https://x.edu"), ("Slides", "https://y.edu")),
    )


def segment(img: SegmentImage) -> Segment:
    return Segment(
        id=img.id,
        start_date=img.start_date,
        rule=Rule(
            freq=img.freq,
            interval_weeks=img.interval_weeks,
            by_weekday=tuple(img.by_weekday.split(",")),
            end_kind=img.end_kind,
            until_date=img.until_date,
            count=img.count,
            start_date=img.start_date,
            start_time=img.start_time,
            end_time=img.end_time,
        ),
        title=img.title,
        location=img.location,
        color=img.color,
        links=img.links,
        semester_end=None,
    )


OWNER_CLASS = Owner(
    year_id="y1",
    year_name="2026",
    semester_id="s1",
    semester_name="Fall 2026",
    semester_start=date(2026, 9, 21),
    semester_end=date(2027, 1, 10),
    course_id="c1",
    course_name="CS 201",
    course_color="teal",
)
OWNER_EVENT = Owner(year_id="y1", year_name="2026", semester_id="s1", semester_name="Fall 2026")

MOVED = ExceptionImage(
    original_date=date(2026, 10, 7),
    kind="modified",
    start_time=time(12, 0),
    end_time=time(13, 0),
    title="Moved talk",
    color="red",
    links_json='[{"label": null, "url": "https://z.edu"}]',
    moved_date=date(2026, 10, 9),
    detached=True,
    version=2,
)
ROOM = ExceptionImage(original_date=date(2026, 11, 4), kind="modified", location="Room B")


def before(title: str | None) -> BeforeState:
    return BeforeState(
        segments=(image("S1", MON, title), image("S2", LATER, title, split="S1")),
        exceptions={MOVED.original_date: MOVED, ROOM.original_date: ROOM},
    )


def views(b: BeforeState) -> list[ExceptionView]:
    return [
        ExceptionView(e.original_date, e.kind, e.start_time, e.end_time, e.location, e.version)
        for e in b.exceptions.values()
    ]


@pytest.mark.parametrize(
    ("kind", "title", "owner"), [("class", None, OWNER_CLASS), ("event", "Talk", OWNER_EVENT)]
)
@pytest.mark.parametrize(
    ("scope", "day"),
    [
        ("this", date(2026, 10, 12)),
        ("this", MOVED.original_date),
        ("following", date(2026, 10, 21)),
        ("all", MON),
    ],
)
def test_round_trip(kind: str, title: str | None, owner: Owner, scope: str, day: date) -> None:
    b = before(title)
    cs = plan_delete([segment(s) for s in b.segments], views(b), day, scope)
    p = build(kind, "L1", owner, cs, b)

    assert p.segments == b.segments  # every segment, as it was
    if scope == "this":
        assert p.created_cancels == (day,)
        # a cancel over an existing exception keeps that exception's before-image
        assert p.exceptions_before == ((MOVED,) if day == MOVED.original_date else ())
    elif scope == "following":
        assert p.created_cancels == ()
        assert p.exceptions_before == (ROOM,)  # only the ones from `day` on were removed
    else:
        assert p.exceptions_before == (MOVED, ROOM)

    done = p.with_result(
        [Removed(day, "S1"), Removed(MON, None)], {"S1": 4}, (time(10, 0), time(11, 30))
    )
    assert done.removed[0].original_date == MON  # sorted
    again = TrashPayloadV1.from_json(done.to_json())
    assert again == done


def test_unknown_version_is_refused() -> None:
    p = build(
        "event",
        "L1",
        OWNER_EVENT,
        plan_delete([segment(image("S1", MON, "Talk"))], [], MON, "all"),
        BeforeState(segments=(image("S1", MON, "Talk"),), exceptions={}),
    )
    raw = p.to_json().replace('"v": 1', '"v": 99')
    with pytest.raises(ValueError):
        TrashPayloadV1.from_json(raw)
