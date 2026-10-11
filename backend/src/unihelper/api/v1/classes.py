from __future__ import annotations

from typing import Any

from fastapi import APIRouter, status

from unihelper.api.deps import CurrentUser, DbSession, Storage
from unihelper.schemas.classes import ClassCreate, ClassCreated, ClassDetail
from unihelper.services import class_service

router = APIRouter(prefix="/classes", tags=["classes"])


@router.post(
    "",
    response_model=ClassCreated,
    status_code=status.HTTP_201_CREATED,
    response_model_exclude_none=True,
)
def create_class(body: ClassCreate, user: CurrentUser, db: DbSession, storage: Storage) -> Any:
    created: dict[str, str] = {}
    series = class_service.create_class(db, storage, user, body, created)
    # 009: the rows this request made, for the quick form's Undo
    return {
        **class_service.series_out(series),
        "created": {"lineage_id": series.lineage_id, **created},
    }


@router.get("/{lineage_id}", response_model=ClassDetail, response_model_exclude_none=True)
def get_class(lineage_id: str, user: CurrentUser, db: DbSession) -> Any:
    return class_service.get_lineage(db, user, lineage_id)
