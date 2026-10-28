"""document_hides: course PDFs hidden from one session's list (017)

Revision ID: 0015
Revises: 0014
Create Date: 2026-10-29 12:00:00

Adds `document_hides`. A session that doesn't own a PDF "removes" it by hiding it there; the PDF,
its file and its annotations stay in the owning session (017 research R1). Database-only, like
every earlier migration.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0015"
down_revision: str | None = "0014"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "document_hides",
        sa.Column("session_folder_id", sa.String(), nullable=False),
        sa.Column("document_id", sa.String(), nullable=False),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("created_at", sa.String(), nullable=False),
        sa.ForeignKeyConstraint(
            ["session_folder_id"],
            ["session_folders.id"],
            name=op.f("fk_document_hides_session_folder_id_session_folders"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["document_id"],
            ["documents.id"],
            name=op.f("fk_document_hides_document_id_documents"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_document_hides_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("session_folder_id", "document_id", name=op.f("pk_document_hides")),
    )
    op.create_index(
        op.f("ix_document_hides_document_id"), "document_hides", ["document_id"], unique=False
    )
    op.create_index(op.f("ix_document_hides_user_id"), "document_hides", ["user_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_document_hides_user_id"), table_name="document_hides")
    op.drop_index(op.f("ix_document_hides_document_id"), table_name="document_hides")
    op.drop_table("document_hides")
