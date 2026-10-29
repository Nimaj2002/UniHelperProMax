"""general notes: notes with no session folder (018)

Revision ID: 0016
Revises: 0015
Create Date: 2026-10-29 18:00:00

`notes.session_folder_id` becomes nullable: NULL marks a general note, whose file lives in
`<user>/General Notes/` (018 research R1). Two partial unique indexes give general notes the same
per-user name and file uniqueness the folder constraints give session notes (SQLite treats NULLs
as distinct, so those constraints don't cover them). Database-only, like every earlier migration.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0016"
down_revision: str | None = "0015"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

GENERAL = sa.text("session_folder_id IS NULL")


def upgrade() -> None:
    with op.batch_alter_table("notes", schema=None) as batch_op:
        batch_op.alter_column("session_folder_id", existing_type=sa.String(), nullable=True)
        batch_op.create_index(
            "uq_notes_general_name", ["user_id", "name_key"], unique=True, sqlite_where=GENERAL
        )
        batch_op.create_index(
            "uq_notes_general_file", ["user_id", "file_key"], unique=True, sqlite_where=GENERAL
        )


def downgrade() -> None:
    # general notes cannot exist without the nullable column; their files stay on disk
    op.execute("DELETE FROM notes WHERE session_folder_id IS NULL")
    with op.batch_alter_table("notes", schema=None) as batch_op:
        batch_op.drop_index("uq_notes_general_file", sqlite_where=GENERAL)
        batch_op.drop_index("uq_notes_general_name", sqlite_where=GENERAL)
        batch_op.alter_column("session_folder_id", existing_type=sa.String(), nullable=False)
