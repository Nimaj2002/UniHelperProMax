from __future__ import annotations

from datetime import UTC, date, datetime, time

import pytest

from unihelper.domain.recurrence import (
    ExceptionView,
    Rule,
    RuleError,
    expand,
    expand_detached,
    occurrence_dates,
    recurrence_summary,
    session_key,
    validate_rule,
)

pytestmark = pytest.mark.unit

MON = date(2026, 9, 28)  # a Monday


def rule(**kw: object) -> Rule:
    base: dict[str, object] = dict(
        freq="weekly",
        interval_weeks=1,
        by_weekday=("MO", "WE"),
        end_kind="until",
        until_date=date(2026, 10, 31),
        count=None,
        start_date=MON,
        start_time=time(10, 0),
        end_time=time(11, 30),
    )
    base.update(kw)
    return Rule(**base)  # type: ignore[arg-type]


def dates(
    r: Rule, sem_end: date | None = None, a: date = date(2026, 1, 1), b: date = date(2027, 12, 31)
) -> list[date]:
    return occurrence_dates(r, sem_end, a, b)


def test_none_yields_single_date() -> None:
    assert dates(rule(freq="none", by_weekday=(), end_kind="never", until_date=None)) == [MON]


def test_weekly_mon_wed() -> None:
    got = dates(rule(until_date=date(2026, 10, 14)))
    assert got == [
        date(2026, 9, 28),
        date(2026, 9, 30),
        date(2026, 10, 5),
        date(2026, 10, 7),
        date(2026, 10, 12),
        date(2026, 10, 14),
    ]


def test_until_is_inclusive() -> None:
    assert dates(rule(until_date=date(2026, 9, 30)))[-1] == date(2026, 9, 30)


def test_interval_two_weeks() -> None:
    got = dates(rule(interval_weeks=2, by_weekday=("MO",), until_date=date(2026, 11, 2)))
    assert got == [date(2026, 9, 28), date(2026, 10, 12), date(2026, 10, 26)]


def test_count() -> None:
    got = dates(rule(end_kind="count", count=5, until_date=None))
    assert len(got) == 5 and got[-1] == date(2026, 10, 12)


def test_start_date_not_matching_weekday_is_skipped() -> None:
    got = dates(rule(start_date=date(2026, 9, 29), until_date=date(2026, 10, 6)))  # Tuesday start
    assert got == [date(2026, 9, 30), date(2026, 10, 5)]


def test_semester_end_is_dynamic() -> None:
    r = rule(end_kind="semester_end", until_date=None)
    assert dates(r, date(2026, 10, 7))[-1] == date(2026, 10, 7)
    assert dates(r, date(2026, 10, 14))[-1] == date(2026, 10, 14)


def test_range_clipping() -> None:
    got = dates(rule(until_date=date(2026, 12, 31)), a=date(2026, 10, 5), b=date(2026, 10, 11))
    assert got == [date(2026, 10, 5), date(2026, 10, 7)]


def test_dst_keeps_wall_clock() -> None:
    r = rule(by_weekday=("MO",), start_date=date(2026, 10, 19), until_date=date(2026, 10, 26))
    sessions = expand(
        r,
        lineage_id="L",
        series_id="S",
        semester_end=None,
        range_from=date(2026, 10, 1),
        range_to=date(2026, 10, 31),
        tz="Europe/Berlin",
        now=datetime(2026, 1, 1, tzinfo=UTC),
    )
    assert [s.start.isoformat() for s in sessions] == [
        "2026-10-19T10:00:00+02:00",
        "2026-10-26T10:00:00+01:00",
    ]
    assert sessions[1].end.isoformat() == "2026-10-26T11:30:00+01:00"


def test_status_upcoming_vs_past() -> None:
    r = rule(until_date=date(2026, 9, 30))
    now = datetime(2026, 9, 29, 12, 0, tzinfo=UTC)
    s = expand(
        r,
        lineage_id="L",
        series_id="S",
        semester_end=None,
        range_from=MON,
        range_to=date(2026, 9, 30),
        tz="UTC",
        now=now,
    )
    assert [x.status for x in s] == ["past", "upcoming"]


