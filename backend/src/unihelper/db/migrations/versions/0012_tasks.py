"""tasks: board columns, tasks, checklist items and quick notes (012)

Revision ID: 0012
Revises: 0011
Create Date: 2026-10-15 12:00:00

- `task_columns`: the user's board columns (1–12), ordered by `position`, unique by
  case-insensitive name (`name_key`). `counts_as_done` marks columns whose tasks are done.
- `tasks`: one task in a column at `position` (0..n-1 among live tasks). `event_key` links it to
  an event occurrence (`{lineage_id}:{original_date}`); at most one live task per occurrence
  (partial unique index). `deleted_at` is the 24 h soft delete for Undo; `trash_entry_id` is set
  while it sits in the Trash together with its event (012 research R5).
- `task_checklist_items`: ordered checklist of a task.
- `task_quick_notes`: short plain-text notes of a task (soft delete for Undo).

No existing table changes.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0012"
down_revision: str | None = "0011"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "task_columns",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("name", sa.String(40), nullable=False),
        sa.Column("name_key", sa.String(40), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("counts_as_done", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.String(), nullable=False),
        sa.Column("updated_at", sa.String(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_task_columns_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_task_columns")),
        sa.UniqueConstraint("user_id", "name_key", name="uq_task_columns_user_name"),
        sa.UniqueConstraint("user_id", "position", name="uq_task_columns_user_position"),
    )

    op.create_table(
        "tasks",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("column_id", sa.String(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("due_date", sa.Date(), nullable=True),
        sa.Column("due_time", sa.Time(), nullable=True),
        sa.Column("course_id", sa.String(), nullable=True),
        sa.Column("event_key", sa.String(), nullable=True),
        sa.Column("completed_at", sa.String(), nullable=True),
        sa.Column("previous_column_id", sa.String(), nullable=True),
        sa.Column("deleted_at", sa.String(), nullable=True),
        sa.Column("trash_entry_id", sa.String(), nullable=True),
        sa.Column("created_at", sa.String(), nullable=False),
        sa.Column("updated_at", sa.String(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_tasks_user_id_users"), ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["column_id"], ["task_columns.id"], name=op.f("fk_tasks_column_id_task_columns")
        ),
        sa.ForeignKeyConstraint(
            ["course_id"],
            ["courses.id"],
            name=op.f("fk_tasks_course_id_courses"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["trash_entry_id"],
            ["trash_entries.id"],
            name=op.f("fk_tasks_trash_entry_id_trash_entries"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_tasks")),
    )
    op.create_index("ix_tasks_user_column_position", "tasks", ["user_id", "column_id", "position"])
    op.create_index("ix_tasks_course", "tasks", ["user_id", "course_id"])
    op.create_index("ix_tasks_trash", "tasks", ["trash_entry_id"])
    op.create_index(
        "uq_tasks_event_key",
        "tasks",
        ["user_id", "event_key"],
        unique=True,
        sqlite_where=sa.text(
            "event_key IS NOT NULL AND deleted_at IS NULL AND trash_entry_id IS NULL"
        ),
    )

    op.create_table(
        "task_checklist_items",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("task_id", sa.String(), nullable=False),
        sa.Column("text", sa.String(500), nullable=False),
        sa.Column("done", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.String(), nullable=False),
        sa.Column("updated_at", sa.String(), nullable=False),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_task_checklist_items_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["task_id"],
            ["tasks.id"],
            name=op.f("fk_task_checklist_items_task_id_tasks"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_task_checklist_items")),
    )
    op.create_index(op.f("ix_task_checklist_items_task_id"), "task_checklist_items", ["task_id"])

    op.create_table(
        "task_quick_notes",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("task_id", sa.String(), nullable=False),
        sa.Column("title", sa.String(200), nullable=False, server_default=""),
        sa.Column("body", sa.Text(), nullable=False, server_default=""),
        sa.Column("deleted_at", sa.String(), nullable=True),
        sa.Column("created_at", sa.String(), nullable=False),
        sa.Column("updated_at", sa.String(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_task_quick_notes_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["task_id"],
            ["tasks.id"],
            name=op.f("fk_task_quick_notes_task_id_tasks"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_task_quick_notes")),
    )
    op.create_index(op.f("ix_task_quick_notes_task_id"), "task_quick_notes", ["task_id"])


def downgrade() -> None:
    op.drop_index(op.f("ix_task_quick_notes_task_id"), table_name="task_quick_notes")
    op.drop_table("task_quick_notes")
    op.drop_index(op.f("ix_task_checklist_items_task_id"), table_name="task_checklist_items")
    op.drop_table("task_checklist_items")
    op.drop_index("uq_tasks_event_key", table_name="tasks")
    op.drop_index("ix_tasks_trash", table_name="tasks")
    op.drop_index("ix_tasks_course", table_name="tasks")
    op.drop_index("ix_tasks_user_column_position", table_name="tasks")
    op.drop_table("tasks")
    op.drop_table("task_columns")
