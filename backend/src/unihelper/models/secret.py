from __future__ import annotations

from sqlalchemy import ForeignKey, Integer, LargeBinary, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from unihelper.models.base import Base, IdMixin, TimestampMixin

OWNER_KINDS = ("ai_endpoint", "transcription_provider")


class SecretStoreMeta(Base):
    """The installation's secret-store bookkeeping (014 research R7): one row, id = 1.

    `installation_id` names the key-store entry or key file and is not secret; the verifier is
    the AES-GCM encryption of a constant and tells "wrong or lost master key" apart."""

    __tablename__ = "secret_store_meta"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    installation_id: Mapped[str] = mapped_column(String(36), nullable=False)
    verifier_nonce: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    verifier_ct: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    store_kind: Mapped[str | None] = mapped_column(String(20), nullable=True)
    migration_state: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    migration_error: Mapped[str | None] = mapped_column(String(200), nullable=True)
    rotated_at: Mapped[str | None] = mapped_column(String, nullable=True)


class Secret(IdMixin, TimestampMixin, Base):
    """One encrypted provider key. Plaintext never lives in the database (Principle IV)."""

    __tablename__ = "secrets"
    __table_args__ = (
        UniqueConstraint("user_id", "owner_kind", "owner_id", name="uq_secrets_owner"),
    )

    user_id: Mapped[str] = mapped_column(
        String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    owner_kind: Mapped[str] = mapped_column(String(30), nullable=False)
    owner_id: Mapped[str] = mapped_column(String(64), nullable=False)
    nonce: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    ciphertext: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)

    def __repr__(self) -> str:  # never show key material
        return f"Secret(id={self.id!r}, owner_kind={self.owner_kind!r})"
