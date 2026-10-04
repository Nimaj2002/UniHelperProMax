"""Declarative base and shared column mixins (data-model.md conventions)."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import uuid_utils
from sqlalchemy import Integer, MetaData, String, event
from sqlalchemy.orm import DeclarativeBase, Mapped, Mapper, mapped_column

from unihelper.domain.naming import name_key as _name_key

NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


def new_id() -> str:
    return str(uuid_utils.uuid7())


def now_iso() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


def name_key(name: str) -> str:
    return _name_key(name)


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)


class IdMixin:
    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)


class TimestampMixin:
    created_at: Mapped[str] = mapped_column(String, nullable=False, default=now_iso)
    updated_at: Mapped[str] = mapped_column(
        String, nullable=False, default=now_iso, onupdate=now_iso
    )


class VersionMixin:
    """Integer version starting at 1, incremented on every update (optimistic concurrency)."""

    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)


@event.listens_for(VersionMixin, "before_update", propagate=True)
def _bump_version(_mapper: Mapper[Any], _conn: Any, target: VersionMixin) -> None:
    target.version = (target.version or 0) + 1
