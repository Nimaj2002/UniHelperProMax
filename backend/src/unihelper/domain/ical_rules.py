"""Mapping iCalendar events onto the app's schedule model (010 research R4, R5, R7).

Pure. The app stores wall-clock times in the user's zone and repeats only weekly (every 1–8
weeks on chosen weekdays, ending on a date or after N times). `normalize` turns the parsed file
into `SourceEntry`s (one per master event, standalone override or extra RDATE); `expand` lists
an entry's occurrences in the user's zone and fits them into app rule segments. Where the
source zone changes its UTC offset on other dates than the user's zone, the series is split into
several segments of one lineage, each keeping exact local times. Nothing is approximated: a
rule the app can't express exactly is reported as unsupported.
"""

from __future__ import annotations

import hashlib
from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, time, timedelta, tzinfo
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from dateutil import rrule as du

from unihelper.domain.ical_read import Link, ParsedCalendar, RawEvent
from unihelper.domain.recurrence import MAX_COUNT, MAX_INTERVAL, WEEKDAYS, Rule, occurrence_dates

ALL_DAY = "all_day"
CANCELLED = "cancelled"
INVALID_TIMES = "invalid_times"

SKIP_MESSAGES = {
    ALL_DAY: "all-day events are not supported yet",
    CANCELLED: "it is cancelled in the file",
    INVALID_TIMES: "its end is not after its start",
}

_DU_DAYS = dict(zip(WEEKDAYS, (du.MO, du.TU, du.WE, du.TH, du.FR, du.SA, du.SU), strict=True))
_ALLOWED_PARTS = {"FREQ", "INTERVAL", "BYDAY", "UNTIL", "COUNT", "WKST"}
DEFAULT_OPEN_WEEKS = 16

Key = datetime  # an occurrence's original start, as wall time in the series' anchor zone


@dataclass
class Override:
    """A RECURRENCE-ID instance: cancelled, or new values for one occurrence."""

    key: Key | date
    recurrence_key: str
    cancelled: bool
    day: date | None = None  # user-local, None when the override itself can't be used
    start: time | None = None
    end: time | None = None
    location: str = ""
    title: str = ""
    links: list[Link] = field(default_factory=list)


@dataclass(frozen=True)
class Occ:
    key: Key
    day: date
    start: time
    end: time


@dataclass(frozen=True)
class SegmentSpec:
    freq: str  # "none" | "weekly"
    start_date: date
    start_time: time
    end_time: time
    weekdays: tuple[str, ...] = ()
    interval_weeks: int = 1
    end_kind: str = "never"  # "never" (one-time) | "until" | "count"
    until_date: date | None = None
    count: int | None = None

    def rule(self) -> Rule:
        return Rule(
            freq=self.freq,
            interval_weeks=self.interval_weeks,
            by_weekday=self.weekdays,
            end_kind=self.end_kind,
            until_date=self.until_date,
            count=self.count,
            start_date=self.start_date,
            start_time=self.start_time,
            end_time=self.end_time,
        )


@dataclass
class WeeklyRule:
    interval: int
    weekdays: tuple[str, ...]
    wkst: str
    until: datetime | None  # anchor wall time, inclusive
    count: int | None


@dataclass
class SourceEntry:
    entry_id: str
    uid: str
    recurrence_key: str
    title: str
    location: str
    links: list[Link]
    notes: list[str]
    app: dict[str, str]
    skip: str | None = None
    repeating: bool = False
    unsupported: str | None = None
    open_ended: bool = False
    # series state (set when the entry is valid)
    anchor: tzinfo | None = None
    start_key: Key | None = None  # first start, anchor wall time
    duration: timedelta | None = None
    rule: WeeklyRule | None = None
    exdates: list[Key | date] = field(default_factory=list)
    overrides: list[Override] = field(default_factory=list)
    first_day: date | None = None
    first_start: time | None = None
    first_end: time | None = None


