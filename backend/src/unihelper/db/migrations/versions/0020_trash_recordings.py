"""Trash entries for overwritten recordings (025)

Revision ID: 0020
Revises: 0019
Create Date: 2026-11-17 10:00:00

An overwrite in the Media Editor moves the old audio to the Trash. `trash_entries.kind` gains
'recording' (wider column) and `reason` gains 'overwrite'. Changing a CHECK rebuilds the table;
`db/migrate.py` runs this with foreign keys off, like 0008.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0020"
down_revision: str | None = "0019"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("trash_entries", recreate="always") as batch_op:
        batch_op.alter_column("kind", existing_type=sa.String(length=8), type_=sa.String(length=16))
        batch_op.drop_constraint(op.f("ck_trash_entries_kind"), type_="check")
        batch_op.drop_constraint(op.f("ck_trash_entries_reason"), type_="check")
        batch_op.create_check_constraint("kind", "kind IN ('class', 'event', 'recording')")
        batch_op.create_check_constraint(
            "reason", "reason IN ('delete', 'hierarchy_delete', 'overwrite')"
        )


def downgrade() -> None:
    blocking = (
        op.get_bind()
        .exec_driver_sql("SELECT COUNT(*) FROM trash_entries WHERE kind = 'recording'")
        .scalar()
    )
    if blocking:
        raise RuntimeError(
            f"{blocking} Trash recording(s) exist; restore or delete them before downgrading."
        )
    with op.batch_alter_table("trash_entries", recreate="always") as batch_op:
        batch_op.drop_constraint(op.f("ck_trash_entries_reason"), type_="check")
        batch_op.drop_constraint(op.f("ck_trash_entries_kind"), type_="check")
        batch_op.create_check_constraint("kind", "kind IN ('class', 'event')")
        batch_op.create_check_constraint("reason", "reason IN ('delete', 'hierarchy_delete')")
        batch_op.alter_column("kind", existing_type=sa.String(length=16), type_=sa.String(length=8))
