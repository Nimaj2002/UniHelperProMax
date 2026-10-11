"""events_trash: event series, the Trash, event/trashed session folders (009)

Revision ID: 0010
Revises: 0009
Create Date: 2026-10-10 12:00:00

- `event_series` / `event_links`: events are a second kind of series next to classes, owned by
  a semester, sharing the `{lineage_id}:{date}` keyspace so every `sessionKey` API serves them
  (009 research R2). A separate table keeps class rows, queries and counts untouched.
- `trash_entries`: one row per deleted class/event lineage with the exact before-images needed
  to restore it (R6). Content rows are detached, never deleted, and no file is touched.
- `session_folders` is rebuilt: `course_id` becomes nullable (SET NULL), and it gains
  `semester_id` (event folders), `kind`, `trash_entry_id` and `origin_path` (folders of trashed
  occurrences), plus UNIQUE (semester_id, folder_key) for `_Events/<date title>` names (R5).
  Existing rows become `kind = 'class'`; notes, recordings and documents keep their FK.
- `session_exceptions` gains `title`, `color`, `links_json`, `moved_date` (event "This event"
  edits, R3) and `detached` (frozen occurrences, R4). It is rebuilt too so the location CHECK
  matches the event limit (200); it has no child tables.

Rebuilds run with foreign keys off (db/migrate.py), so no cascade fires; `foreign_key_check`
runs before commit. No course is renamed: a course already in a `_Events` folder is reported
by the course tree (`reservedNameConflict`, R1).
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0010"
down_revision: str | None = "0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

COLORS = (
    "IN ('slate', 'red', 'orange', 'amber', 'lime', 'green', 'teal', 'cyan', 'blue', 'indigo', "
    "'violet', 'pink')"
)
FOLDER_OWNER = (
    "trash_entry_id IS NOT NULL"
    " OR (kind = 'class' AND course_id IS NOT NULL)"
    " OR (kind = 'event' AND semester_id IS NOT NULL)"
)


def upgrade() -> None:
    op.create_table(
        "trash_entries",
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("kind", sa.String(length=8), nullable=False),
        sa.Column("lineage_id", sa.String(), nullable=False),
        sa.Column("label", sa.String(), nullable=False),
        sa.Column("year_name", sa.String(), nullable=False),
        sa.Column("semester_name", sa.String(), nullable=False),
        sa.Column("course_name", sa.String(), nullable=True),
        sa.Column("first_date", sa.Date(), nullable=False),
        sa.Column("last_date", sa.Date(), nullable=False),
        sa.Column("occurrence_count", sa.Integer(), nullable=False),
        sa.Column("note_count", sa.Integer(), nullable=False),
        sa.Column("recording_count", sa.Integer(), nullable=False),
        sa.Column("document_count", sa.Integer(), nullable=False),
        sa.Column("reason", sa.String(length=16), nullable=False),
        sa.Column("payload_json", sa.Text(), nullable=False),
        sa.Column("purge_error", sa.Text(), nullable=True),
        sa.Column("deleted_at", sa.String(), nullable=False),
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.CheckConstraint("kind IN ('class', 'event')", name=op.f("ck_trash_entries_kind")),
        sa.CheckConstraint(
            "reason IN ('delete', 'hierarchy_delete')", name=op.f("ck_trash_entries_reason")
        ),
        sa.CheckConstraint(
            "note_count >= 0 AND recording_count >= 0 AND document_count >= 0",
            name=op.f("ck_trash_entries_counts"),
        ),
        sa.CheckConstraint("occurrence_count >= 1", name=op.f("ck_trash_entries_occurrence_count")),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_trash_entries_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_trash_entries")),
    )
    op.create_index(
        op.f("ix_trash_entries_lineage_id"), "trash_entries", ["lineage_id"], unique=False
    )
    op.create_index(
        "ix_trash_entries_user_deleted", "trash_entries", ["user_id", "deleted_at"], unique=False
    )

    op.create_table(
        "event_series",
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("semester_id", sa.String(), nullable=False),
        sa.Column("lineage_id", sa.String(), nullable=False),
        sa.Column("split_from_id", sa.String(), nullable=True),
        sa.Column("title", sa.String(length=120), nullable=False),
        sa.Column("location", sa.String(length=200), nullable=True),
        sa.Column("color", sa.String(length=16), nullable=False),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("start_time", sa.Time(), nullable=False),
        sa.Column("end_time", sa.Time(), nullable=False),
        sa.Column("freq", sa.String(length=8), nullable=False),
        sa.Column("interval_weeks", sa.Integer(), nullable=False),
        sa.Column("by_weekday", sa.String(), nullable=False),
        sa.Column("end_kind", sa.String(length=16), nullable=False),
        sa.Column("until_date", sa.Date(), nullable=True),
        sa.Column("count", sa.Integer(), nullable=True),
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("created_at", sa.String(), nullable=False),
        sa.Column("updated_at", sa.String(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.CheckConstraint(f"color {COLORS}", name=op.f("ck_event_series_color")),
        sa.CheckConstraint(
            "end_kind IN ('never', 'semester_end', 'until', 'count')",
            name=op.f("ck_event_series_end_kind"),
        ),
        sa.CheckConstraint("freq IN ('none', 'weekly')", name=op.f("ck_event_series_freq")),
        sa.CheckConstraint(
            "count IS NULL OR count BETWEEN 1 AND 500", name=op.f("ck_event_series_count")
        ),
        sa.CheckConstraint("end_time > start_time", name=op.f("ck_event_series_time_order")),
        sa.CheckConstraint("interval_weeks >= 1", name=op.f("ck_event_series_interval")),
        sa.CheckConstraint(
            "length(title) BETWEEN 1 AND 120", name=op.f("ck_event_series_title_len")
        ),
        sa.CheckConstraint(
            "location IS NULL OR length(location) <= 200", name=op.f("ck_event_series_location_len")
        ),
        sa.ForeignKeyConstraint(
            ["semester_id"],
            ["semesters.id"],
            name=op.f("fk_event_series_semester_id_semesters"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["split_from_id"],
            ["event_series.id"],
            name=op.f("fk_event_series_split_from_id_event_series"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_event_series_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_event_series")),
    )
    op.create_index(
        op.f("ix_event_series_lineage_id"), "event_series", ["lineage_id"], unique=False
    )
    op.create_index(
        "ix_event_series_user_semester", "event_series", ["user_id", "semester_id"], unique=False
    )

    op.create_table(
        "event_links",
        sa.Column("series_id", sa.String(), nullable=False),
        sa.Column("label", sa.String(length=60), nullable=True),
        sa.Column("url", sa.String(length=2048), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("id", sa.String(), nullable=False),
        sa.CheckConstraint(
            "label IS NULL OR length(label) <= 60", name=op.f("ck_event_links_label_len")
        ),
        sa.CheckConstraint("length(url) <= 2048", name=op.f("ck_event_links_url_len")),
        sa.ForeignKeyConstraint(
            ["series_id"],
            ["event_series.id"],
            name=op.f("fk_event_links_series_id_event_series"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_event_links")),
    )
    op.create_index(op.f("ix_event_links_series_id"), "event_links", ["series_id"], unique=False)

    with op.batch_alter_table("session_exceptions", recreate="always") as batch_op:
        batch_op.add_column(sa.Column("title", sa.String(length=120), nullable=True))
        batch_op.add_column(sa.Column("color", sa.String(length=16), nullable=True))
        batch_op.add_column(sa.Column("links_json", sa.Text(), nullable=True))
        batch_op.add_column(sa.Column("moved_date", sa.Date(), nullable=True))
        batch_op.add_column(sa.Column("detached", sa.Boolean(), server_default="0", nullable=False))
        batch_op.alter_column(
            "location",
            existing_type=sa.VARCHAR(length=120),
            type_=sa.String(length=200),
            existing_nullable=True,
        )
        batch_op.drop_constraint(op.f("ck_session_exceptions_location_len"), type_="check")
        batch_op.create_check_constraint(
            "location_len", "location IS NULL OR length(location) <= 200"
        )
        batch_op.create_check_constraint(
            "title_len", "title IS NULL OR length(title) BETWEEN 1 AND 120"
        )
        batch_op.create_check_constraint("color", f"color IS NULL OR color {COLORS}")

    with op.batch_alter_table("session_folders", recreate="always") as batch_op:
        batch_op.add_column(sa.Column("semester_id", sa.String(), nullable=True))
        batch_op.add_column(
            sa.Column("kind", sa.String(length=8), server_default="class", nullable=False)
        )
        batch_op.add_column(sa.Column("trash_entry_id", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("origin_path", sa.Text(), nullable=True))
        batch_op.alter_column("course_id", existing_type=sa.VARCHAR(), nullable=True)
        batch_op.alter_column(
            "title",
            existing_type=sa.VARCHAR(length=60),
            type_=sa.String(length=120),
            existing_nullable=True,
        )
        batch_op.alter_column(
            "location",
            existing_type=sa.VARCHAR(length=120),
            type_=sa.String(length=200),
            existing_nullable=True,
        )
        batch_op.drop_constraint(op.f("fk_session_folders_course_id_courses"), type_="foreignkey")
        batch_op.create_foreign_key(
            op.f("fk_session_folders_course_id_courses"),
            "courses",
            ["course_id"],
            ["id"],
            ondelete="SET NULL",
        )
        batch_op.create_foreign_key(
            op.f("fk_session_folders_semester_id_semesters"),
            "semesters",
            ["semester_id"],
            ["id"],
            ondelete="SET NULL",
        )
        batch_op.create_foreign_key(
            op.f("fk_session_folders_trash_entry_id_trash_entries"),
            "trash_entries",
            ["trash_entry_id"],
            ["id"],
            ondelete="SET NULL",
        )
        batch_op.create_check_constraint("kind", "kind IN ('class', 'event')")
        batch_op.create_check_constraint("owner", FOLDER_OWNER)
        batch_op.create_unique_constraint(
            "uq_session_folders_semester_folder", ["semester_id", "folder_key"]
        )
        batch_op.create_index(
            op.f("ix_session_folders_trash_entry_id"), ["trash_entry_id"], unique=False
        )
        batch_op.create_index(
            "ix_session_folders_user_semester", ["user_id", "semester_id"], unique=False
        )


def downgrade() -> None:
    conn = op.get_bind()
    blocking = conn.exec_driver_sql(
        "SELECT (SELECT COUNT(*) FROM event_series) + (SELECT COUNT(*) FROM trash_entries)"
        " + (SELECT COUNT(*) FROM session_folders WHERE kind <> 'class' OR course_id IS NULL)"
    ).scalar()
    if blocking:
        raise RuntimeError(
            "Events or Trash entries exist; delete them (and empty the Trash) before "
            "downgrading below 0010."
        )
    with op.batch_alter_table("session_folders", recreate="always") as batch_op:
        batch_op.drop_index("ix_session_folders_user_semester")
        batch_op.drop_index(op.f("ix_session_folders_trash_entry_id"))
        batch_op.drop_constraint("uq_session_folders_semester_folder", type_="unique")
        batch_op.drop_constraint(op.f("ck_session_folders_owner"), type_="check")
        batch_op.drop_constraint(op.f("ck_session_folders_kind"), type_="check")
        batch_op.drop_constraint(
            op.f("fk_session_folders_trash_entry_id_trash_entries"), type_="foreignkey"
        )
        batch_op.drop_constraint(
            op.f("fk_session_folders_semester_id_semesters"), type_="foreignkey"
        )
        batch_op.drop_constraint(op.f("fk_session_folders_course_id_courses"), type_="foreignkey")
        batch_op.create_foreign_key(
            op.f("fk_session_folders_course_id_courses"),
            "courses",
            ["course_id"],
            ["id"],
            ondelete="CASCADE",
        )
        batch_op.alter_column(
            "location",
            existing_type=sa.String(length=200),
            type_=sa.VARCHAR(length=120),
            existing_nullable=True,
        )
        batch_op.alter_column(
            "title",
            existing_type=sa.String(length=120),
            type_=sa.VARCHAR(length=60),
            existing_nullable=True,
        )
        batch_op.alter_column("course_id", existing_type=sa.VARCHAR(), nullable=False)
        batch_op.drop_column("origin_path")
        batch_op.drop_column("trash_entry_id")
        batch_op.drop_column("kind")
        batch_op.drop_column("semester_id")

    with op.batch_alter_table("session_exceptions", recreate="always") as batch_op:
        batch_op.drop_constraint(op.f("ck_session_exceptions_color"), type_="check")
        batch_op.drop_constraint(op.f("ck_session_exceptions_title_len"), type_="check")
        batch_op.drop_constraint(op.f("ck_session_exceptions_location_len"), type_="check")
        batch_op.create_check_constraint(
            "location_len", "location IS NULL OR length(location) <= 120"
        )
        batch_op.alter_column(
            "location",
            existing_type=sa.String(length=200),
            type_=sa.VARCHAR(length=120),
            existing_nullable=True,
        )
        batch_op.drop_column("detached")
        batch_op.drop_column("moved_date")
        batch_op.drop_column("links_json")
        batch_op.drop_column("color")
        batch_op.drop_column("title")

    op.drop_index(op.f("ix_event_links_series_id"), table_name="event_links")
    op.drop_table("event_links")
    op.drop_index("ix_event_series_user_semester", table_name="event_series")
    op.drop_index(op.f("ix_event_series_lineage_id"), table_name="event_series")
    op.drop_table("event_series")
    op.drop_index("ix_trash_entries_user_deleted", table_name="trash_entries")
    op.drop_index(op.f("ix_trash_entries_lineage_id"), table_name="trash_entries")
    op.drop_table("trash_entries")
