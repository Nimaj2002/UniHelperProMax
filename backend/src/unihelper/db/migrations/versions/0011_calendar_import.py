"""calendar_import: staged .ics uploads, import runs and import sources (010)

Revision ID: 0011
Revises: 0010
Create Date: 2026-10-12 12:00:00

- `calendar_import_uploads`: a staged `.ics` file between the preview and the apply step
  (010 research R2). The bytes live in `files/.uploads/<token>.part`; the row binds them to the
  user and expires after an hour.
- `calendar_import_runs`: one confirmed import, with what it created and updated, for the result
  screen and "Undo import" (R13).
- `calendar_import_sources`: the file `UID` each imported lineage came from, so importing the
  same file again updates instead of duplicating (R11). No FK to a lineage: lineages are groups
  of series rows.

No existing table changes: imported entries are ordinary classes, events and exceptions.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0011"
down_revision: str | None = "0010"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "calendar_import_uploads",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("file_name", sa.String(255), nullable=False),
        sa.Column("size", sa.Integer(), nullable=False),
        sa.Column("sha256", sa.String(64), nullable=False),
        sa.Column("staged_name", sa.String(), nullable=False),
        sa.Column("event_count", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.String(), nullable=False),
        sa.Column("expires_at", sa.String(), nullable=False),
        sa.CheckConstraint(
            "size BETWEEN 1 AND 5242880", name=op.f("ck_calendar_import_uploads_size")
        ),
        sa.CheckConstraint(
            "event_count BETWEEN 0 AND 5000", name=op.f("ck_calendar_import_uploads_event_count")
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_calendar_import_uploads_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_calendar_import_uploads")),
    )
    op.create_index(
        op.f("ix_calendar_import_uploads_user_id"), "calendar_import_uploads", ["user_id"]
    )

    op.create_table(
        "calendar_import_runs",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("file_name", sa.String(255), nullable=False),
        sa.Column("file_sha256", sa.String(64), nullable=False),
        sa.Column("destination_semester_id", sa.String(), nullable=True),
        sa.Column("created_json", sa.Text(), nullable=False),
        sa.Column("updated_json", sa.Text(), nullable=False),
        sa.Column("summary_json", sa.Text(), nullable=False),
        sa.Column("created_at", sa.String(), nullable=False),
        sa.Column("undone_at", sa.String(), nullable=True),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_calendar_import_runs_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["destination_semester_id"],
            ["semesters.id"],
            name=op.f("fk_calendar_import_runs_destination_semester_id_semesters"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_calendar_import_runs")),
    )
    op.create_index(op.f("ix_calendar_import_runs_user_id"), "calendar_import_runs", ["user_id"])

    op.create_table(
        "calendar_import_sources",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("source_uid", sa.String(1024), nullable=False),
        sa.Column("recurrence_key", sa.String(), nullable=False, server_default=""),
        sa.Column("kind", sa.String(8), nullable=False),
        sa.Column("lineage_id", sa.String(), nullable=False),
        sa.Column("first_run_id", sa.String(), nullable=True),
        sa.Column("last_run_id", sa.String(), nullable=True),
        sa.CheckConstraint(
            "kind IN ('class', 'event')", name=op.f("ck_calendar_import_sources_kind")
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_calendar_import_sources_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["first_run_id"],
            ["calendar_import_runs.id"],
            name=op.f("fk_calendar_import_sources_first_run_id_calendar_import_runs"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["last_run_id"],
            ["calendar_import_runs.id"],
            name=op.f("fk_calendar_import_sources_last_run_id_calendar_import_runs"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_calendar_import_sources")),
        sa.UniqueConstraint(
            "user_id", "source_uid", "recurrence_key", name="uq_calendar_import_sources_key"
        ),
    )
    op.create_index(
        "ix_calendar_import_sources_user_lineage",
        "calendar_import_sources",
        ["user_id", "lineage_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_calendar_import_sources_user_lineage", table_name="calendar_import_sources")
    op.drop_table("calendar_import_sources")
    op.drop_index(op.f("ix_calendar_import_runs_user_id"), table_name="calendar_import_runs")
    op.drop_table("calendar_import_runs")
    op.drop_index(op.f("ix_calendar_import_uploads_user_id"), table_name="calendar_import_uploads")
    op.drop_table("calendar_import_uploads")
