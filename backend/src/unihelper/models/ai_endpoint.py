from __future__ import annotations

from sqlalchemy import Boolean, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from unihelper.models.base import Base, IdMixin, TimestampMixin, VersionMixin

STYLES = ("openai", "anthropic", "gemini")
LOCALITIES = ("local", "remote")


class AiEndpoint(IdMixin, TimestampMixin, VersionMixin, Base):
    """An AI service the student configured (014). `locality` is derived from `base_url` on
    every save and never accepted from the client."""

    __tablename__ = "ai_endpoints"
    __table_args__ = (UniqueConstraint("user_id", "name_key", name="uq_ai_endpoints_user_name"),)

    user_id: Mapped[str] = mapped_column(
        String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(60), nullable=False)
    name_key: Mapped[str] = mapped_column(String(60), nullable=False)
    style: Mapped[str] = mapped_column(String(20), nullable=False)
    base_url: Mapped[str] = mapped_column(String(2048), nullable=False)
    locality: Mapped[str] = mapped_column(String(10), nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    secret_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("secrets.id", ondelete="SET NULL"), nullable=True
    )
    privacy_ack_at: Mapped[str | None] = mapped_column(String, nullable=True)

    models: Mapped[list[AiModel]] = relationship(
        back_populates="endpoint",
        order_by="AiModel.position",
        cascade="all, delete-orphan",
    )


class AiModel(IdMixin, Base):
    __tablename__ = "ai_models"
    __table_args__ = (
        UniqueConstraint("endpoint_id", "model_id", name="uq_ai_models_endpoint_model"),
    )

    user_id: Mapped[str] = mapped_column(
        String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    endpoint_id: Mapped[str] = mapped_column(
        String, ForeignKey("ai_endpoints.id", ondelete="CASCADE"), nullable=False, index=True
    )
    model_id: Mapped[str] = mapped_column(String(200), nullable=False)
    display_name: Mapped[str] = mapped_column(String(80), nullable=False)
    cap_images: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    cap_pdf: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    cap_audio: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    hidden: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    source: Mapped[str] = mapped_column(String(10), nullable=False, default="manual")
    context_limit: Mapped[int | None] = mapped_column(Integer, nullable=True)
    output_limit: Mapped[int | None] = mapped_column(Integer, nullable=True)
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    endpoint: Mapped[AiEndpoint] = relationship(back_populates="models")


class AiSettings(VersionMixin, Base):
    __tablename__ = "ai_settings"

    user_id: Mapped[str] = mapped_column(
        String, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    custom_instructions: Mapped[str] = mapped_column(Text, nullable=False, default="")
    last_model_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("ai_models.id", ondelete="SET NULL"), nullable=True
    )
