"""The knowledge graph (022 US6, contracts/openapi.yaml)."""

from __future__ import annotations

from typing import Annotated, Any, Literal

from fastapi import APIRouter, Query, Response

from unihelper.api.deps import CurrentUser, DbSession
from unihelper.schemas.knowledge_graph import GraphOut, IdeaDetail
from unihelper.schemas.teacher import IdeaSummary
from unihelper.services import knowledge_graph_service as svc

router = APIRouter(tags=["graph"])


@router.get("/knowledge-graph", response_model=GraphOut)
def get_graph(user: CurrentUser, db: DbSession) -> Any:
    return svc.graph(db, user)


@router.get("/knowledge-graph/ideas", response_model=list[IdeaSummary])
def search_ideas(
    user: CurrentUser,
    db: DbSession,
    q: Annotated[str | None, Query(max_length=200)] = None,
    course_id: Annotated[str | None, Query(alias="courseId")] = None,
    sort: Literal["relevance", "recent"] = "relevance",
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> Any:
    return svc.search(db, user, q, course_id, sort, limit)


@router.get("/knowledge-graph/ideas/{idea_id}", response_model=IdeaDetail)
def get_idea(idea_id: str, user: CurrentUser, db: DbSession) -> Any:
    return svc.detail(db, user, idea_id)


@router.delete("/knowledge-graph/ideas/{idea_id}", status_code=204)
def delete_idea(idea_id: str, user: CurrentUser, db: DbSession) -> Response:
    svc.delete_idea(db, user, idea_id)
    return Response(status_code=204)