def test_session_key_format() -> None:
    assert session_key("abc", date(2026, 10, 5)) == "abc:2026-10-05"
    s = expand(
        rule(until_date=MON),
        lineage_id="lin",
        series_id="S",
        semester_end=None,
        range_from=MON,
        range_to=MON,
        tz="UTC",
        now=datetime(2026, 1, 1, tzinfo=UTC),
    )
    assert s[0].key == "lin:2026-09-28"


def test_exceptions_cancel_and_modify() -> None:
    r = rule(until_date=date(2026, 10, 7))
    exc = [
        ExceptionView(
            original_date=date(2026, 9, 30),
            kind="cancelled",
            start_time=None,
            end_time=None,
            location=None,
            version=1,
        ),
        ExceptionView(
            original_date=date(2026, 10, 5),
            kind="modified",
            start_time=time(12, 0),
            end_time=time(13, 0),
            location="Room B",
            version=3,
        ),
    ]
    s = expand(
        r,
        lineage_id="L",
        series_id="S",
        semester_end=None,
        range_from=MON,
        range_to=date(2026, 10, 7),
        tz="UTC",
        now=datetime(2026, 1, 1, tzinfo=UTC),
        exceptions=exc,
        location="Room A",
    )
    assert [x.date for x in s] == [date(2026, 9, 28), date(2026, 10, 5), date(2026, 10, 7)]
    mod = s[1]
    assert (
        mod.start.hour,
        mod.end.hour,
        mod.location,
        mod.is_exception,
        mod.exception_version,
    ) == (12, 13, "Room B", True, 3)
    assert s[0].location == "Room A" and not s[0].is_exception


def _moved(original: date, to: date, **kw: object) -> ExceptionView:
    return ExceptionView(
        original_date=original,
        kind="modified",
        start_time=kw.get("start"),  # type: ignore[arg-type]
        end_time=kw.get("end"),  # type: ignore[arg-type]
        location=None,
        version=2,
        title=kw.get("title"),  # type: ignore[arg-type]
        color=kw.get("color"),  # type: ignore[arg-type]
        moved_date=to,
        detached=bool(kw.get("detached", False)),
    )


def _expand(r: Rule, a: date, b: date, exc: list[ExceptionView]) -> list[object]:
    return expand(  # type: ignore[return-value]
        r,
        lineage_id="L",
        series_id="S",
        semester_end=None,
        range_from=a,
        range_to=b,
        tz="UTC",
        now=datetime(2026, 1, 1, tzinfo=UTC),
        exceptions=exc,
        location="Room A",
    )


def test_moved_occurrence_shows_on_its_new_date_and_keeps_its_key() -> None:
    """009 research R3: an event moved from Mon 5 Oct to Fri 9 Oct."""
    r = rule(until_date=date(2026, 10, 14))
    exc = [_moved(date(2026, 10, 5), date(2026, 10, 9), title="Moved", color="red")]
    week = _expand(r, date(2026, 10, 5), date(2026, 10, 11), exc)
    assert [(x.date, x.key) for x in week] == [  # type: ignore[attr-defined]
        (date(2026, 10, 7), "L:2026-10-07"),
        (date(2026, 10, 9), "L:2026-10-05"),
    ]
    moved = week[1]
    assert (moved.start.date(), moved.title, moved.color, moved.is_exception) == (  # type: ignore[attr-defined]
        date(2026, 10, 9),
        "Moved",
        "red",
        True,
    )
    # shown when only its new date is in range, hidden when only its original date is
    later = _expand(r, date(2026, 10, 8), date(2026, 10, 9), exc)
    assert [x.key for x in later] == ["L:2026-10-05"]  # type: ignore[attr-defined]
    assert _expand(r, date(2026, 10, 5), date(2026, 10, 5), exc) == []
    # a moved date whose original date the rule doesn't generate shows nothing
    stray = [_moved(date(2026, 10, 6), date(2026, 10, 9))]
    assert [x.key for x in _expand(r, date(2026, 10, 9), date(2026, 10, 9), stray)] == []  # type: ignore[attr-defined]


