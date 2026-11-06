"""Housekeeping of chats (014 research R12, R16): deleted chats once Undo is no longer
possible, staged uploads nobody refers to, and old run rows."""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, select
from sqlalchemy.orm import Session, sessionmaker

from unihelper.chat import files
from unihelper.chat.runs import chat_location
from unihelper.models import Chat, ChatRun
from unihelper.storage.storage_service import StorageService

log = logging.getLogger("unihelper.chat")

DELETED_AFTER = timedelta(minutes=10)
RUNS_AFTER = timedelta(days=7)


def _iso(delta: timedelta) -> str:
    return (datetime.now(UTC) - delta).isoformat(timespec="seconds")


def purge_deleted(db: Session, storage: StorageService) -> int:
    rows = list(
        db.scalars(
            select(Chat).where(Chat.deleted_at.is_not(None), Chat.deleted_at < _iso(DELETED_AFTER))
        )
    )
    for chat in rows:
        try:
            _user, folder = chat_location(db, chat)
            storage.delete_chat_files(files.chats_dir(folder), chat.stem)
        except Exception as exc:  # keep the row; try again next time
            log.warning("could not remove a deleted chat's files (%s)", type(exc).__name__)
            continue
        db.delete(chat)
    if rows:  # 022: their graph sources cascaded; ideas they alone taught go too (R10)
        from unihelper.services.knowledge_graph_service import prune

        db.flush()
        prune(db)
    db.execute(
        delete(ChatRun).where(ChatRun.ended_at.is_not(None), ChatRun.ended_at < _iso(RUNS_AFTER))
    )
    db.commit()
    return len(rows)


def run(maker: sessionmaker[Session], storage: StorageService) -> None:
    from unihelper.services.chat_upload_service import sweep_stale

    with maker() as db:
        purge_deleted(db, storage)
    with maker() as db:
        sweep_stale(db, storage)