@dataclass
class Expansion:
    segments: list[SegmentSpec]
    occs: list[Occ]
    cancelled: set[date]
    modified: dict[date, Override]
    orphans: list[Override]
    unsupported: str | None
    notes: list[str]

    @property
    def scheduled(self) -> list[Occ]:
        return [o for o in self.occs if o.day not in self.cancelled]


# ---- zones -------------------------------------------------------------------------------


def zone(name: str | None) -> ZoneInfo | None:
    if not name:
        return None
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        return None


def _is_utc(tz: tzinfo | None) -> bool:
    if tz is None:
        return False
    if tz is UTC or getattr(tz, "key", None) in ("UTC", "Etc/UTC", "Etc/Zulu", "Zulu"):
        return True
    return str(tz).upper() in ("UTC", "UTC+00:00", "TZUTC()")


def zone_label(tz: tzinfo | None) -> str:
    key = getattr(tz, "key", None)
    if key:
        return str(key)
    name = getattr(tz, "_tzid", None) or (tz.tzname(datetime(2026, 1, 1)) if tz else None)
    return str(name or "the file's time zone")


def _minute(t: time) -> time:
    return t.replace(second=0, microsecond=0, tzinfo=None)


def to_user(value: datetime, user_zone: ZoneInfo) -> datetime:
    """A start or end in the user's zone; floating times are already user wall time."""
    if value.tzinfo is None:
        return value.replace(tzinfo=user_zone)
    return value.astimezone(user_zone)


def _anchor(
    dtstart: datetime, calendar_zone: ZoneInfo | None, user_zone: ZoneInfo
) -> tuple[tzinfo, Key]:
    """The zone a repeating series keeps its wall time in (R5): its own TZID; for UTC or
    floating starts the calendar's zone (`X-WR-TIMEZONE`) or the user's."""
    if dtstart.tzinfo is None:
        return user_zone, dtstart
    if _is_utc(dtstart.tzinfo):
        z = calendar_zone or user_zone
        return z, dtstart.astimezone(z).replace(tzinfo=None)
    return dtstart.tzinfo, dtstart.replace(tzinfo=None)


def _key_of(value: date | datetime, anchor: tzinfo) -> Key | date:
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(microsecond=0)
        return value.astimezone(anchor).replace(tzinfo=None, microsecond=0)
    return value


def _local(
    key: Key, anchor: tzinfo, duration: timedelta, user_zone: ZoneInfo
) -> tuple[datetime, datetime]:
    start = key.replace(tzinfo=anchor).astimezone(user_zone)
    end = (key.replace(tzinfo=anchor).astimezone(UTC) + duration).astimezone(user_zone)
    return start, end


# ---- rules -------------------------------------------------------------------------------


def parse_rule(raw: RawEvent, anchor: tzinfo, start_key: Key) -> WeeklyRule | str:
    """A weekly rule the app can hold, or the reason it can't (R4)."""
    if len(raw.rrules) > 1 or raw.exrule:
        return "it combines several repetition rules"
    parts = {str(k).upper(): v for k, v in raw.rrules[0].items()}
    freq = str(parts.get("FREQ", [""])[0]).upper()
    if freq != "WEEKLY":
        names = {"DAILY": "daily", "MONTHLY": "monthly", "YEARLY": "yearly"}
        what = names.get(freq, freq.lower() or "unknown")
        return f"it repeats {what}; only weekly repetition is supported"
    extra = sorted(set(parts) - _ALLOWED_PARTS)
    if extra:
        return f"its weekly rule uses {', '.join(extra)}"
    interval = int(parts.get("INTERVAL", [1])[0] or 1)
    if not 1 <= interval <= MAX_INTERVAL:
        return f"it repeats every {interval} weeks; at most every {MAX_INTERVAL} weeks is supported"
    days: list[str] = []
    for d in parts.get("BYDAY", []):
        code = str(d).upper()
        if code not in WEEKDAYS:
            return "it repeats on numbered weekdays (such as the 2nd Tuesday)"
        days.append(code)
    if not days:
        days = [WEEKDAYS[start_key.weekday()]]
    wkst = str(parts.get("WKST", ["MO"])[0]).upper()
    if wkst not in WEEKDAYS:
        wkst = "MO"
    count = parts.get("COUNT", [None])[0]
    if count is not None:
        count = int(count)
        if not 1 <= count <= MAX_COUNT:
            return f"it repeats {count} times; at most {MAX_COUNT} is supported"
    until_raw = parts.get("UNTIL", [None])[0]
    until: datetime | None = None
    if isinstance(until_raw, datetime):
        until = _key_of(until_raw, anchor)  # type: ignore[assignment]
    elif isinstance(until_raw, date):
        until = datetime.combine(until_raw, time(23, 59, 59))
    ordered = tuple(d for d in WEEKDAYS if d in set(days))
    return WeeklyRule(interval=interval, weekdays=ordered, wkst=wkst, until=until, count=count)


