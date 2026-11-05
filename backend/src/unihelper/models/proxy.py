from __future__ import annotations

from sqlalchemy import CheckConstraint, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from unihelper.models.base import Base, TimestampMixin, VersionMixin

SCHEMES = ("http", "https", "socks5")


class ProxySettings(TimestampMixin, VersionMixin, Base):
    """A user's one proxy (021). The password is a `Secret` with owner kind "proxy" and owner
    id = user id; it is never stored here."""

    __tablename__ = "proxy_settings"
    __table_args__ = (
        CheckConstraint("scheme IN ('http', 'https', 'socks5')", name="scheme"),
        CheckConstraint("port BETWEEN 1 AND 65535", name="port"),
    )

    user_id: Mapped[str] = mapped_column(
        String, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    scheme: Mapped[str] = mapped_column(String(8), nullable=False)
    host: Mapped[str] = mapped_column(String(253), nullable=False)
    port: Mapped[int] = mapped_column(Integer, nullable=False)
    username: Mapped[str | None] = mapped_column(String(255), nullable=True)

    def __repr__(self) -> str:
        return f"ProxySettings(user_id={self.user_id!r}, scheme={self.scheme!r})"
