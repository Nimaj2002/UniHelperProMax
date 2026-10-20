from __future__ import annotations

from sqlalchemy import (
    Boolean,
    ForeignKey,
    Index,
    Integer,
    PrimaryKeyConstraint,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from unihelper.models.base import Base, IdMixin, TimestampMixin, VersionMixin, now_iso

RUN_STATUSES = ("queued", "streaming", "completed", "stopped", "interrupted", "failed")
ACTIVE_RUN_STATUSES = ("queued", "streaming")


class Chat(IdMixin, TimestampMixin, VersionMixin, Base):
    """Index row of one chat; the conversation itself lives in
    `<session folder>/chats/<stem>.json` (014 research R11, Principle II)."""

    __tablename__ = "chats"
    __table_args__ = (
        UniqueConstraint("session_folder_id", "stem", name="uq_chats_folder_stem"),
        Index("ix_chats_folder_updated", "session_folder_id", "updated_at"),
    )

    user_id: Mapped[str] = mapped_column(
        String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    session_folder_id: Mapped[str] = mapped_column(
        String, ForeignKey("session_folders.id", ondelete="CASCADE"), nullable=False
    )
    stem: Mapped[str] = mapped_column(String(120), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    model_ref_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("ai_models.id", ondelete="SET NULL"), nullable=True
    )
    model_label: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    message_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    generating: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    unseen_answer: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    file_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    deleted_at: Mapped[str | None] = mapped_column(String, nullable=True)


class ChatRun(IdMixin, Base):
    __tablename__ = "chat_runs"

    user_id: Mapped[str] = mapped_column(
        String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    chat_id: Mapped[str] = mapped_column(
        String, ForeignKey("chats.id", ondelete="CASCADE"), nullable=False, index=True
    )
    answer_id: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="queued")
    started_at: Mapped[str] = mapped_column(String, nullable=False, default=now_iso)
    ended_at: Mapped[str | None] = mapped_column(String, nullable=True)
    error_category: Mapped[str | None] = mapped_column(String(30), nullable=True)


class ChatDraft(Base):
    """The unsent text and attachments of one chat, or of the new-chat box (`chat_key` = "")."""

    __tablename__ = "chat_drafts"
    __table_args__ = (PrimaryKeyConstraint("user_id", "lineage_id", "original_date", "chat_key"),)

    user_id: Mapped[str] = mapped_column(
        String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    lineage_id: Mapped[str] = mapped_column(String, nullable=False)
    original_date: Mapped[str] = mapped_column(String, nullable=False)
    chat_key: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    text: Mapped[str] = mapped_column(Text, nullable=False, default="")
    attachments_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    updated_at: Mapped[str] = mapped_column(
        String, nullable=False, default=now_iso, onupdate=now_iso
    )


class ChatUpload(IdMixin, Base):
    """A picture, PDF or audio file from the device: staged in `chats/.uploads/`, moved into
    `chats/<stem>.files/` when first sent."""

    __tablename__ = "chat_uploads"

    user_id: Mapped[str] = mapped_column(
        String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    session_folder_id: Mapped[str] = mapped_column(
        String, ForeignKey("session_folders.id", ondelete="CASCADE"), nullable=False, index=True
    )
    kind: Mapped[str] = mapped_column(String(10), nullable=False)
    mime: Mapped[str] = mapped_column(String(100), nullable=False)
    size: Mapped[int] = mapped_column(Integer, nullable=False)
    original_name: Mapped[str] = mapped_column(String(255), nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    rel_path: Mapped[str] = mapped_column(String(500), nullable=False)
    chat_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("chats.id", ondelete="CASCADE"), nullable=True
    )
    created_at: Mapped[str] = mapped_column(String, nullable=False, default=now_iso)
