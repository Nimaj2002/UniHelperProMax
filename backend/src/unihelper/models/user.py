from __future__ import annotations

from sqlalchemy import Boolean, CheckConstraint, Index, String, text
from sqlalchemy.orm import Mapped, mapped_column

from unihelper.models.base import Base, IdMixin, TimestampMixin

ROLE_OWNER = "owner"
ROLE_MEMBER = "member"


class User(IdMixin, TimestampMixin, Base):
    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint("role IN ('owner', 'member')", name="role"),
        CheckConstraint(
            "length(username) BETWEEN 3 AND 32 AND username = lower(username)", name="username"
        ),
        # exactly one owner: partial unique index over the constant role value
        Index("uq_users_single_owner", "role", unique=True, sqlite_where=text("role = 'owner'")),
    )

    # 3–32 chars [a-z0-9._-], stored lowercase, UNIQUE; also the top storage folder
    username: Mapped[str] = mapped_column(String(32), nullable=False, unique=True)
    password_hash: Mapped[str] = mapped_column(String, nullable=False)
    role: Mapped[str] = mapped_column(String(16), nullable=False, default=ROLE_MEMBER)
    must_change_password: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    timezone: Mapped[str] = mapped_column(String(64), nullable=False, default="UTC")
    disabled_at: Mapped[str | None] = mapped_column(String, nullable=True)

    @property
    def is_owner(self) -> bool:
        return self.role == ROLE_OWNER
