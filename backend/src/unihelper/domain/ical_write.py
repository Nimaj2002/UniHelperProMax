"""Writing classes and events as one iCalendar file (010 research R5, R9, R10).

Pure. Each rule segment becomes one `VEVENT` (repeating ones with `RRULE` + `UNTIL`/`COUNT`),
cancelled occurrences are `EXDATE`s, single-occurrence changes are `RECURRENCE-ID` overrides,
and frozen occurrences no segment produces any more are standalone `VEVENT`s. Times carry the
user's zone (`TZID` + a generated `VTIMEZONE`), so every occurrence keeps its wall-clock time
across daylight-saving changes. `X-UNIHELPER-*` properties let this app restore what other
calendar apps don't know (kind, year, semester, course, colour, lineage).
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from icalendar import Calendar, Event, Timezone

PRODID = "-//UniHelperProMax//Calendar Export 1.0//EN"
UID_DOMAIN = "unihelperpromax"

Link = tuple[str | None, str]


@dataclass(frozen=True)
class ExportOccurrence:
    """A changed occurrence: an override of its segment, or standalone when `standalone`."""

    original: date
    day: date
    start: time
    end: time
    title: str
    location: str | None
    links: Sequence[Link]


@dataclass
class ExportSegment:
    id: str
    title: str
    freq: str  # "none" | "weekly"
    start_date: date
    start_time: time
    end_time: time
    interval_weeks: int = 1
    weekdays: tuple[str, ...] = ()
    until_date: date | None = None
    count: int | None = None
    location: str | None = None
    links: Sequence[Link] = ()
    color: str = "blue"
    exdates: list[date] = field(default_factory=list)
    overrides: list[ExportOccurrence] = field(default_factory=list)


@dataclass
class ExportLineage:
    kind: str  # "class" | "event"
    lineage_id: str
    year_name: str
    semester_name: str
    semester_start: date | None
    semester_end: date | None
    course_name: str | None
    segments: list[ExportSegment]
    standalone: list[ExportOccurrence] = field(default_factory=list)


def _app_props(event: Event, lin: ExportLineage, color: str) -> None:
    event.add("X-UNIHELPER-KIND", lin.kind)
    event.add("X-UNIHELPER-YEAR", lin.year_name)
    event.add("X-UNIHELPER-SEMESTER", lin.semester_name)
    if lin.semester_start:
        event.add("X-UNIHELPER-SEMESTER-START", lin.semester_start.isoformat())
    if lin.semester_end:
        event.add("X-UNIHELPER-SEMESTER-END", lin.semester_end.isoformat())
    if lin.course_name:
        event.add("X-UNIHELPER-COURSE", lin.course_name)
    event.add("X-UNIHELPER-COLOR", color)
    event.add("X-UNIHELPER-LINEAGE", lin.lineage_id)


def _description(links: Sequence[Link]) -> str | None:
    if not links:
        return None
    return "\n".join(f"{label}: {url}" if label else url for label, url in links)


def _content(event: Event, title: str, location: str | None, links: Sequence[Link]) -> None:
    event.add("SUMMARY", title)
    if location:
        event.add("LOCATION", location)
    if links:
        event.add("URL", links[0][1])
        desc = _description(links)
        if desc:
            event.add("DESCRIPTION", desc)


class _Clock:
    def __init__(self, tz: str) -> None:
        self.utc = tz in ("UTC", "Etc/UTC")
        self.zone = ZoneInfo(tz)

    def at(self, day: date, t: time) -> datetime:
        value = datetime.combine(day, t, tzinfo=self.zone)
        return value.astimezone(UTC) if self.utc else value

    def until(self, day: date) -> datetime:
        """RFC 5545: with a zoned DTSTART, UNTIL is in UTC (end of the local day, inclusive)."""
        return datetime.combine(day, time(23, 59, 59), tzinfo=self.zone).astimezone(UTC)


def _segment_event(seg: ExportSegment, lin: ExportLineage, clock: _Clock, stamp: datetime) -> Event:
    event = Event()
    event.add("UID", f"{seg.id}@{UID_DOMAIN}")
    event.add("DTSTAMP", stamp)
    event.add("DTSTART", clock.at(seg.start_date, seg.start_time))
    event.add("DTEND", clock.at(seg.start_date, seg.end_time))
    if seg.freq == "weekly":
        rule: dict[str, object] = {"FREQ": "WEEKLY", "BYDAY": list(seg.weekdays), "WKST": "MO"}
        if seg.interval_weeks > 1:
            rule["INTERVAL"] = seg.interval_weeks
        if seg.count is not None:
            rule["COUNT"] = seg.count
        elif seg.until_date is not None:
            rule["UNTIL"] = clock.until(seg.until_date)
        event.add("RRULE", rule)
        if seg.exdates:
            event.add("EXDATE", [clock.at(d, seg.start_time) for d in sorted(seg.exdates)])
    _content(event, seg.title, seg.location, seg.links)
    _app_props(event, lin, seg.color)
    return event


def _override_event(
    occ: ExportOccurrence, seg: ExportSegment, lin: ExportLineage, clock: _Clock, stamp: datetime
) -> Event:
    event = Event()
    event.add("UID", f"{seg.id}@{UID_DOMAIN}")
    event.add("DTSTAMP", stamp)
    event.add("RECURRENCE-ID", clock.at(occ.original, seg.start_time))
    event.add("DTSTART", clock.at(occ.day, occ.start))
    event.add("DTEND", clock.at(occ.day, occ.end))
    _content(event, occ.title, occ.location, occ.links)
    _app_props(event, lin, seg.color)
    return event


def _standalone_event(
    occ: ExportOccurrence, lin: ExportLineage, color: str, clock: _Clock, stamp: datetime
) -> Event:
    event = Event()
    event.add("UID", f"{lin.lineage_id}-{occ.original.isoformat()}@{UID_DOMAIN}")
    event.add("DTSTAMP", stamp)
    event.add("DTSTART", clock.at(occ.day, occ.start))
    event.add("DTEND", clock.at(occ.day, occ.end))
    _content(event, occ.title, occ.location, occ.links)
    _app_props(event, lin, color)
    event.add("X-UNIHELPER-ORIGINAL-DATE", occ.original.isoformat())
    return event


def _span(lineages: Sequence[ExportLineage]) -> tuple[date, date]:
    days: list[date] = []
    for lin in lineages:
        for seg in lin.segments:
            days += [seg.start_date, seg.until_date or seg.start_date]
            days += [o.day for o in seg.overrides]
            if seg.count:
                days.append(seg.start_date + timedelta(weeks=seg.count * seg.interval_weeks))
        days += [o.day for o in lin.standalone]
    return min(days), max(days)


def write_calendar(
    lineages: Sequence[ExportLineage], user_tz: str, now: datetime | None = None
) -> bytes:
    stamp = (now or datetime.now(UTC)).astimezone(UTC).replace(microsecond=0)
    clock = _Clock(user_tz)
    cal = Calendar()
    cal.add("PRODID", PRODID)
    cal.add("VERSION", "2.0")
    cal.add("CALSCALE", "GREGORIAN")
    cal.add("METHOD", "PUBLISH")
    cal.add("X-WR-CALNAME", "UniHelperProMax")
    cal.add("X-WR-TIMEZONE", user_tz)
    if lineages and not clock.utc:
        first, last = _span(lineages)
        cal.add_component(
            Timezone.from_tzid(
                user_tz,
                first_date=date(first.year - 1, 1, 1),
                last_date=date(last.year + 2, 1, 1),
            )
        )
    for lin in lineages:
        for seg in lin.segments:
            cal.add_component(_segment_event(seg, lin, clock, stamp))
            for occ in sorted(seg.overrides, key=lambda o: o.original):
                cal.add_component(_override_event(occ, seg, lin, clock, stamp))
        color = lin.segments[-1].color if lin.segments else "blue"
        for occ in sorted(lin.standalone, key=lambda o: o.original):
            cal.add_component(_standalone_event(occ, lin, color, clock, stamp))
    return bytes(cal.to_ical())
