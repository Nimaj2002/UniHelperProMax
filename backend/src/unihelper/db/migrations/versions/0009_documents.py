"""documents: session PDFs, reading positions, annotation op ids, typed workspace tabs (007)

Revision ID: 0009
Revises: 0008
Create Date: 2026-10-08 12:00:00

New tables only, plus two nullable columns added with ALTER TABLE ADD COLUMN — no table is
rebuilt, so no foreign-key cascade can fire (see 0008 / db/migrate.py).
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0009"
down_revision: str | None = "0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "documents",
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("session_folder_id", sa.String(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("name_key", sa.String(), nullable=False),
        sa.Column("file_name", sa.String(), nullable=False),
        sa.Column("file_key", sa.String(), nullable=False),
        sa.Column("original_file_name", sa.String(length=255), nullable=False),
        sa.Column("size", sa.Integer(), nullable=False),
        sa.Column("sha256", sa.String(length=64), nullable=False),
        sa.Column("encrypted", sa.Boolean(), nullable=False),
        sa.Column("page_count", sa.Integer(), nullable=True),
        sa.Column("uploaded_at", sa.String(), nullable=False),
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("created_at", sa.String(), nullable=False),
        sa.Column("updated_at", sa.String(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.CheckConstraint("length(name) BETWEEN 1 AND 120", name=op.f("ck_documents_name_len")),
        sa.CheckConstraint("size BETWEEN 1 AND 209715200", name=op.f("ck_documents_size")),
        sa.CheckConstraint(
            "page_count IS NULL OR page_count >= 1", name=op.f("ck_documents_page_count")
        ),
        sa.ForeignKeyConstraint(
            ["session_folder_id"],
            ["session_folders.id"],
            name=op.f("fk_documents_session_folder_id_session_folders"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_documents_user_id_users"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_documents")),
        sa.UniqueConstraint("session_folder_id", "file_key", name="uq_documents_folder_file"),
        sa.UniqueConstraint("session_folder_id", "name_key", name="uq_documents_folder_name"),
    )
    op.create_index(
        op.f("ix_documents_session_folder_id"), "documents", ["session_folder_id"], unique=False
    )
    op.create_index(op.f("ix_documents_user_id"), "documents", ["user_id"], unique=False)

    op.create_table(
        "document_positions",
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("document_id", sa.String(), nullable=False),
        sa.Column("page", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.String(), nullable=False),
        sa.CheckConstraint("page >= 1", name=op.f("ck_document_positions_page")),
        sa.ForeignKeyConstraint(
            ["document_id"],
            ["documents.id"],
            name=op.f("fk_document_positions_document_id_documents"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_document_positions_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("user_id", "document_id", name=op.f("pk_document_positions")),
    )

    op.create_table(
        "annotation_ops",
        sa.Column("op_id", sa.String(length=64), nullable=False),
        sa.Column("document_id", sa.String(), nullable=False),
        sa.Column("result_json", sa.Text(), nullable=False),
        sa.Column("applied_at", sa.String(), nullable=False),
        sa.ForeignKeyConstraint(
            ["document_id"],
            ["documents.id"],
            name=op.f("fk_annotation_ops_document_id_documents"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("op_id", name=op.f("pk_annotation_ops")),
    )
    op.create_index(
        op.f("ix_annotation_ops_document_id"), "annotation_ops", ["document_id"], unique=False
    )

    op.add_column("workspace_states", sa.Column("tabs_json", sa.Text(), nullable=True))
    op.add_column("workspace_states", sa.Column("split_json", sa.Text(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("workspace_states") as batch_op:
        batch_op.drop_column("split_json")
        batch_op.drop_column("tabs_json")
    op.drop_index(op.f("ix_annotation_ops_document_id"), table_name="annotation_ops")
    op.drop_table("annotation_ops")
    op.drop_table("document_positions")
    op.drop_index(op.f("ix_documents_user_id"), table_name="documents")
    op.drop_index(op.f("ix_documents_session_folder_id"), table_name="documents")
    op.drop_table("documents")
