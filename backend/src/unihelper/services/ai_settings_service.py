"""Custom instructions and the model new chats start with (014 FR-038, FR-060)."""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from unihelper.models import AiModel, AiSettings, User


def row(db: Session, user: User) -> AiSettings:
    settings = db.get(AiSettings, user.id)
    if settings is None:
        settings = AiSettings(user_id=user.id, custom_instructions="")
        db.add(settings)
        db.flush()
    return settings


def view(db: Session, user: User) -> dict[str, Any]:
    settings = row(db, user)
    model = db.get(AiModel, settings.last_model_id) if settings.last_model_id else None
    return {
        "custom_instructions": settings.custom_instructions,
        "last_model": {"endpoint_id": model.endpoint_id, "model_id": model.id} if model else None,
        "version": settings.version,
    }


def put(db: Session, user: User, instructions: str) -> AiSettings:
    settings = row(db, user)
    settings.custom_instructions = instructions.strip()
    db.flush()
    return settings


def set_last_model(db: Session, user: User, model_id: str) -> None:
    settings = row(db, user)
    if settings.last_model_id != model_id:
        settings.last_model_id = model_id
        db.flush()


def instructions(db: Session, user_id: str) -> str | None:
    settings = db.get(AiSettings, user_id)
    text = settings.custom_instructions.strip() if settings else ""
    return text or None
