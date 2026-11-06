"""The knowledge graph (022 contracts/openapi.yaml)."""

from __future__ import annotations

from unihelper.schemas.common import ApiModel
from unihelper.schemas.teacher import IdeaSummary


class LinkOut(ApiModel):
    id: str
    premise_ids: list[str]
    conclusion_id: str


class GraphOut(ApiModel):
    version: str
    ideas: list[IdeaSummary]
    links: list[LinkOut]


class SourceOut(ApiModel):
    chat_id: str
    chat_title: str
    session_key: str
    session_label: str = ""
    course_id: str | None = None
    message_id: str | None = None
    created_at: str
    available: bool


class FollowsFrom(ApiModel):
    link_id: str
    premises: list[IdeaSummary]


class LeadsTo(ApiModel):
    link_id: str
    conclusion: IdeaSummary


class IdeaDetail(IdeaSummary):
    follows_from: list[FollowsFrom]
    leads_to: list[LeadsTo]
    sources: list[SourceOut]
