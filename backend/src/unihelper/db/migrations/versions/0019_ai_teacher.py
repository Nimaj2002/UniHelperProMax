"""AI teacher: chat kinds, graph-extraction state, and the knowledge graph (022)

Revision ID: 0019
Revises: 0018
Create Date: 2026-11-05 18:00:00

Teacher chats are chats (research R1): `chats.kind` tells them apart. The knowledge graph is a
derived index whose sources point back at chats (R7, R10).
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0019"
down_revision: str | None = "0018"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _fk(table: str, column: str, target: str, ondelete: str) -> sa.ForeignKeyConstraint:
    return sa.ForeignKeyConstraint(
        [column],
        [f"{target}.id"],
        name=op.f(f"fk_{table}_{column}_{target}"),
        ondelete=ondelete,
    )


def upgrade() -> None:
    with op.batch_alter_table("chats", schema=None) as batch_op:
        batch_op.add_column(sa.Column("kind", sa.String(10), nullable=False, server_default="chat"))
        batch_op.add_column(
            sa.Column("unanswered_count", sa.Integer(), nullable=False, server_default="0")
        )
        batch_op.add_column(
            sa.Column("kg_processed_turns", sa.Integer(), nullable=False, server_default="0")
        )
        batch_op.add_column(sa.Column("kg_status", sa.String(10), nullable=True))
        batch_op.add_column(sa.Column("kg_error", sa.String(30), nullable=True))
        batch_op.add_column(sa.Column("kg_attempted_at", sa.String(), nullable=True))
        batch_op.create_check_constraint("kind", "kind IN ('chat', 'lesson', 'practice')")
        batch_op.create_index(
            "ix_chats_kind_kg", ["user_id", "kind", "kg_status", "updated_at"], unique=False
        )

    op.create_table(
        "kg_ideas",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("norm_name", sa.String(120), nullable=False),
        sa.Column("statement", sa.Text(), nullable=False),
        sa.Column("created_at", sa.String(), nullable=False),
        sa.Column("updated_at", sa.String(), nullable=False),
        _fk("kg_ideas", "user_id", "users", "CASCADE"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_kg_ideas")),
    )
    op.create_index("ix_kg_ideas_user_norm", "kg_ideas", ["user_id", "norm_name"])
    op.create_index("ix_kg_ideas_user_updated", "kg_ideas", ["user_id", "updated_at"])

    op.create_table(
        "kg_links",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("conclusion_id", sa.String(), nullable=False),
        sa.Column("signature", sa.String(64), nullable=False),
        _fk("kg_links", "user_id", "users", "CASCADE"),
        _fk("kg_links", "conclusion_id", "kg_ideas", "CASCADE"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_kg_links")),
        sa.UniqueConstraint("user_id", "signature", name="uq_kg_links_user_signature"),
    )
    op.create_index(op.f("ix_kg_links_conclusion_id"), "kg_links", ["conclusion_id"])

    op.create_table(
        "kg_link_premises",
        sa.Column("link_id", sa.String(), nullable=False),
        sa.Column("idea_id", sa.String(), nullable=False),
        _fk("kg_link_premises", "link_id", "kg_links", "CASCADE"),
        _fk("kg_link_premises", "idea_id", "kg_ideas", "CASCADE"),
        sa.PrimaryKeyConstraint("link_id", "idea_id", name=op.f("pk_kg_link_premises")),
    )
    op.create_index(op.f("ix_kg_link_premises_idea_id"), "kg_link_premises", ["idea_id"])

    op.create_table(
        "kg_sources",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("idea_id", sa.String(), nullable=True),
        sa.Column("link_id", sa.String(), nullable=True),
        sa.Column("chat_id", sa.String(), nullable=False),
        sa.Column("course_id", sa.String(), nullable=True),
        sa.Column("message_id", sa.String(64), nullable=True),
        sa.Column("created_at", sa.String(), nullable=False),
        sa.CheckConstraint(
            "(idea_id IS NULL) <> (link_id IS NULL)", name=op.f("ck_kg_sources_one_target")
        ),
        _fk("kg_sources", "user_id", "users", "CASCADE"),
        _fk("kg_sources", "idea_id", "kg_ideas", "CASCADE"),
        _fk("kg_sources", "link_id", "kg_links", "CASCADE"),
        _fk("kg_sources", "chat_id", "chats", "CASCADE"),
        _fk("kg_sources", "course_id", "courses", "SET NULL"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_kg_sources")),
        sa.UniqueConstraint("idea_id", "chat_id", "message_id", name="uq_kg_sources_idea"),
        sa.UniqueConstraint("link_id", "chat_id", "message_id", name="uq_kg_sources_link"),
    )
    op.create_index(op.f("ix_kg_sources_idea_id"), "kg_sources", ["idea_id"])
    op.create_index(op.f("ix_kg_sources_link_id"), "kg_sources", ["link_id"])
    op.create_index(op.f("ix_kg_sources_chat_id"), "kg_sources", ["chat_id"])


def downgrade() -> None:
    op.drop_table("kg_sources")
    op.drop_table("kg_link_premises")
    op.drop_table("kg_links")
    op.drop_table("kg_ideas")
    with op.batch_alter_table("chats", schema=None) as batch_op:
        batch_op.drop_index("ix_chats_kind_kg")
        batch_op.drop_constraint("kind", type_="check")
        for column in (
            "kg_attempted_at",
            "kg_error",
            "kg_status",
            "kg_processed_turns",
            "unanswered_count",
            "kind",
        ):
            batch_op.drop_column(column)
