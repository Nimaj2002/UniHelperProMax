from __future__ import annotations

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from unihelper.models.base import Base, IdMixin, TimestampMixin, VersionMixin, now_iso

MAX_DOCUMENT_BYTES = 200 * 1024 * 1024  # 209,715,200 (FR-004)


class Document(IdMixin, TimestampMixin, VersionMixin, Base):
    """A PDF in a session's documents/ folder (007). The file is never written after upload;
    annotations live in `<name>.annotations.json` next to it (Constitution II)."""

    __tablename__ = "documents"
    __table_args__ = (
        UniqueConstraint("session_folder_id", "name_key", name="uq_documents_folder_name"),
        UniqueConstraint("session_folder_id", "file_key", name="uq_documents_folder_file"),
        CheckConstraint("length(name) BETWEEN 1 AND 120", name="name_len"),
        CheckConstraint(f"size BETWEEN 1 AND {MAX_DOCUMENT_BYTES}", name="size"),
        CheckConstraint("page_count IS NULL OR page_count >= 1", name="page_count"),
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
    original_file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    size: Mapped[int] = mapped_column(Integer, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    encrypted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    page_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    uploaded_at: Mapped[str] = mapped_column(String, nullable=False)


class DocumentPosition(Base):
    """The last page a user read in a document (FR-019)."""

    __tablename__ = "document_positions"
    __table_args__ = (CheckConstraint("page >= 1", name="page"),)

    user_id: Mapped[str] = mapped_column(
        String, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    document_id: Mapped[str] = mapped_column(
        String, ForeignKey("documents.id", ondelete="CASCADE"), primary_key=True
    )
    page: Mapped[int] = mapped_column(Integer, nullable=False)
    updated_at: Mapped[str] = mapped_column(
        String, nullable=False, default=now_iso, onupdate=now_iso
    )


class AnnotationOp(Base):
    """An applied annotation operation, so a retried batch gets the same result instead of
    being applied twice (research R7). Metadata only: content lives in the sidecar file."""

    __tablename__ = "annotation_ops"

    op_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    document_id: Mapped[str] = mapped_column(
        String, ForeignKey("documents.id", ondelete="CASCADE"), nullable=False, index=True
    )
    result_json: Mapped[str] = mapped_column(Text, nullable=False)
    applied_at: Mapped[str] = mapped_column(String, nullable=False, default=now_iso)