def _rule_keys(entry: SourceEntry, open_end: date | None) -> list[Key] | str:
    assert entry.rule is not None and entry.start_key is not None
    r = entry.rule
    kwargs: dict[str, Any] = {}
    if r.count is not None:
        kwargs["count"] = r.count
    elif r.until is not None:
        kwargs["until"] = r.until
    else:
        end = open_end or (entry.first_day or entry.start_key.date()) + timedelta(
            weeks=DEFAULT_OPEN_WEEKS
        )
        kwargs["until"] = datetime.combine(end, time(23, 59, 59))
    rr = du.rrule(
        du.WEEKLY,
        interval=r.interval,
        byweekday=[_DU_DAYS[d] for d in r.weekdays],
        dtstart=entry.start_key,
        wkst=_DU_DAYS[r.wkst],
        **kwargs,
    )
    keys: list[Key] = []
    for k in rr:
        keys.append(k)
        if len(keys) > MAX_COUNT:
            return f"it repeats more than {MAX_COUNT} times"
    return keys


# ---- entries -----------------------------------------------------------------------------


def _entry_id(uid: str, recurrence_key: str) -> str:
    return hashlib.sha1(f"{uid}\x00{recurrence_key}".encode()).hexdigest()[:16]


def _duration(raw: RawEvent, start: datetime) -> timedelta | None:
    if isinstance(raw.dtend, datetime):
        end = raw.dtend
        if (end.tzinfo is None) != (start.tzinfo is None):
            return None
        return end - start
    if raw.dtend is not None:  # a DATE end on a timed start
        return None
    if raw.duration is not None:
        return raw.duration
    return timedelta(0)  # RFC 5545: a timed event without end or duration has no length


def _base(raw: RawEvent, recurrence_key: str = "") -> SourceEntry:
    return SourceEntry(
        entry_id=_entry_id(raw.uid, recurrence_key),
        uid=raw.uid,
        recurrence_key=recurrence_key,
        title=raw.summary,
        location=raw.location,
        links=list(raw.links),
        notes=list(raw.notes),
        app=dict(raw.x_props),
    )


def _single(
    entry: SourceEntry, start: datetime, duration: timedelta, user_zone: ZoneInfo
) -> SourceEntry:
    if duration <= timedelta(0):
        entry.skip = INVALID_TIMES
        return entry
    s = to_user(start, user_zone)
    e = (s.astimezone(UTC) + duration).astimezone(user_zone)
    if e.date() != s.date() or duration >= timedelta(days=1):
        entry.skip = ALL_DAY
        return entry
    if _minute(e.time()) <= _minute(s.time()):
        entry.skip = INVALID_TIMES
        return entry
    entry.anchor = user_zone
    entry.start_key = s.replace(tzinfo=None)
    entry.duration = duration
    entry.first_day = s.date()
    entry.first_start = _minute(s.time())
    entry.first_end = _minute(e.time())
    return entry


