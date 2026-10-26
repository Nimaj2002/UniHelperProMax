"""data_epoch: a counter bumped by every restore of an account's data (016)

Revision ID: 0014
Revises: 0013
Create Date: 2026-10-26 18:00:00

Adds `users.data_epoch`. Every authenticated response carries it as `X-Data-Epoch`, so open
tabs reload after a restore, and startup recovery uses it to tell a committed restore from an
interrupted one (016 research R7, R11). Database-only, like every earlier migration.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0014"
down_revision: str | None = "0013"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("users") as batch_op:
        batch_op.add_column(
            sa.Column("data_epoch", sa.Integer(), nullable=False, server_default="0")
        )


def downgrade() -> None:
    with op.batch_alter_table("users") as batch_op:
        batch_op.drop_column("data_epoch")
