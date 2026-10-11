"""Before-images kept by a Trash entry (009 research R6), schema `TrashPayloadV1`.

Pure: the service turns rows into `SegmentImage` / `ExceptionImage` values, the scope planner's
`ChangeSet` says what the deletion changes, and `build` keeps exactly what a restore needs:

- every segment of the lineage as it was (an exact restore rewrites them; a restore after later
  edits uses them as the source of the dates that must come back),
- the exceptions the deletion removed or overwrote,
- the dates of the cancel exceptions it created (a restore removes them),
- the removed occurrences (original date + the segment that generated them),
- the hierarchy the lineage hung off (ids and names, to reuse or recreate it).
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field, replace
from datetime import date, time
from typing import Any

from unihelper.domain.scopes import ChangeSet

VERSION = 1


@dataclass(frozen=True)
class SegmentImage:
    id: str
    split_from_id: str | None
    title: str | None
    location: str | None
    color: str
    start_date: date
    start_time: time
    end_time: time
    freq: str
    interval_weeks: int
    by_weekday: str
    end_kind: str
    until_date: date | None
    count: int | None
    version: int
    links: tuple[tuple[str | None, str], ...] = ()

    def columns(self) -> dict[str, Any]:
        """Column values (without id, version and links) for an insert or an overwrite."""
        out = asdict(self)
        for k in ("id", "version", "links"):
            out.pop(k)
        return out


@dataclass(frozen=True)
class ExceptionImage:
    original_date: date
    kind: str
    start_time: time | None = None
    end_time: time | None = None
    location: str | None = None
    title: str | None = None
    color: str | None = None
    links_json: str | None = None
    moved_date: date | None = None
    detached: bool = False
    version: int = 1

    def columns(self) -> dict[str, Any]:
        out = asdict(self)
        out.pop("original_date")
        out.pop("version")
        return out


@dataclass(frozen=True)
class Removed:
    """One occurrence the deletion took off the calendar (or, for a hierarchy delete, an
    unscheduled folder with content: `segment_id` None)."""

    original_date: date
    segment_id: str | None


@dataclass(frozen=True)
class Owner:
    """Where the lineage lived: ids to reuse when they still exist, names (and the semester's
    dates, the course's colour) to recreate them otherwise (FR-022b)."""

    year_id: str
    year_name: str
    semester_id: str
    semester_name: str
    semester_start: date | None = None
    semester_end: date | None = None
    course_id: str | None = None
    course_name: str | None = None
    course_color: str | None = None


@dataclass(frozen=True)
class BeforeState:
    segments: tuple[SegmentImage, ...]
    exceptions: dict[date, ExceptionImage]


@dataclass(frozen=True)
class TrashPayloadV1:
    kind: str  # "class" | "event"
    lineage_id: str
    owner: Owner
    segments: tuple[SegmentImage, ...]
    exceptions_before: tuple[ExceptionImage, ...]
    created_cancels: tuple[date, ...]
    removed: tuple[Removed, ...] = ()
    # segment id → version right after the deletion: unchanged since ⇒ an exact restore
    after_versions: dict[str, int] = field(default_factory=dict)
    start_time: time | None = None  # set when every removed occurrence has the same times
    end_time: time | None = None

    def with_result(
        self,
        removed: list[Removed],
        after_versions: dict[str, int],
        times: tuple[time | None, time | None] = (None, None),
    ) -> TrashPayloadV1:
        return replace(
            self,
            removed=tuple(sorted(removed, key=lambda r: r.original_date)),
            after_versions=dict(after_versions),
            start_time=times[0],
            end_time=times[1],
        )

    # ---- JSON ---------------------------------------------------------------------------

    def to_json(self) -> str:
        return json.dumps({"v": VERSION, **_encode(asdict(self))}, sort_keys=True)

    @staticmethod
    def from_json(raw: str) -> TrashPayloadV1:
        data = json.loads(raw)
        if data.pop("v", None) != VERSION:
            raise ValueError("Unknown trash payload version")
        return TrashPayloadV1(
            kind=data["kind"],
            lineage_id=data["lineage_id"],
            owner=Owner(**_decode_fields(data["owner"], Owner)),
            segments=tuple(_segment(s) for s in data["segments"]),
            exceptions_before=tuple(
                ExceptionImage(**_decode_fields(e, ExceptionImage))
                for e in data["exceptions_before"]
            ),
            created_cancels=tuple(date.fromisoformat(d) for d in data["created_cancels"]),
            removed=tuple(
                Removed(date.fromisoformat(r["original_date"]), r["segment_id"])
                for r in data["removed"]
            ),
            after_versions={k: int(v) for k, v in data["after_versions"].items()},
            start_time=_time(data["start_time"]),
            end_time=_time(data["end_time"]),
        )


def build(
    kind: str, lineage_id: str, owner: Owner, changeset: ChangeSet, before: BeforeState
) -> TrashPayloadV1:
    """What a restore needs to undo `changeset` applied to `before`."""
    touched = set(changeset.exception_deletes) | {
        d for d in changeset.exception_upserts if d in before.exceptions
    }
    created = sorted(
        d for d, v in changeset.exception_upserts.items() if v.get("kind") == "cancelled"
    )
    return TrashPayloadV1(
        kind=kind,
        lineage_id=lineage_id,
        owner=owner,
        segments=tuple(sorted(before.segments, key=lambda s: s.start_date)),
        exceptions_before=tuple(before.exceptions[d] for d in sorted(touched)),
        created_cancels=tuple(created),
    )


# ---- encoding helpers ---------------------------------------------------------------------


def _encode(value: Any) -> Any:
    if isinstance(value, dict):
        return {k: _encode(v) for k, v in value.items()}
    if isinstance(value, list | tuple):
        return [_encode(v) for v in value]
    if isinstance(value, date | time):
        return value.isoformat()
    return value


def _time(raw: str | None) -> time | None:
    return None if raw is None else time.fromisoformat(raw)


_DATE_FIELDS = {
    "start_date",
    "until_date",
    "moved_date",
    "original_date",
    "semester_start",
    "semester_end",
}
_TIME_FIELDS = {"start_time", "end_time"}


def _decode_fields(data: dict[str, Any], _cls: type) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for k, v in data.items():
        if v is not None and k in _DATE_FIELDS:
            out[k] = date.fromisoformat(v)
        elif v is not None and k in _TIME_FIELDS:
            out[k] = time.fromisoformat(v)
        else:
            out[k] = v
    return out


def _segment(data: dict[str, Any]) -> SegmentImage:
    fields = _decode_fields(data, SegmentImage)
    fields["links"] = tuple((lbl, url) for lbl, url in fields.get("links", []))
    return SegmentImage(**fields)
