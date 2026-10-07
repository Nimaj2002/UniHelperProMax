"""recording_origin: imported audio (006)

Revision ID: 0008
Revises: 0007
Create Date: 2026-10-06 15:00:00

Adds `recordings.origin` / `original_file_name` and widens the `mime_type` CHECK. Changing a
CHECK rebuilds the table; `db/migrate.py` runs this with foreign keys off so the rebuild does
not cascade-delete transcription jobs (006 research I2).
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0008"
down_revision: str | None = "0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

OLD_MIME = "mime_type IN ('audio/webm', 'audio/mp4')"
NEW_MIME = (
    "mime_type IN ('audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/ogg', "
    "'audio/flac', 'audio/aac')"
)


def upgrade() -> None:
    with op.batch_alter_table("recordings", recreate="always") as batch_op:
        batch_op.add_column(
            sa.Column("origin", sa.String(length=16), nullable=False, server_default="recorded")
        )
        batch_op.add_column(sa.Column("original_file_name", sa.String(length=255), nullable=True))
        batch_op.drop_constraint(op.f("ck_recordings_mime"), type_="check")
        batch_op.create_check_constraint("mime", NEW_MIME)
        batch_op.create_check_constraint("origin", "origin IN ('recorded', 'imported')")


def downgrade() -> None:
    conn = op.get_bind()
    blocking = conn.exec_driver_sql(
        f"SELECT COUNT(*) FROM recordings WHERE origin = 'imported' OR NOT ({OLD_MIME})"
    ).scalar()
    if blocking:
        raise RuntimeError(
            f"{blocking} imported recording(s) exist; delete them before downgrading below 0008."
        )
    with op.batch_alter_table("recordings", recreate="always") as batch_op:
        batch_op.drop_constraint(op.f("ck_recordings_origin"), type_="check")
        batch_op.drop_constraint(op.f("ck_recordings_mime"), type_="check")
        batch_op.create_check_constraint("mime", OLD_MIME)
        batch_op.drop_column("original_file_name")
        batch_op.drop_column("origin")
