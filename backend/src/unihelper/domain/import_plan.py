"""Preview groups, defaults, colours and plan checks for a calendar import (010 research R6, R12).

Pure. Entries are grouped by title (case and surrounding spaces ignored); entries a previous
export of this app marked with a year and semester are grouped per saved target as well, so a
course that exists in two semesters stays two groups. Group ids derive from the file, so the
apply step can refer to preview rows without storing the preview.
"""

from __future__ import annotations

import hashlib
from collections import Counter
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import date, time, timedelta
from typing import Any, Protocol

from unihelper.domain.ical_rules import (
    DEFAULT_OPEN_WEEKS,
    Expansion,
    Occ,
    SourceEntry,
    expand,
    patterns,
)
from unihelper.domain.naming import is_reserved_course_folder, name_key

NO_TITLE = "(No title)"
COLOR_KEYS = (
    "slate",
    "red",
    "orange",
    "amber",
    "lime",
    "green",
    "teal",
    "cyan",
    "blue",
    "indigo",
    "violet",
    "pink",
)
# the order new courses take palette colours in (well separated neighbours first)
COURSE_COLOR_ORDER = (
    "blue",
    "green",
    "orange",
    "violet",
    "red",
    "teal",
    "pink",
    "amber",
    "indigo",
    "cyan",
    "lime",
    "slate",
)
EVENT_COLOR = "blue"
KINDS = ("class", "event")


@dataclass(frozen=True)
class SavedTarget:
    """What a file exported by this app says about an entry (research R9)."""

    kind: str
    year_name: str
    semester_name: str
    course_name: str | None
    color: str | None
    semester_start: date | None = None
    semester_end: date | None = None


@dataclass
class PreviewGroup:
    group_id: str
    title: str
    title_missing: bool
    entries: list[SourceEntry]
    expansions: dict[str, Expansion]
    saved: SavedTarget | None
    occurrence_count: int = 0
    patterns: list[tuple[tuple[str, ...], time, time]] = field(default_factory=list)
    location: str | None = None
    repeating: bool = False
    unsupported: str | None = None
    open_ended: bool = False
    suggested_end: date | None = None
    first_date: date | None = None
    default_selected: bool = False
    default_kind: str = "event"
    default_color: str | None = None
    issues: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)


def _date(value: str | None) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


def saved_target(entry: SourceEntry) -> SavedTarget | None:
    app = entry.app
    kind = app.get("X-UNIHELPER-KIND", "").lower()
    year = app.get("X-UNIHELPER-YEAR", "")
    semester = app.get("X-UNIHELPER-SEMESTER", "")
    if kind not in KINDS or not year or not semester:
        return None
    color = app.get("X-UNIHELPER-COLOR", "").lower() or None
    return SavedTarget(
        kind=kind,
        year_name=year[:80],
        semester_name=semester[:80],
        course_name=(app.get("X-UNIHELPER-COURSE") or None) if kind == "class" else None,
        color=color if color in COLOR_KEYS else None,
        semester_start=_date(app.get("X-UNIHELPER-SEMESTER-START")),
        semester_end=_date(app.get("X-UNIHELPER-SEMESTER-END")),
    )


def _group_key(entry: SourceEntry) -> str:
    key = name_key(entry.title) if entry.title else ""
    saved = saved_target(entry)
    if saved is not None:
        key += "\x00" + "\x00".join(
            (saved.kind, name_key(saved.year_name), name_key(saved.semester_name))
        )
    return key


def group_id_of(key: str) -> str:
    return hashlib.sha1(key.encode()).hexdigest()[:12]


def suggested_end(first: date) -> date:
    return first + timedelta(weeks=DEFAULT_OPEN_WEEKS)


def _summarise(group: PreviewGroup, user_tz: str, unsupported_first_only: bool = True) -> None:
    occs: list[Occ] = []
    locations: Counter[str] = Counter()
    for entry in group.entries:
        x = group.expansions[entry.entry_id]
        scheduled = x.scheduled
        occs += scheduled
        if entry.location:
            locations[entry.location] += len(scheduled) or 1
        group.notes += [n for n in entry.notes + x.notes if n not in group.notes]
        if entry.repeating:
            group.repeating = True
        reason = x.unsupported or entry.unsupported
        if reason and group.unsupported is None:
            group.unsupported = reason
        if entry.open_ended and x.unsupported is None:
            group.open_ended = True
        for ov in x.orphans:
            if ov.day is not None:
                occs.append(Occ(entry.start_key or ov.key, ov.day, ov.start, ov.end))  # type: ignore[arg-type]
    group.occurrence_count = len(occs)
    group.patterns = patterns(occs)
    group.location = locations.most_common(1)[0][0] if locations else None
    firsts = [e.first_day for e in group.entries if e.first_day]
    group.first_date = min(firsts) if firsts else None
    if group.open_ended and group.first_date:
        group.suggested_end = suggested_end(group.first_date)


