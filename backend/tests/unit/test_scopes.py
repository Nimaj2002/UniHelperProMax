"""Edit/delete scope planning (data-model.md "Edit scopes", FR-018a)."""

from __future__ import annotations

from datetime import date, time

import pytest

from unihelper.domain.recurrence import ExceptionView, Rule
from unihelper.domain.scopes import ScopeError, Segment, plan_delete, plan_edit

pytestmark = pytest.mark.unit
MON = date(2026, 9, 28)


def seg(sid: str = "S1", start: date = MON, **rule_kw: object) -> Segment:
    base: dict[str, object] = dict(
        freq="weekly",
        interval_weeks=1,
        by_weekday=("MO", "WE"),
        end_kind="until",
        until_date=date(2026, 12, 31),
        count=None,
        start_date=start,
        start_time=time(10, 0),
        end_time=time(11, 30),
    )
    base.update(rule_kw)
    return Segment(
        id=sid,
        start_date=start,
        rule=Rule(**base),  # type: ignore[arg-type]
        title="Lecture",
        location="Room A",
        color="blue",
        links=((None, "https://x.edu"),),
        semester_end=date(2027, 1, 10),
    )


def exc(d: date, kind: str = "modified", **kw: object) -> ExceptionView:
    return ExceptionView(
        original_date=d,
        kind=kind,
        start_time=kw.get("start"),  # type: ignore
        end_time=kw.get("end"),
        location=kw.get("location"),  # type: ignore
        version=1,
    )


def test_this_edit_creates_modified_exception() -> None:
    cs = plan_edit([seg()], [], date(2026, 9, 30), "this", {"location": "Room B"})
    assert cs.exception_upserts == {
        date(2026, 9, 30): {
            "kind": "modified",
            "start_time": None,
            "end_time": None,
            "location": "Room B",
        }
    }
    assert not cs.updates and not cs.inserts and not cs.deletes


def test_this_edit_merges_existing_exception_and_checks_times() -> None:
    existing = [exc(date(2026, 9, 30), start=time(12, 0), end=time(13, 0), location="B")]
    cs = plan_edit([seg()], existing, date(2026, 9, 30), "this", {"location": "C"})
    assert cs.exception_upserts[date(2026, 9, 30)] == {
        "kind": "modified",
        "start_time": time(12, 0),
        "end_time": time(13, 0),
        "location": "C",
    }
    with pytest.raises(ScopeError) as info:
        plan_edit([seg()], [], date(2026, 9, 30), "this", {"end_time": time(9, 0)})
    assert info.value.code == "invalid_time_range"


def test_this_edit_rejects_series_fields() -> None:
    with pytest.raises(ScopeError) as info:
        plan_edit([seg()], [], date(2026, 9, 30), "this", {"color": "red"})
    assert info.value.code == "field_not_allowed"


def test_this_delete_cancels_one_date() -> None:
    cs = plan_delete([seg()], [], date(2026, 10, 5), "this")
    assert cs.exception_upserts[date(2026, 10, 5)]["kind"] == "cancelled"


def test_following_mid_series_splits() -> None:
    s = seg()
    cs = plan_edit(
        [s],
        [],
        date(2026, 10, 12),
        "following",
        {"start_time": time(11, 0), "end_time": time(12, 30)},
    )
    assert cs.updates == {
        "S1": {"end_kind": "until", "until_date": date(2026, 10, 11), "count": None}
    }
    (new,) = cs.inserts
    assert new.split_from_id == "S1"
    v = new.values
    assert (v["start_date"], v["start_time"], v["end_kind"], v["until_date"]) == (
        date(2026, 10, 12),
        time(11, 0),
        "until",
        date(2026, 12, 31),
    )
    assert v["links"] == [(None, "https://x.edu")]  # links copied


def test_following_keeps_remaining_count() -> None:
    s = seg(end_kind="count", count=10, until_date=None)
    cs = plan_edit([s], [], date(2026, 10, 12), "following", {"location": "B"})
    # 4 sessions before 12 Oct (28/9, 30/9, 5/10, 7/10) → 6 remain
    assert cs.inserts[0].values["count"] == 6


def test_following_at_segment_start_behaves_like_all_for_later_segments() -> None:
    a = seg("A", until_date=date(2026, 10, 11))  # as left by an earlier split
    b = seg("B", start=date(2026, 10, 12))
    cs = plan_edit([a, b], [], date(2026, 10, 12), "following", {"color": "green"})
    assert set(cs.updates) == {"B"} and not cs.inserts
    assert cs.updates["B"]["color"] == "green"


def test_following_delete_only_truncates() -> None:
    a, b = seg("A", until_date=date(2026, 11, 1)), seg("B", start=date(2026, 11, 2))
    exceptions = [exc(date(2026, 10, 5)), exc(date(2026, 10, 19), location="X")]
    cs = plan_delete([a, b], exceptions, date(2026, 10, 12), "following")
    assert cs.updates == {
        "A": {"end_kind": "until", "until_date": date(2026, 10, 11), "count": None}
    }
    assert cs.deletes == ["B"] and not cs.inserts
    assert cs.exception_deletes == {date(2026, 10, 19)} and cs.removed_overrides == 1


