"""SQLite engine and session handling (research R2)."""

from __future__ import annotations

from collections.abc import Callable, Iterator
from typing import Any

from fastapi import Request
from sqlalchemy import Engine, create_engine, event
from sqlalchemy.orm import Session, sessionmaker

from unihelper.config import Settings


def make_engine(settings: Settings) -> Engine:
    engine = create_engine(
        settings.db_url,
        connect_args={"check_same_thread": False, "timeout": 5},
    )

    @event.listens_for(engine, "connect")
    def _sqlite_pragmas(dbapi_conn: Any, _record: Any) -> None:
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA journal_mode=WAL")
        cur.execute("PRAGMA foreign_keys=ON")
        cur.execute("PRAGMA busy_timeout=5000")
        cur.close()

    return engine


def make_sessionmaker(engine: Engine) -> sessionmaker[Session]:
    return sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def on_rollback(db: Session, compensate: Callable[[], None]) -> None:
    """Register a file-system compensation to run if this transaction does not commit
    (keeps folders in sync with metadata — FR-025, research R7)."""
    db.info.setdefault("compensations", []).append(compensate)


def on_commit(db: Session, fn: Callable[[], None]) -> None:
    """Run `fn` once this request's transaction has committed (e.g. wake the transcription
    worker only when the job row is visible to other connections)."""
    db.info.setdefault("after_commit", []).append(fn)


def _run_after_commit(db: Session) -> None:
    for fn in db.info.pop("after_commit", []):
        try:
            fn()
        except Exception:  # pragma: no cover - notifications are best effort
            pass


def _run_compensations(db: Session) -> None:
    for fn in reversed(db.info.pop("compensations", [])):
        try:
            fn()
        except Exception:  # pragma: no cover - best effort, never mask the original error
            pass


def get_db(request: Request) -> Iterator[Session]:
    """FastAPI dependency: one session per request; commit on success, rollback (plus any
    registered file-system compensations) on error."""
    factory: sessionmaker[Session] = request.app.state.sessionmaker
    db = factory()
    try:
        yield db
        db.commit()
        db.info.pop("compensations", None)
        _run_after_commit(db)
    except Exception:
        db.rollback()
        db.info.pop("after_commit", None)
        _run_compensations(db)
        raise
    finally:
        db.close()
