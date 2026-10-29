from __future__ import annotations

from sqlalchemy import CheckConstraint, ForeignKey, Index, Integer, String, UniqueConstraint, text
from sqlalchemy.orm import Mapped, mapped_column

from unihelper.models.base import Base, IdMixin, TimestampMixin, VersionMixin


class Note(IdMixin, TimestampMixin, VersionMixin, Base):
    """Index entry for one Markdown file in a session's notes/ folder (the file is the content).

    A general note (018) has no session folder; its file is in `<user>/General Notes/`."""

    __tablename__ = "notes"
    __table_args__ = (
        UniqueConstraint("session_folder_id", "name_key", name="uq_notes_folder_name"),
        UniqueConstraint("session_folder_id", "file_key", name="uq_notes_folder_file"),
        CheckConstraint("length(name) BETWEEN 1 AND 120", name="name_len"),
        # NULL folders are distinct to the constraints above, so general notes get their own
        Index(
            "uq_notes_general_name",
            "user_id",
            "name_key",
            unique=True,
            sqlite_where=text("session_folder_id IS NULL"),
        ),
        Index(
            "uq_notes_general_file",
            "user_id",
            "file_key",
            unique=True,
            sqlite_where=text("session_folder_id IS NULL"),
        ),
    )

    user_id: Mapped[str] = mapped_column(
        String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    session_folder_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("session_folders.id", ondelete="CASCADE"), nullable=True, index=True
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    name_key: Mapped[str] = mapped_column(String, nullable=False)
    file_name: Mapped[str] = mapped_column(String, nullable=False)
    file_key: Mapped[str] = mapped_column(String, nullable=False)
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    size: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