def test_detached_occurrence_outlives_its_rule() -> None:
    """009 research R4: a frozen occurrence stays scheduled when no rule generates it."""
    r = rule(until_date=date(2026, 10, 7))
    frozen = ExceptionView(
        original_date=date(2026, 10, 12),
        kind="modified",
        start_time=time(14, 0),
        end_time=time(15, 0),
        location="Hall",
        version=4,
        title="AI Seminar",
        detached=True,
    )
    other = ExceptionView(
        original_date=date(2026, 10, 14),
        kind="modified",
        start_time=time(9, 0),
        end_time=time(10, 0),
        location=None,
        version=1,
    )
    assert _expand(r, date(2026, 10, 12), date(2026, 10, 18), [frozen, other]) == []

    def generated(day: date) -> bool:
        return bool(occurrence_dates(r, None, day, day))

    views = expand_detached(
        [frozen, other],
        generated,
        lineage_id="L",
        series_id="S",
        range_from=date(2026, 10, 12),
        range_to=date(2026, 10, 18),
        tz="UTC",
        now=datetime(2026, 1, 1, tzinfo=UTC),
        start_time=time(10, 0),
        end_time=time(11, 30),
    )
    assert [(v.key, v.start.hour, v.location, v.title, v.detached) for v in views] == [
        ("L:2026-10-12", 14, "Hall", "AI Seminar", True)
    ]
    # still generated → `expand` emits it (with its overrides), `expand_detached` does not
    assert (
        expand_detached(
            [frozen],
            lambda _d: True,
            lineage_id="L",
            series_id="S",
            range_from=date(2026, 10, 1),
            range_to=date(2026, 10, 31),
            tz="UTC",
            now=datetime(2026, 1, 1, tzinfo=UTC),
            start_time=time(10, 0),
            end_time=time(11, 30),
        )
        == []
    )


def test_summary() -> None:
    assert (
        recurrence_summary(rule(end_kind="semester_end", until_date=None))
        == "Weekly on Mon, Wed until semester end"
    )
    assert (
        recurrence_summary(rule(interval_weeks=2, by_weekday=("FR",)))
        == "Every 2 weeks on Fri until 31 Oct 2026"
    )
    assert (
        recurrence_summary(rule(end_kind="count", count=10, until_date=None))
        == "Weekly on Mon, Wed, 10 times"
    )
    assert (
        recurrence_summary(rule(freq="none", by_weekday=(), end_kind="never")) == "Does not repeat"
    )


def test_validate_ok() -> None:
    validate_rule(rule(), semester_end=None)


@pytest.mark.parametrize(
    ("kw", "sem_end", "code", "field"),
    [
        ({"end_time": time(10, 0)}, None, "invalid_time_range", "/endTime"),
        ({"end_time": time(9, 0)}, None, "invalid_time_range", "/endTime"),
        ({"by_weekday": ()}, None, "weekday_required", "/recurrence/byWeekday"),
        (
            {"end_kind": "semester_end", "until_date": None},
            None,
            "semester_end_missing",
            "/recurrence/end/kind",
        ),
        (
            {"end_kind": "until", "until_date": None},
            None,
            "until_required",
            "/recurrence/end/untilDate",
        ),
        (
            {"until_date": date(2026, 9, 1)},
            None,
            "series_ends_before_start",
            "/recurrence/end/untilDate",
        ),
        (
            {"end_kind": "semester_end", "until_date": None},
            date(2026, 9, 1),
            "series_ends_before_start",
            "/recurrence/end/kind",
        ),
        (
            {"end_kind": "count", "count": 0, "until_date": None},
            None,
            "invalid_count",
            "/recurrence/end/count",
        ),
        (
            {"end_kind": "count", "count": 501, "until_date": None},
            None,
            "invalid_count",
            "/recurrence/end/count",
        ),
        ({"interval_weeks": 0}, None, "invalid_interval", "/recurrence/intervalWeeks"),
        ({"interval_weeks": 9}, None, "invalid_interval", "/recurrence/intervalWeeks"),
        (
            {"until_date": date(2026, 9, 29), "by_weekday": ("FR",)},
            None,
            "no_sessions",
            "/recurrence",
        ),
    ],
)
def test_validate_errors(
    kw: dict[str, object], sem_end: date | None, code: str, field: str
) -> None:
    with pytest.raises(RuleError) as info:
        validate_rule(rule(**kw), semester_end=sem_end)
    assert (info.value.code, info.value.field) == (code, field)
