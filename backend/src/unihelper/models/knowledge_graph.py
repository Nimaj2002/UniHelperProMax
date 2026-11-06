"""The knowledge graph (022 data-model.md): ideas, reasoning links and their sources.

A derived index with provenance back to teacher chat files (research R7). Sources cascade with
their chat, so hard-deleting a chat removes them; sourceless ideas are pruned afterwards (R10).
"""

from __future__ import annotations

from sqlalchemy import (
    CheckConstraint,
    ForeignKey,
    Index,
    PrimaryKeyConstraint,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from unihelper.models.base import Base, IdMixin, now_iso


class KgIdea(IdMixin, Base):
    __tablename__ = "kg_ideas"
    __table_args__ = (
        Index("ix_kg_ideas_user_norm", "user_id", "norm_name"),
        Index("ix_kg_ideas_user_updated", "user_id", "updated_at"),
    )

    user_id: Mapped[str] = mapped_column(
        String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    norm_name: Mapped[str] = mapped_column(String(120), nullable=False)
    statement: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[str] = mapped_column(String, nullable=False, default=now_iso)
    updated_at: Mapped[str] = mapped_column(String, nullable=False, default=now_iso)


class KgLink(IdMixin, Base):
    """One or more premise ideas that jointly lead to the conclusion idea."""

    __tablename__ = "kg_links"
    __table_args__ = (UniqueConstraint("user_id", "signature", name="uq_kg_links_user_signature"),)

    user_id: Mapped[str] = mapped_column(
        String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    conclusion_id: Mapped[str] = mapped_column(
        String, ForeignKey("kg_ideas.id", ondelete="CASCADE"), nullable=False, index=True
    )
    signature: Mapped[str] = mapped_column(String(64), nullable=False)


class KgLinkPremise(Base):
    __tablename__ = "kg_link_premises"
    __table_args__ = (PrimaryKeyConstraint("link_id", "idea_id"),)

    link_id: Mapped[str] = mapped_column(
        String, ForeignKey("kg_links.id", ondelete="CASCADE"), nullable=False
    )
    idea_id: Mapped[str] = mapped_column(
        String, ForeignKey("kg_ideas.id", ondelete="CASCADE"), nullable=False, index=True
    )


class KgSource(IdMixin, Base):
    __tablename__ = "kg_sources"
    __table_args__ = (
        CheckConstraint("(idea_id IS NULL) <> (link_id IS NULL)", name="one_target"),
        UniqueConstraint("idea_id", "chat_id", "message_id", name="uq_kg_sources_idea"),
        UniqueConstraint("link_id", "chat_id", "message_id", name="uq_kg_sources_link"),
    )

    user_id: Mapped[str] = mapped_column(
        String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    idea_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("kg_ideas.id", ondelete="CASCADE"), nullable=True, index=True
    )
    link_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("kg_links.id", ondelete="CASCADE"), nullable=True, index=True
    )
    chat_id: Mapped[str] = mapped_column(
        String, ForeignKey("chats.id", ondelete="CASCADE"), nullable=False, index=True
    )
    course_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("courses.id", ondelete="SET NULL"), nullable=True
    )
    message_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[str] = mapped_column(String, nullable=False, default=now_iso)
