"""Apply a scope planner's ChangeSet to the series rows of one lineage (one transaction).

Shared by classes and (009) events: a `SeriesRepo` names the series and link models and the
owner columns a split segment copies from its source (`course_id` / `semester_id`).
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date
from typing import Any

from sqlalchemy.orm import Session

from unihelper.domain.scopes import ChangeSet
from unihelper.models import SessionException, User
from unihelper.models.base import new_id


@dataclass(frozen=True)
class SeriesRepo:
    series: type[Any]  # ClassSeries | EventSeries
    link: type[Any]  # ClassLink | EventLink
    owner_fields: tuple[str, ...]

    def links(self, pairs: Sequence[tuple[str | None, str]]) -> list[Any]:
        return [self.link(label=lbl, url=url, position=i) for i, (lbl, url) in enumerate(pairs)]


def apply_changeset(
    db: Session,
    cs: ChangeSet,
    repo: SeriesRepo,
    *,
    user: User,
    lineage_id: str,
    rows: Sequence[Any],
    exc_rows: dict[date, SessionException],
) -> list[str]:
    """Updates, split inserts, deletes, then exception upserts/deletes. Returns the ids of the
    affected series rows (updated, inserted, deleted)."""
    by_id = {r.id: r for r in rows}
    affected: list[str] = []
    for sid, values in cs.updates.items():
        row = by_id[sid]
        for k, v in values.items():
            if k == "links":
                row.links = repo.links(v)
            else:
                setattr(row, k, v)
        affected.append(sid)
    for ins in cs.inserts:
        src = by_id[ins.split_from_id]
        values = dict(ins.values)
        links = values.pop("links")
        new = repo.series(
            id=new_id(),
            user_id=user.id,
            lineage_id=lineage_id,
            split_from_id=src.id,
            **{f: getattr(src, f) for f in repo.owner_fields},
            **values,
        )
        new.links = repo.links(links)
        db.add(new)
        affected.append(new.id)
    for sid in cs.deletes:
        db.delete(by_id[sid])
        affected.append(sid)
    for day, values in cs.exception_upserts.items():
        exc_row = exc_rows.get(day)
        if exc_row is None:
            db.add(
                SessionException(
                    user_id=user.id, lineage_id=lineage_id, original_date=day, **values
                )
            )
        else:
            for k, v in values.items():
                setattr(exc_row, k, v)
    for day in cs.exception_deletes:
        if day in exc_rows:
            db.delete(exc_rows[day])
    db.flush()
    return affected