def _override(raw: RawEvent, anchor: tzinfo, user_zone: ZoneInfo, fallback: timedelta) -> Override:
    assert raw.recurrence_id is not None
    key = _key_of(raw.recurrence_id, anchor)
    rk = key.isoformat()
    if raw.status == "CANCELLED":
        return Override(key=key, recurrence_key=rk, cancelled=True)
    ov = Override(
        key=key,
        recurrence_key=rk,
        cancelled=False,
        location=raw.location,
        title=raw.summary,
        links=list(raw.links),
    )
    if isinstance(raw.dtstart, datetime):
        duration = _duration(raw, raw.dtstart)
        duration = fallback if duration is None or duration == timedelta(0) else duration
        s = to_user(raw.dtstart, user_zone)
        e = (s.astimezone(UTC) + duration).astimezone(user_zone)
        if e.date() == s.date() and _minute(e.time()) > _minute(s.time()):
            ov.day, ov.start, ov.end = s.date(), _minute(s.time()), _minute(e.time())
    return ov


def normalize(cal: ParsedCalendar, user_tz: str) -> list[SourceEntry]:
    """Every master event, standalone override and extra RDATE as one entry, in file order."""
    user_zone = ZoneInfo(user_tz)
    calendar_zone = zone(cal.calendar_tz)
    masters: dict[str, RawEvent] = {}
    overrides: dict[str, list[RawEvent]] = {}
    order: list[tuple[str, RawEvent]] = []
    for raw in cal.events:
        if raw.recurrence_id is None:
            if raw.uid in masters:  # a repeated UID: keep the first, report the rest
                masters[raw.uid].notes.append("The file repeats this event; extra copies ignored.")
                continue
            masters[raw.uid] = raw
            order.append(("master", raw))
        else:
            overrides.setdefault(raw.uid, []).append(raw)
            order.append(("override", raw))

    out: list[SourceEntry] = []
    for kind, raw in order:
        if kind == "master":
            out += _master_entries(raw, overrides.get(raw.uid, []), calendar_zone, user_zone)
        elif raw.uid not in masters or not masters[raw.uid].rrules:
            # an override without its series: a one-time entry of its own (R7)
            rk = _key_of(raw.recurrence_id, user_zone).isoformat()  # type: ignore[arg-type]
            entry = _base(raw, rk)
            entry.notes.append("A changed occurrence without its series, imported on its own.")
            if raw.status == "CANCELLED":
                entry.skip = CANCELLED
            else:
                out.append(_timed(entry, raw, user_zone))
                continue
            out.append(entry)
    return out


def _mark_day(entry: SourceEntry, raw: RawEvent, user_zone: ZoneInfo) -> None:
    """The day (and time) an entry starts, also for one that is skipped, so its reason can
    name it ("Holiday (2027-11-05): all-day events are not supported yet")."""
    if isinstance(raw.dtstart, datetime):
        start = to_user(raw.dtstart, user_zone)
        entry.first_day, entry.first_start = start.date(), _minute(start.time())
    elif isinstance(raw.dtstart, date):
        entry.first_day = raw.dtstart


def _timed(entry: SourceEntry, raw: RawEvent, user_zone: ZoneInfo) -> SourceEntry:
    _mark_day(entry, raw, user_zone)
    if not isinstance(raw.dtstart, datetime):
        entry.skip = ALL_DAY if isinstance(raw.dtstart, date) else INVALID_TIMES
        return entry
    duration = _duration(raw, raw.dtstart)
    if duration is None:
        entry.skip = ALL_DAY
        return entry
    return _single(entry, raw.dtstart, duration, user_zone)