def group_entries(entries: Sequence[SourceEntry], user_tz: str) -> list[PreviewGroup]:
    """Valid (not skipped) entries grouped for the preview, in file order of first appearance."""
    groups: dict[str, PreviewGroup] = {}
    for entry in entries:
        if entry.skip:
            continue
        key = _group_key(entry)
        group = groups.get(key)
        if group is None:
            title = entry.title or NO_TITLE
            group = PreviewGroup(
                group_id=group_id_of(key),
                title=title,
                title_missing=not entry.title,
                entries=[],
                expansions={},
                saved=saved_target(entry),
            )
            groups[key] = group
        group.entries.append(entry)
        group.expansions[entry.entry_id] = expand(entry, user_tz)
    out = list(groups.values())
    for group in out:
        _summarise(group, user_tz)
        if group.saved is not None:
            group.default_selected = True
            group.default_kind = group.saved.kind
            group.default_color = group.saved.color
        elif group.repeating:
            group.default_selected, group.default_kind = True, "class"
        else:
            group.default_selected, group.default_kind = False, "event"
        if group.title_missing:
            group.issues.append("title_required")
        course = (group.saved.course_name if group.saved else None) or group.title
        if not group.title_missing and is_reserved_course_folder(course):
            group.issues.append("reserved_name")
    return out


def re_expand(group: PreviewGroup, user_tz: str, end: date | None) -> None:
    """Expand open-ended entries again with the end the user chose."""
    for entry in group.entries:
        if entry.open_ended:
            group.expansions[entry.entry_id] = expand(entry, user_tz, end)


# ---- colours and courses -----------------------------------------------------------------


def next_color(used: Iterable[str]) -> str:
    """The first course colour not used yet; when all are taken, the least used one."""
    counts = Counter(c for c in used if c in COLOR_KEYS)
    for color in COURSE_COLOR_ORDER:
        if counts[color] == 0:
            return color
    return min(COURSE_COLOR_ORDER, key=lambda c: (counts[c], COURSE_COLOR_ORDER.index(c)))


def assign_colors(existing: Iterable[str], n: int) -> list[str]:
    used = list(existing)
    out: list[str] = []
    for _ in range(n):
        color = next_color(used)
        used.append(color)
        out.append(color)
    return out


def default_course(title: str, courses_by_key: Mapping[str, Any]) -> Any | None:
    """An existing course whose name matches ignoring case and surrounding spaces."""
    return courses_by_key.get(name_key(title)) if title.strip() else None


# ---- plan checks -------------------------------------------------------------------------


class GroupPlanLike(Protocol):
    @property
    def group_id(self) -> str: ...
    @property
    def selected(self) -> bool: ...
    @property
    def import_as(self) -> str: ...
    @property
    def title(self) -> str | None: ...
    @property
    def course(self) -> Any: ...
    @property
    def end_date(self) -> date | None: ...
    @property
    def unsupported(self) -> str | None: ...


def _course_name(plan: GroupPlanLike) -> str | None:
    course = plan.course
    new = getattr(course, "new", None)
    return new if isinstance(new, str) else None


def validate_plan(
    plans: Sequence[GroupPlanLike], groups: Sequence[PreviewGroup]
) -> list[dict[str, str]]:
    """Field errors (`/groups/<groupId>/<field>`) for a plan made against `groups`."""
    by_id = {g.group_id: g for g in groups}
    errors: list[dict[str, str]] = []

    def err(gid: str, fld: str, code: str, message: str) -> None:
        errors.append(
            {
                "field": f"/groups/{gid}/{fld}" if fld else f"/groups/{gid}",
                "code": code,
                "message": message,
            }
        )

    selected = [p for p in plans if p.selected]
    if not selected:
        return [
            {
                "field": "/groups",
                "code": "nothing_selected",
                "message": "Select at least one group to import.",
            }
        ]
    for plan in selected:
        group = by_id.get(plan.group_id)
        if group is None:
            err(plan.group_id, "", "unknown_group", "This group isn't in the file any more.")
            continue
        if group.unsupported and plan.unsupported not in ("first_only", "skip"):
            err(
                plan.group_id,
                "unsupported",
                "choice_required",
                "Choose what to do with this repetition.",
            )
        if plan.end_date is not None and group.first_date and plan.end_date < group.first_date:
            err(
                plan.group_id,
                "endDate",
                "invalid_end_date",
                "The end date is before the first entry.",
            )
        name = _course_name(plan)
        if plan.import_as == "event":
            if group.title_missing and not (plan.title or "").strip():
                err(plan.group_id, "title", "title_required", "Enter a title.")
        else:
            has_course = plan.course is not None and (
                getattr(plan.course, "existing", None) or (name or "").strip()
            )
            if group.title_missing and not has_course:
                err(plan.group_id, "course", "title_required", "Choose or name a course.")
            course_name = (
                name
                if name is not None
                else (
                    plan.course is None
                    and not group.title_missing
                    and ((group.saved.course_name if group.saved else None) or group.title)
                )
            )
            if isinstance(course_name, str) and is_reserved_course_folder(course_name):
                err(plan.group_id, "course", "reserved_name", "This name is reserved for events.")
    return errors
