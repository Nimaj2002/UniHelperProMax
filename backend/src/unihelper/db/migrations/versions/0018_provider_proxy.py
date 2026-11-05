"""provider proxy: one proxy per user and a "Use proxy" switch per section (021)

Revision ID: 0018
Revises: 0017
Create Date: 2026-11-05 12:00:00

The proxy password is a `secrets` row (owner kind "proxy"), so it needs no column here.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0018"
down_revision: str | None = "0017"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "proxy_settings",
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("scheme", sa.String(8), nullable=False),
        sa.Column("host", sa.String(253), nullable=False),
        sa.Column("port", sa.Integer(), nullable=False),
        sa.Column("username", sa.String(255), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.String(), nullable=False),
        sa.Column("updated_at", sa.String(), nullable=False),
        sa.CheckConstraint(
            "scheme IN ('http', 'https', 'socks5')", name=op.f("ck_proxy_settings_scheme")
        ),
        sa.CheckConstraint("port BETWEEN 1 AND 65535", name=op.f("ck_proxy_settings_port")),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_proxy_settings_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("user_id", name=op.f("pk_proxy_settings")),
    )
    for table in ("transcription_settings", "ai_settings"):
        with op.batch_alter_table(table, schema=None) as batch_op:
            batch_op.add_column(
                sa.Column("use_proxy", sa.Boolean(), nullable=False, server_default=sa.false())
            )


def downgrade() -> None:
    for table in ("ai_settings", "transcription_settings"):
        with op.batch_alter_table(table, schema=None) as batch_op:
            batch_op.drop_column("use_proxy")
    op.drop_table("proxy_settings")
