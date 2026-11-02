"""time tracking: tags, time entries and the running timer (020)

Revision ID: 0017
Revises: 0016
Create Date: 2026-11-02 12:00:00

Three new tables, nothing existing changes. `time_timers` has the user as its primary key, so
the database itself keeps at most one running timer per user (020 research R1).
"""

from collections.abc import Sequence
from typing import Any

import sqlalchemy as sa
from alembic import op

revision: str = "0017"
down_revision: str | None = "0016"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _fk(table: str, col: str, target: str, ondelete: str) -> sa.ForeignKeyConstraint:
    return sa.ForeignKeyConstraint(
        [col], [f"{target}.id"], name=op.f(f"fk_{table}_{col}_{target}"), ondelete=ondelete
    )


def _linked(table: str) -> list[Any]:
    """Columns and FKs shared by entries and the timer (description, tag, P2 links)."""
    return [
        sa.Column("description", sa.String(500), nullable=False),
        sa.Column("tag_id", sa.String(), nullable=True),
        sa.Column("course_id", sa.String(), nullable=True),
        sa.Column("task_id", sa.String(), nullable=True),
        sa.Column("session_key", sa.String(), nullable=True),
        sa.Column("link_title", sa.String(200), nullable=True),
        _fk(table, "user_id", "users", "CASCADE"),
        _fk(table, "tag_id", "time_tags", "SET NULL"),
        _fk(table, "course_id", "courses", "SET NULL"),
        _fk(table, "task_id", "tasks", "SET NULL"),
    ]


def upgrade() -> None:
    op.create_table(
        "time_tags",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("name", sa.String(30), nullable=False),
        sa.Column("name_key", sa.String(30), nullable=False),
        sa.Column("color", sa.String(), nullable=False),
        sa.Column("created_at", sa.String(), nullable=False),
        sa.Column("updated_at", sa.String(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        _fk("time_tags", "user_id", "users", "CASCADE"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_time_tags")),
        sa.UniqueConstraint("user_id", "name_key", name=op.f("uq_time_tags_user_id")),
    )
    op.create_table(
        "time_entries",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("started_at", sa.String(), nullable=False),
        sa.Column("ended_at", sa.String(), nullable=False),
        sa.Column("paused_seconds", sa.Integer(), nullable=False),
        sa.Column("source", sa.String(), nullable=False),
        sa.Column("deleted_at", sa.String(), nullable=True),
        sa.Column("created_at", sa.String(), nullable=False),
        sa.Column("updated_at", sa.String(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        *_linked("time_entries"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_time_entries")),
    )
    op.create_index("ix_time_entries_user_start", "time_entries", ["user_id", "started_at"])
    op.create_index("ix_time_entries_user_end", "time_entries", ["user_id", "ended_at"])
    op.create_index("ix_time_entries_user_session", "time_entries", ["user_id", "session_key"])
    op.create_table(
        "time_timers",
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("style", sa.String(), nullable=False),
        sa.Column("state", sa.String(), nullable=False),
        sa.Column("started_at", sa.String(), nullable=False),
        sa.Column("paused_at", sa.String(), nullable=True),
        sa.Column("paused_ms", sa.Integer(), nullable=False),
        sa.Column("planned_end_at", sa.String(), nullable=True),
        sa.Column("finished_at", sa.String(), nullable=True),
        sa.Column("phase", sa.String(), nullable=True),
        sa.Column("period", sa.Integer(), nullable=True),
        sa.Column("focus_minutes", sa.Integer(), nullable=True),
        sa.Column("goal", sa.String(200), nullable=True),
        sa.Column("hide_panels", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("reminder_ack", sa.Integer(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        *_linked("time_timers"),
        sa.PrimaryKeyConstraint("user_id", name=op.f("pk_time_timers")),
    )


def downgrade() -> None:
    op.drop_table("time_timers")
    op.drop_index("ix_time_entries_user_session", table_name="time_entries")
    op.drop_index("ix_time_entries_user_end", table_name="time_entries")
    op.drop_index("ix_time_entries_user_start", table_name="time_entries")
    op.drop_table("time_entries")
    op.drop_table("time_tags")