def _master_entries(
    raw: RawEvent, overs: Sequence[RawEvent], calendar_zone: ZoneInfo | None, user_zone: ZoneInfo
) -> list[SourceEntry]:
    entry = _base(raw)
    if raw.status == "CANCELLED":
        _mark_day(entry, raw, user_zone)
        entry.skip = CANCELLED
        return [entry]
    if not raw.rrules:
        return [_timed(entry, raw, user_zone), *_rdate_entries(raw, entry, user_zone, None)]
    entry.repeating = True
    _mark_day(entry, raw, user_zone)
    if not isinstance(raw.dtstart, datetime):
        entry.skip = ALL_DAY if isinstance(raw.dtstart, date) else INVALID_TIMES
        return [entry]
    duration = _duration(raw, raw.dtstart)
    if duration is None:
        entry.skip = ALL_DAY
        return [entry]
    if duration <= timedelta(0):
        entry.skip = INVALID_TIMES
        return [entry]
    anchor, start_key = _anchor(raw.dtstart, calendar_zone, user_zone)
    s, e = _local(start_key, anchor, duration, user_zone)
    if e.date() != s.date() or duration >= timedelta(days=1):
        entry.skip = ALL_DAY
        return [entry]
    entry.anchor = anchor
    entry.start_key = start_key.replace(microsecond=0)
    entry.duration = duration
    entry.first_day = s.date()
    entry.first_start = _minute(s.time())
    entry.first_end = _minute(e.time())
    if _minute(e.time()) <= _minute(s.time()):
        entry.skip = INVALID_TIMES
        return [entry]
    rule = parse_rule(raw, anchor, entry.start_key)
    if isinstance(rule, str):
        entry.unsupported = rule
    else:
        entry.rule = rule
        entry.open_ended = rule.count is None and rule.until is None
    entry.exdates = [_key_of(d, anchor) for d in raw.exdates]
    entry.overrides = [_override(o, anchor, user_zone, duration) for o in overs]
    return [entry, *_rdate_entries(raw, entry, user_zone, anchor)]


def _rdate_entries(
    raw: RawEvent, master: SourceEntry, user_zone: ZoneInfo, anchor: tzinfo | None
) -> list[SourceEntry]:
    out: list[SourceEntry] = []
    for value in raw.rdates:
        rk = "rdate:" + (value.isoformat() if isinstance(value, (date, datetime)) else str(value))
        entry = _base(raw, rk)
        entry.notes.append("An extra date listed in the file, imported as a one-time entry.")
        if master.skip == CANCELLED:
            entry.skip = CANCELLED
        elif not isinstance(value, datetime):
            entry.skip = ALL_DAY
        else:
            duration = raw.rdate_durations.get(value) or master.duration
            if duration is None and isinstance(raw.dtstart, datetime):
                duration = _duration(raw, raw.dtstart)
            if duration is None:
                entry.skip = ALL_DAY
            else:
                start = value
                if value.tzinfo is None and anchor is not None and anchor is not user_zone:
                    start = value.replace(tzinfo=anchor)
                _single(entry, start, duration, user_zone)
        out.append(entry)
    return out


# ---- expansion ---------------------------------------------------------------------------


def _match(key: Key | date, by_key: dict[Key, Occ], by_day: dict[date, list[Occ]]) -> Occ | None:
    if isinstance(key, datetime):
        found = by_key.get(key)
        if found is not None:
            return found
        same_day = by_day.get(key.date(), [])
        return same_day[0] if len(same_day) == 1 else None
    same_day = by_day.get(key, [])
    return same_day[0] if len(same_day) == 1 else None


def _segments(occs: list[Occ], rule: WeeklyRule, keys: list[Key]) -> list[SegmentSpec] | None:
    """Consecutive occurrences with the same local times and day shift form one app segment.
    Verified against the app's own expansion; None when it can't be reproduced exactly."""
    groups: list[list[tuple[Occ, Key]]] = []
    signature: tuple[time, time, int] | None = None
    for occ, key in zip(occs, keys, strict=True):
        sig = (occ.start, occ.end, (occ.day - key.date()).days)
        if sig != signature:
            groups.append([])
            signature = sig
        groups[-1].append((occ, key))
    specs: list[SegmentSpec] = []
    for i, group in enumerate(groups):
        first, first_key = group[0]
        shift = (first.day - first_key.date()).days
        days = tuple(
            d
            for d in WEEKDAYS
            if d in {WEEKDAYS[(WEEKDAYS.index(w) + shift) % 7] for w in rule.weekdays}
        )
        last = group[-1][0]
        final = i == len(groups) - 1
        spec = SegmentSpec(
            freq="weekly",
            start_date=first.day,
            start_time=first.start,
            end_time=first.end,
            weekdays=days,
            interval_weeks=rule.interval,
            end_kind="count" if final and rule.count is not None else "until",
            until_date=None if final and rule.count is not None else last.day,
            count=len(group) if final and rule.count is not None else None,
        )
        expected = [o.day for o, _ in group]
        horizon = last.day + timedelta(weeks=MAX_INTERVAL + 1)
        if occurrence_dates(spec.rule(), None, spec.start_date, horizon) != expected:
            return None
        specs.append(spec)
    return specs