def test_following_delete_from_first_session_deletes_everything() -> None:
    cs = plan_delete([seg()], [exc(MON)], MON, "following")
    assert cs.deletes == ["S1"] and cs.exception_deletes == {MON}


def test_all_updates_every_segment_and_preserves_overrides() -> None:
    a, b = seg("A", until_date=date(2026, 11, 1)), seg("B", start=date(2026, 11, 2))
    exceptions = [exc(date(2026, 10, 5), location="B"), exc(date(2026, 10, 7), kind="cancelled")]
    cs = plan_edit([a, b], exceptions, date(2026, 11, 2), "all", {"color": "green"})
    assert set(cs.updates) == {"A", "B"}
    assert cs.preserved_overrides == 1 and cs.removed_overrides == 0
    assert not cs.exception_deletes


def test_all_removes_overrides_no_longer_generated() -> None:
    exceptions = [exc(date(2026, 9, 30), location="B")]  # a Wednesday
    rec = {
        "freq": "weekly",
        "interval_weeks": 1,
        "by_weekday": ["MO"],
        "end": {"kind": "until", "until_date": date(2026, 12, 31)},
    }
    cs = plan_edit([seg()], exceptions, MON, "all", {"recurrence": rec})
    assert cs.exception_deletes == {date(2026, 9, 30)}
    assert cs.removed_overrides == 1 and cs.preserved_overrides == 0


def test_all_delete_removes_everything() -> None:
    cs = plan_delete([seg("A"), seg("B", start=date(2026, 11, 2))], [exc(MON)], MON, "all")
    assert sorted(cs.deletes) == ["A", "B"] and cs.exception_deletes == {MON}


def test_unknown_date_is_not_found() -> None:
    with pytest.raises(ScopeError) as info:
        plan_edit([seg()], [], date(2026, 9, 29), "all", {"color": "red"})  # Tuesday
    assert info.value.code == "not_found"


def test_invalid_new_rule_rejected() -> None:
    with pytest.raises(ScopeError) as info:
        plan_edit([seg()], [], MON, "all", {"end_time": time(9, 0)})
    assert info.value.code == "invalid_time_range"


def test_all_recurrence_change_keeps_split_boundaries() -> None:
    a = seg("A", until_date=date(2026, 10, 11))
    b = seg("B", start=date(2026, 10, 12))
    rec = {
        "freq": "weekly",
        "interval_weeks": 1,
        "by_weekday": ["MO", "WE", "FR"],
        "end": {"kind": "until", "until_date": date(2026, 11, 30)},
    }
    cs = plan_edit([a, b], [], MON, "all", {"recurrence": rec})
    assert cs.updates["A"]["until_date"] == date(2026, 10, 11)  # boundary kept
    assert cs.updates["A"]["by_weekday"] == "MO,WE,FR"
    assert cs.updates["B"]["until_date"] == date(2026, 11, 30)  # last segment takes the end


# ---- 009: moved and detached exceptions ---------------------------------------------------

END = {"kind": "until", "until_date": date(2026, 12, 31), "count": None}


def test_series_edit_keeps_detached_occurrences() -> None:
    """A frozen (detached) occurrence stays even when the new rule drops its date; it counts as
    kept, like an individually edited one (009 research R4)."""
    frozen = ExceptionView(
        original_date=date(2026, 10, 5),  # a Monday
        kind="modified",
        start_time=time(10, 0),
        end_time=time(11, 30),
        location="Room A",
        version=1,
        title="Lecture",
        detached=True,
    )
    plain = exc(date(2026, 10, 12))  # another Monday, modified but not frozen
    cs = plan_edit(
        [seg()],
        [frozen, plain],
        MON,
        "all",
        {"recurrence": {"freq": "weekly", "by_weekday": ["WE"], "end": END}},
    )
    assert date(2026, 10, 5) not in cs.exception_deletes
    assert date(2026, 10, 12) in cs.exception_deletes
    assert (cs.preserved_overrides, cs.removed_overrides) == (1, 1)


def test_moved_exception_is_keyed_by_its_original_date() -> None:
    """Rules decide on the original date; where it is shown (`moved_date`) doesn't matter."""
    moved = ExceptionView(
        original_date=date(2026, 9, 30),
        kind="modified",
        start_time=None,
        end_time=None,
        location=None,
        version=1,
        moved_date=date(2026, 10, 2),
    )
    keep = plan_edit([seg()], [moved], MON, "all", {"location": "Room C"})
    assert not keep.exception_deletes and keep.preserved_overrides == 1
    drop = plan_edit(
        [seg()],
        [moved],
        MON,
        "all",
        {"recurrence": {"freq": "weekly", "by_weekday": ["MO"], "end": END}},
    )
    assert drop.exception_deletes == {date(2026, 9, 30)}
