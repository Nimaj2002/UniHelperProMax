from __future__ import annotations

from sqlalchemy import CheckConstraint, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from unihelper.models.base import Base, IdMixin, TimestampMixin, VersionMixin


class Recording(IdMixin, TimestampMixin, VersionMixin, Base):
    """An audio file in a session's audios/ folder, written progressively in chunks."""

    __tablename__ = "recordings"
    __table_args__ = (
        UniqueConstraint("session_folder_id", "name_key", name="uq_recordings_folder_name"),
        UniqueConstraint("session_folder_id", "file_key", name="uq_recordings_folder_file"),
        CheckConstraint("length(name) BETWEEN 1 AND 120", name="name_len"),
        CheckConstraint("status IN ('recording', 'complete', 'interrupted')", name="status"),
        CheckConstraint("mime_type IN ('audio/webm', 'audio/mp4')", name="mime"),
        CheckConstraint("next_seq >= 0", name="next_seq"),
    )

    user_id: Mapped[str] = mapped_column(
        String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    session_folder_id: Mapped[str] = mapped_column(
        String, ForeignKey("session_folders.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    name_key: Mapped[str] = mapped_column(String, nullable=False)
    file_name: Mapped[str] = mapped_column(String, nullable=False)
    file_key: Mapped[str] = mapped_column(String, nullable=False)
    mime_type: Mapped[str] = mapped_column(String(16), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="recording")
    started_at: Mapped[str] = mapped_column(String, nullable=False)
    duration_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    size: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    next_seq: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_chunk_at: Mapped[str | None] = mapped_column(String, nullable=True)