def expand(entry: SourceEntry, user_tz: str, open_end: date | None = None) -> Expansion:
    """Occurrences (user zone) and app rule segments of a valid entry. `open_end` is the end
    chosen for an open-ended series (default: 16 weeks after its first occurrence)."""
    user_zone = ZoneInfo(user_tz)
    assert entry.start_key is not None and entry.duration is not None and entry.anchor
    assert entry.first_day and entry.first_start and entry.first_end
    notes: list[str] = []
    single = SegmentSpec(
        freq="none",
        start_date=entry.first_day,
        start_time=entry.first_start,
        end_time=entry.first_end,
    )
    first = Occ(entry.start_key, entry.first_day, entry.first_start, entry.first_end)
    if entry.rule is None:  # one-time, or unsupported (first occurrence only)
        return Expansion([single], [first], set(), {}, [], entry.unsupported, notes)

    keys = _rule_keys(entry, open_end)
    if isinstance(keys, str):
        return Expansion([single], [first], set(), {}, [], keys, notes)
    occs: list[Occ] = []
    for key in keys:
        s, e = _local(key, entry.anchor, entry.duration, user_zone)
        if e.date() != s.date() or _minute(e.time()) <= _minute(s.time()):
            reason = "some of its occurrences cross midnight in your time zone"
            return Expansion([single], [first], set(), {}, [], reason, notes)
        occs.append(Occ(key, s.date(), _minute(s.time()), _minute(e.time())))
    if not occs:
        return Expansion([single], [first], set(), {}, [], "its rule produces no dates", notes)
    specs = _segments(occs, entry.rule, keys)
    if specs is None:
        reason = "its weekly rule can't be represented exactly"
        return Expansion([single], [first], set(), {}, [], reason, notes)
    if len(specs) > 1:
        label = zone_label(entry.anchor)
        for spec in specs[1:]:
            notes.append(
                f"Times change on {spec.start_date.isoformat()} (daylight saving in {label})."
            )

    by_key = {o.key: o for o in occs}
    by_day: dict[date, list[Occ]] = {}
    for o in occs:
        by_day.setdefault(o.key.date(), []).append(o)
    cancelled: set[date] = set()
    for ex in entry.exdates:
        hit = _match(ex, by_key, by_day)
        if hit is not None:
            cancelled.add(hit.day)
    modified: dict[date, Override] = {}
    orphans: list[Override] = []
    for ov in entry.overrides:
        hit = _match(ov.key, by_key, by_day)
        if hit is None:
            if not ov.cancelled:
                orphans.append(ov)
            continue
        if ov.cancelled:
            cancelled.add(hit.day)
        elif ov.day is None:
            notes.append(
                f"The change to {hit.day.isoformat()} is all-day or invalid and was not kept."
            )
        else:
            modified[hit.day] = ov
    return Expansion(specs, occs, cancelled, modified, orphans, None, notes)


# ---- summaries ---------------------------------------------------------------------------


def patterns(occs: Sequence[Occ]) -> list[tuple[tuple[str, ...], time, time]]:
    """Distinct (weekdays, start, end) combinations, most frequent first."""
    by_times: dict[tuple[time, time], set[str]] = {}
    counts: Counter[tuple[time, time]] = Counter()
    for o in occs:
        by_times.setdefault((o.start, o.end), set()).add(WEEKDAYS[o.day.weekday()])
        counts[(o.start, o.end)] += 1
    out = []
    for (s, e), _n in counts.most_common():
        days = tuple(d for d in WEEKDAYS if d in by_times[(s, e)])
        out.append((days, s, e))
    return out
