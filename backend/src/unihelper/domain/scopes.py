"""Google-style edit/delete scopes for recurring classes (FR-018a, data-model "Edit scopes").

Pure planning: given a class lineage (its segments + single-session exceptions), a target
session date, a scope and the requested changes, return a ChangeSet the service applies in
one transaction. Session keys ({lineage_id}:{original_date}) never change.
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from datetime import date, time, timedelta
from typing import Any

from unihelper.domain.recurrence import ExceptionView, Rule, RuleError, occurrence_dates

SCOPES = ("this", "following", "all")
THIS_FIELDS = {"start_time", "end_time", "location"}
SERIES_FIELDS = {"title", "location", "color", "start_time", "end_time", "links", "recurrence"}


@dataclass(frozen=True)
class Segment:
    id: str
    start_date: date
    rule: Rule
    title: str | None
    location: str | None
    color: str
    links: tuple[tuple[str | None, str], ...]
    semester_end: date | None


@dataclass
class NewSegment:
    split_from_id: str
    values: dict[str, Any]


@dataclass
class ChangeSet:
    updates: dict[str, dict[str, Any]] = field(default_factory=dict)
    inserts: list[NewSegment] = field(default_factory=list)
    deletes: list[str] = field(default_factory=list)
    exception_upserts: dict[date, dict[str, Any]] = field(default_factory=dict)
    exception_deletes: set[date] = field(default_factory=set)
    preserved_overrides: int = 0
    removed_overrides: int = 0

    @property
    def affected_series_ids(self) -> list[str]:
        return [*self.updates.keys(), *self.deletes]


class ScopeError(ValueError):
    def __init__(self, field: str, code: str, message: str) -> None:
        super().__init__(message)
        self.field, self.code, self.message = field, code, message


# ---- helpers --------------------------------------------------------------------------------


def segment_for(segments: list[Segment], day: date) -> Segment | None:
    for s in segments:
        if occurrence_dates(s.rule, s.semester_end, day, day):
            return s
    return None


def _rule_with(rule: Rule, changes: dict[str, Any], start_date: date | None = None) -> Rule:
    r = rule
    if "start_time" in changes:
        r = replace(r, start_time=changes["start_time"])
    if "end_time" in changes:
        r = replace(r, end_time=changes["end_time"])
    rec = changes.get("recurrence")
    if rec is not None:
        weekly = rec["freq"] == "weekly"
        end = rec.get("end") or {}
        r = replace(
            r,
            freq=rec["freq"],
            interval_weeks=rec.get("interval_weeks", 1) if weekly else 1,
            by_weekday=tuple(rec.get("by_weekday", ())) if weekly else (),
            end_kind=(end.get("kind") or "until") if weekly else "never",
            until_date=end.get("until_date") if weekly else None,
            count=end.get("count") if weekly else None,
        )
    if start_date is not None:
        r = replace(r, start_date=start_date)
    return r


def _values(rule: Rule, changes: dict[str, Any], seg: Segment) -> dict[str, Any]:
    """Column values for a segment after applying `changes`."""
    return {
        "title": changes.get("title", seg.title),
        "location": changes.get("location", seg.location),
        "color": changes.get("color", seg.color),
        "links": changes.get("links", list(seg.links)),
        "start_date": rule.start_date,
        "start_time": rule.start_time,
        "end_time": rule.end_time,
        "freq": rule.freq,
        "interval_weeks": rule.interval_weeks,
        "by_weekday": ",".join(rule.by_weekday),
        "end_kind": rule.end_kind,
        "until_date": rule.until_date,
        "count": rule.count,
    }


def _check_rule(rule: Rule, semester_end: date | None) -> None:
    from unihelper.domain.recurrence import validate_rule

    try:
        validate_rule(rule, semester_end)
    except RuleError as err:
        raise ScopeError(err.field, err.code, err.message) from err


def _dates_until(seg: Segment, before: date) -> int:
    """Number of sessions the segment generates strictly before `before`."""
    if before <= seg.start_date:
        return 0
    return len(
        occurrence_dates(seg.rule, seg.semester_end, seg.start_date, before - timedelta(days=1))
    )


def _truncate(seg: Segment, day: date) -> dict[str, Any] | None:
    """Values that end `seg` the day before `day`; None if nothing would remain."""
    last = day - timedelta(days=1)
    if not occurrence_dates(seg.rule, seg.semester_end, seg.start_date, last):
        return None
    return {"end_kind": "until", "until_date": last, "count": None}


def _remaining_rule(seg: Segment, day: date, rule: Rule) -> Rule:
    """Keep the original ending for the new segment; a count ending keeps its remaining count."""
    if (
        rule.end_kind == "count"
        and rule.count
        and seg.rule.end_kind == "count"
        and seg.rule.count == rule.count
    ):
        remaining = max(rule.count - _dates_until(seg, day), 1)
        return replace(rule, count=remaining)
    return rule


def _reconcile_exceptions(
    cs: ChangeSet,
    exceptions: list[ExceptionView],
    still_generated: Any,
    since: date | None = None,
) -> None:
    """Drop exceptions whose date the new rules no longer generate; count kept overrides."""
    for e in exceptions:
        if since is not None and e.original_date < since:
            continue
        if e.original_date in cs.exception_upserts:
            continue
        if not still_generated(e.original_date):
            cs.exception_deletes.add(e.original_date)
            if e.kind == "modified":
                cs.removed_overrides += 1
        elif e.kind == "modified":
            cs.preserved_overrides += 1


# ---- planning -------------------------------------------------------------------------------


def plan_edit(
    segments: list[Segment],
    exceptions: list[ExceptionView],
    day: date,
    scope: str,
    changes: dict[str, Any],
) -> ChangeSet:
    target = segment_for(segments, day)
    if target is None:
        raise ScopeError("/sessionKey", "not_found", "Session not found")
    cs = ChangeSet()
    if scope == "this":
        extra = set(changes) - THIS_FIELDS
        if extra:
            raise ScopeError(
                f"/{sorted(extra)[0]}",
                "field_not_allowed",
                "Only the time and location can change for a single session.",
            )
        existing = next((e for e in exceptions if e.original_date == day), None)
        st = changes.get("start_time", existing.start_time if existing else None)
        et = changes.get("end_time", existing.end_time if existing else None)
        if (et or target.rule.end_time) <= (st or target.rule.start_time):
            raise ScopeError(
                "/endTime", "invalid_time_range", "End time must be after the start time."
            )
        cs.exception_upserts[day] = {
            "kind": "modified",
            "start_time": st,
            "end_time": et,
            "location": changes.get("location", existing.location if existing else None),
        }
        return cs

    ordered = sorted(segments, key=lambda s: s.start_date)
    lineage_start = ordered[0].start_date
    since: date | None
    if scope == "following" and day > target.start_date:
        trunc = _truncate(target, day)
        if trunc is None:
            cs.deletes.append(target.id)
        else:
            cs.updates[target.id] = trunc
        new_rule = _remaining_rule(target, day, _rule_with(target.rule, changes, start_date=day))
        _check_rule(new_rule, target.semester_end)
        cs.inserts.append(
            NewSegment(split_from_id=target.id, values=_values(new_rule, changes, target))
        )
        later = [s for s in ordered if s.start_date > target.start_date]
        since = day
    else:
        # "all", or "following" from the first session of a segment
        later = [s for s in ordered if scope == "all" or s.start_date >= target.start_date]
        since = None if scope == "all" else target.start_date
        if scope == "following" and target.start_date == lineage_start:
            since = None
    new_rules: dict[str, Rule] = {}
    last_id = ordered[-1].id
    for s in later:
        r = _rule_with(s.rule, changes)
        if s.id != last_id and "recurrence" in changes:
            # earlier segments keep the boundary left by a split; only the last one takes
            # the new ending
            r = replace(
                r, end_kind=s.rule.end_kind, until_date=s.rule.until_date, count=s.rule.count
            )
        _check_rule(r, s.semester_end)
        new_rules[s.id] = r
        cs.updates[s.id] = _values(r, changes, s)

    def generated(d: date) -> bool:
        for s in ordered:
            if s.id in cs.deletes:
                continue
            rule = new_rules.get(s.id, s.rule)
            if (
                s.id in cs.updates
                and "until_date" in cs.updates[s.id]
                and cs.updates[s.id].get("end_kind") == "until"
                and s.id not in new_rules
            ):
                rule = replace(
                    rule, end_kind="until", until_date=cs.updates[s.id]["until_date"], count=None
                )
            if occurrence_dates(rule, s.semester_end, d, d):
                return True
        for ins in cs.inserts:
            v = ins.values
            rule = Rule(
                freq=v["freq"],
                interval_weeks=v["interval_weeks"],
                by_weekday=tuple(x for x in v["by_weekday"].split(",") if x),
                end_kind=v["end_kind"],
                until_date=v["until_date"],
                count=v["count"],
                start_date=v["start_date"],
                start_time=v["start_time"],
                end_time=v["end_time"],
            )
            if occurrence_dates(rule, target.semester_end, d, d):
                return True
        return False

    _reconcile_exceptions(cs, exceptions, generated, since=since)
    return cs


def plan_delete(
    segments: list[Segment], exceptions: list[ExceptionView], day: date, scope: str
) -> ChangeSet:
    target = segment_for(segments, day)
    if target is None:
        raise ScopeError("/sessionKey", "not_found", "Session not found")
    cs = ChangeSet()
    ordered = sorted(segments, key=lambda s: s.start_date)
    if scope == "this":
        cs.exception_upserts[day] = {
            "kind": "cancelled",
            "start_time": None,
            "end_time": None,
            "location": None,
        }
        return cs
    if scope == "all" or (scope == "following" and day <= ordered[0].start_date):
        cs.deletes = [s.id for s in ordered]
        cs.exception_deletes = {e.original_date for e in exceptions}
        cs.removed_overrides = sum(1 for e in exceptions if e.kind == "modified")
        return cs
    # following, from a later date: truncate the target, drop later segments
    trunc = _truncate(target, day)
    if trunc is None:
        cs.deletes.append(target.id)
    else:
        cs.updates[target.id] = trunc
    cs.deletes.extend(s.id for s in ordered if s.start_date > target.start_date)
    for e in exceptions:
        if e.original_date >= day:
            cs.exception_deletes.add(e.original_date)
            if e.kind == "modified":
                cs.removed_overrides += 1
    return cs


def time_or_none(value: time | None) -> time | None:
    return value
