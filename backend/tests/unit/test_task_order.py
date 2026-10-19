"""Task order invariants (012 T055): after any move, soft delete or restore every column's live
tasks are numbered 0..n-1 without duplicates; purge_expired removes only rows deleted > 24 h ago."""

from __future__ import annotations

import random
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from sqlalchemy import Engine, create_engine, event, select
from sqlalchemy.orm import Session

from unihelper.models import Base, Task, TaskChecklistItem, TaskQuickNote, User
from unihelper.schemas.tasks import TaskCreate
from unihelper.services import task_column_service as tcs
from unihelper.services import task_service as ts

pytestmark = pytest.mark.unit


def _engine() -> Engine:
    engine = create_engine("sqlite://")

    @event.listens_for(engine, "connect")
    def _fk(dbapi_conn: Any, _record: Any) -> None:
        dbapi_conn.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)
    return engine


@pytest.fixture
def db() -> Iterator[Session]:
    engine = _engine()
    with Session(engine, autoflush=False, expire_on_commit=False) as session:
        yield session
    engine.dispose()


@pytest.fixture
def user(db: Session) -> User:
    u = User(username="owner", password_hash="x", role="owner", timezone="UTC")
    db.add(u)
    db.flush()
    return u


def _positions_ok(db: Session, user: User) -> None:
    for col in tcs.ensure_columns(db, user):
        positions = [t.position for t in tcs.live_tasks_of(db, user, col.id)]
        assert positions == list(range(len(positions))), (col.name, positions)


def test_random_moves_deletes_and_restores_keep_positions_dense(db: Session, user: User) -> None:
    rng = random.Random(12)
    cols = tcs.ensure_columns(db, user)
    ids = [ts.create_task(db, user, TaskCreate(title=f"T{i}"))["id"] for i in range(12)]
    deleted: list[str] = []
    for _ in range(200):
        action = rng.random()
        live = [i for i in ids if i not in deleted]
        if action < 0.7 and live:
            task = ts.get_task(db, user, rng.choice(live))
            ts.move_task(db, user, task, rng.choice(cols).id, rng.randint(0, 15))
        elif action < 0.85 and live:
            tid = rng.choice(live)
            ts.soft_delete_task(db, user, ts.get_task(db, user, tid))
            deleted.append(tid)
        elif deleted:
            tid = deleted.pop(rng.randrange(len(deleted)))
            ts.restore_task(db, user, tid)
        _positions_ok(db, user)
    assert len(ts.list_tasks(db, user)) == len(ids) - len(deleted)


def test_restore_goes_back_to_its_old_position(db: Session, user: User) -> None:
    for name in "ABCD":
        ts.create_task(db, user, TaskCreate(title=name))
    c = ts.get_task(db, user, ts.list_tasks(db, user)[2]["id"])
    ts.soft_delete_task(db, user, c)
    assert [t["title"] for t in ts.list_tasks(db, user)] == ["A", "B", "D"]
    ts.restore_task(db, user, c.id)
    assert [(t["title"], t["position"]) for t in ts.list_tasks(db, user)] == [
        ("A", 0),
        ("B", 1),
        ("C", 2),
        ("D", 3),
    ]


def test_move_index_is_clamped(db: Session, user: User) -> None:
    cols = tcs.ensure_columns(db, user)
    a = ts.create_task(db, user, TaskCreate(title="A"))
    ts.create_task(db, user, TaskCreate(title="B", column_id=cols[1].id))
    out = ts.move_task(db, user, ts.get_task(db, user, a["id"]), cols[1].id, 99)
    assert out["position"] == 1
    _positions_ok(db, user)


def _ago(hours: float) -> str:
    return (datetime.now(UTC) - timedelta(hours=hours)).isoformat(timespec="seconds")


def test_purge_expired_age_rule(db: Session, user: User) -> None:
    ids = [ts.create_task(db, user, TaskCreate(title=n))["id"] for n in ("old", "recent", "live")]
    old, recent, live = (db.get(Task, i) for i in ids)
    assert old is not None and recent is not None and live is not None
    db.add(TaskChecklistItem(user_id=user.id, task_id=old.id, text="step", position=0))
    db.add(TaskQuickNote(user_id=user.id, task_id=old.id, title="on old"))
    db.add(TaskQuickNote(user_id=user.id, task_id=live.id, title="gone", deleted_at=_ago(25)))
    db.add(TaskQuickNote(user_id=user.id, task_id=live.id, title="undo", deleted_at=_ago(23)))
    db.add(TaskQuickNote(user_id=user.id, task_id=live.id, title="kept"))
    old.deleted_at = _ago(24.5)
    recent.deleted_at = _ago(23.5)
    db.commit()

    ts.purge_expired(db)

    assert {t.title for t in db.scalars(select(Task))} == {"recent", "live"}
    assert {n.title for n in db.scalars(select(TaskQuickNote))} == {"undo", "kept"}
    assert db.scalars(select(TaskChecklistItem)).all() == []
