"""The knowledge graph (022 US6): reads, search, the chat idea set, merging, deleting, pruning.

Visibility (data-model.md): a source counts only while its chat is not soft-deleted; an idea or
link with no visible source is hidden. Sources go with their chat on hard delete (cascade);
`prune` then removes what has no source at all (research R10).
"""

from __future__ import annotations

import hashlib
from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from unihelper.api.errors import ApiError
from unihelper.domain.kg_names import normalize
from unihelper.models import Chat, KgIdea, KgLink, KgLinkPremise, KgSource, SessionFolder, User
from unihelper.models.base import new_id, now_iso
from unihelper.schemas.teacher import MAX_IDEA_SET
from unihelper.teacher.prompts import IdeaText

MAX_NAME = 120
MAX_STATEMENT = 600


@dataclass
class _Idea:
    row: KgIdea
    courses: set[str] = field(default_factory=set)
    sources: int = 0
    last_taught: str = ""

    def out(self) -> dict[str, Any]:
        return {
            "id": self.row.id,
            "name": self.row.name,
            "statement": self.row.statement,
            "courseIds": sorted(self.courses),
            "sourceCount": self.sources,
            "updatedAt": self.row.updated_at,
        }


def _live_chats() -> Any:
    """Chats whose sources count: not deleted (Undo window) and not in the Trash."""
    return (
        select(Chat.id)
        .join(SessionFolder, SessionFolder.id == Chat.session_folder_id)
        .where(Chat.deleted_at.is_(None), SessionFolder.trash_entry_id.is_(None))
    )


def _visible(db: Session, user: User, ids: Iterable[str] | None = None) -> dict[str, _Idea]:
    """Ideas with at least one source in a chat that is not deleted, with their courses."""
    query = (
        select(KgIdea, KgSource.course_id, KgSource.created_at)
        .join(KgSource, KgSource.idea_id == KgIdea.id)
        .where(KgIdea.user_id == user.id, KgSource.chat_id.in_(_live_chats()))
    )
    if ids is not None:
        query = query.where(KgIdea.id.in_(list(ids)))
    out: dict[str, _Idea] = {}
    for row, course_id, created_at in db.execute(query):
        idea = out.setdefault(row.id, _Idea(row))
        idea.sources += 1
        if course_id:
            idea.courses.add(course_id)
        idea.last_taught = max(idea.last_taught, created_at)
    return out


def _links(db: Session, user: User, ideas: set[str]) -> list[tuple[str, list[str], str]]:
    """Visible links among `ideas`: (link id, premise ids, conclusion id)."""
    visible_links = set(
        db.scalars(
            select(KgSource.link_id).where(
                KgSource.user_id == user.id,
                KgSource.link_id.is_not(None),
                KgSource.chat_id.in_(_live_chats()),
            )
        )
    )
    premises: dict[str, list[str]] = defaultdict(list)
    for link_id, idea_id in db.execute(
        select(KgLinkPremise.link_id, KgLinkPremise.idea_id)
        .join(KgLink, KgLink.id == KgLinkPremise.link_id)
        .where(KgLink.user_id == user.id)
    ):
        premises[link_id].append(idea_id)
    out = []
    for link in db.scalars(select(KgLink).where(KgLink.user_id == user.id)):
        prem = sorted(premises.get(link.id, []))
        if (
            link.id in visible_links
            and prem
            and link.conclusion_id in ideas
            and all(p in ideas for p in prem)
        ):
            out.append((link.id, prem, link.conclusion_id))
    return out


# ───────────────────────────── reads ─────────────────────────────


def graph(db: Session, user: User) -> dict[str, Any]:
    ideas = _visible(db, user)
    links = _links(db, user, set(ideas))
    digest = hashlib.sha256()
    for idea_id in sorted(ideas):
        digest.update(f"{idea_id}:{ideas[idea_id].row.updated_at};".encode())
    for link_id, _p, _c in sorted(links):
        digest.update(link_id.encode())
    return {
        "version": digest.hexdigest()[:16],
        "ideas": [i.out() for i in sorted(ideas.values(), key=lambda i: i.row.name.casefold())],
        "links": [{"id": i, "premiseIds": p, "conclusionId": c} for i, p, c in links],
    }


def search(
    db: Session,
    user: User,
    q: str | None,
    course_id: str | None,
    sort: str = "relevance",
    limit: int = 50,
) -> list[dict[str, Any]]:
    ideas = list(_visible(db, user).values())
    if course_id:
        ideas = [i for i in ideas if course_id in i.courses]
    needle = (q or "").strip().casefold()
    if needle:
        ideas = [
            i
            for i in ideas
            if needle in i.row.name.casefold() or needle in i.row.statement.casefold()
        ]
    if sort == "recent":
        ideas.sort(key=lambda i: i.last_taught, reverse=True)
    else:
        ideas.sort(
            key=lambda i: (
                not i.row.name.casefold().startswith(needle),
                needle not in i.row.name.casefold(),
                i.row.name.casefold(),
            )
        )
    return [i.out() for i in ideas[:limit]]


def summaries(db: Session, user: User, ids: list[str]) -> list[dict[str, Any]]:
    found = _visible(db, user, ids)
    return [found[i].out() for i in ids if i in found]


def detail(db: Session, user: User, idea_id: str) -> dict[str, Any]:
    from unihelper.services.chat_service import label_of

    ideas = _visible(db, user)
    if idea_id not in ideas:
        raise ApiError(404, "not_found", "This idea doesn't exist.")
    links = _links(db, user, set(ideas))
    sources = []
    rows = db.execute(
        select(KgSource, Chat, SessionFolder)
        .join(Chat, Chat.id == KgSource.chat_id)
        .join(SessionFolder, SessionFolder.id == Chat.session_folder_id)
        .where(KgSource.idea_id == idea_id, KgSource.chat_id.in_(_live_chats()))
        .order_by(KgSource.created_at.desc())
    )
    for source, chat, folder in rows:
        sources.append(
            {
                "chatId": chat.id,
                "chatTitle": chat.title,
                "sessionKey": folder.session_key,
                "sessionLabel": label_of(db, chat),
                "courseId": source.course_id,
                "messageId": source.message_id,
                "createdAt": source.created_at,
                "available": True,
            }
        )
    return {
        **ideas[idea_id].out(),
        "followsFrom": [
            {"linkId": i, "premises": [ideas[x].out() for x in p]}
            for i, p, c in links
            if c == idea_id
        ],
        "leadsTo": [
            {"linkId": i, "conclusion": ideas[c].out()} for i, p, c in links if idea_id in p
        ],
        "sources": sources,
    }


# ───────────────────────────── the chat idea set (FR-017) ─────────────────────────────


def default_set(db: Session, user: User, course_id: str | None) -> list[str]:
    """Same-course ideas, most recently taught first, up to 30; none outside a course."""
    if course_id is None:
        return []
    return [i["id"] for i in search(db, user, None, course_id, "recent", MAX_IDEA_SET)]


def check_idea_set(db: Session, user: User, ids: list[str]) -> list[str]:
    unique = list(dict.fromkeys(ids))
    if len(unique) > MAX_IDEA_SET:
        raise ApiError(422, "too_many_ideas", "A chat can start from at most 30 ideas.")
    found = _visible(db, user, unique)
    missing = [i for i in unique if i not in found]
    if missing:
        raise ApiError(422, "unknown_idea", "One of these ideas doesn't exist any more.")
    return unique


def prompt_ideas(
    db: Session, user: User, ids: list[str]
) -> tuple[list[IdeaText], list[tuple[list[str], str]]]:
    """The idea set as the teacher reads it; deleted ideas are skipped."""
    found = _visible(db, user, ids)
    ideas = [IdeaText(i, found[i].row.name, found[i].row.statement) for i in ids if i in found]
    links = [(p, c) for _i, p, c in _links(db, user, set(found))]
    return ideas, links


# ───────────────────────────── merging an extraction (R9) ─────────────────────────────


def _clean(value: Any, limit: int) -> str | None:
    if not isinstance(value, str):
        return None
    text = " ".join(value.split())
    return text[:limit] if text else None


def merge(
    db: Session,
    user: User,
    chat: Chat,
    extraction: dict[str, Any],
    message_ids: list[str],
) -> int:
    """Add the extracted ideas and links with this chat as their source. Returns how many ideas
    it touched. Never rewrites an existing idea's statement."""
    folder = db.get(SessionFolder, chat.session_folder_id)
    course_id = folder.course_id if folder is not None else None
    stamp = now_iso()
    fallback = message_ids[-1] if message_ids else None
    by_norm = {
        row.norm_name: row for row in db.scalars(select(KgIdea).where(KgIdea.user_id == user.id))
    }
    by_id = {row.id: row for row in by_norm.values()}
    keys: dict[str, str] = {}
    for item in extraction.get("ideas") or []:
        if not isinstance(item, dict):
            continue
        name = _clean(item.get("name"), MAX_NAME)
        statement = _clean(item.get("statement"), MAX_STATEMENT)
        key = item.get("key")
        if not name or not statement or not isinstance(key, str):
            continue
        norm = normalize(name)
        existing = by_id.get(item.get("existingId") or "") or by_norm.get(norm)
        if existing is None:
            existing = KgIdea(
                id=new_id(), user_id=user.id, name=name, norm_name=norm, statement=statement
            )
            db.add(existing)
            by_norm[norm], by_id[existing.id] = existing, existing
        existing.updated_at = stamp
        keys[key] = existing.id
        message = item.get("message") if item.get("message") in message_ids else fallback
        _source(db, user, chat, course_id, message, idea_id=existing.id)
    db.flush()
    for item in extraction.get("links") or []:
        if not isinstance(item, dict) or not isinstance(item.get("premises"), list):
            continue
        conclusion = keys.get(item.get("conclusion") or "")
        premises = sorted({keys[p] for p in item["premises"] if isinstance(p, str) and p in keys})
        if conclusion is None or not premises or conclusion in premises:
            continue
        signature = hashlib.sha256(f"{','.join(premises)}->{conclusion}".encode()).hexdigest()
        link = db.scalar(
            select(KgLink).where(KgLink.user_id == user.id, KgLink.signature == signature)
        )
        if link is None:
            link = KgLink(
                id=new_id(), user_id=user.id, conclusion_id=conclusion, signature=signature
            )
            db.add(link)
            db.flush()
            db.add_all(KgLinkPremise(link_id=link.id, idea_id=p) for p in premises)
        _source(db, user, chat, course_id, fallback, link_id=link.id)
    db.flush()
    return len(keys)


def _source(
    db: Session,
    user: User,
    chat: Chat,
    course_id: str | None,
    message_id: str | None,
    idea_id: str | None = None,
    link_id: str | None = None,
) -> None:
    exists = db.scalar(
        select(func.count())
        .select_from(KgSource)
        .where(
            KgSource.idea_id.is_not_distinct_from(idea_id),
            KgSource.link_id.is_not_distinct_from(link_id),
            KgSource.chat_id == chat.id,
            KgSource.message_id.is_not_distinct_from(message_id),
        )
    )
    if not exists:
        db.add(
            KgSource(
                user_id=user.id,
                idea_id=idea_id,
                link_id=link_id,
                chat_id=chat.id,
                course_id=course_id,
                message_id=message_id,
            )
        )


# ───────────────────────────── deleting and pruning ─────────────────────────────


def _drop_ideas(db: Session, idea_ids: set[str]) -> None:
    """Delete ideas and every link they are a premise or the conclusion of (FR-034)."""
    if not idea_ids:
        return
    link_ids = set(
        db.scalars(select(KgLinkPremise.link_id).where(KgLinkPremise.idea_id.in_(idea_ids)))
    ) | set(db.scalars(select(KgLink.id).where(KgLink.conclusion_id.in_(idea_ids))))
    if link_ids:
        db.execute(delete(KgLink).where(KgLink.id.in_(link_ids)))
    db.execute(delete(KgIdea).where(KgIdea.id.in_(idea_ids)))


def delete_idea(db: Session, user: User, idea_id: str) -> None:
    row = db.get(KgIdea, idea_id)
    if row is None or row.user_id != user.id:
        raise ApiError(404, "not_found", "This idea doesn't exist.")
    _drop_ideas(db, {idea_id})
    prune(db)


def prune(db: Session) -> int:
    """Remove ideas and links left without any source (after chats were hard-deleted)."""
    sourced_ideas = select(KgSource.idea_id).where(KgSource.idea_id.is_not(None))
    orphans = set(db.scalars(select(KgIdea.id).where(KgIdea.id.not_in(sourced_ideas))))
    _drop_ideas(db, orphans)
    sourced_links = select(KgSource.link_id).where(KgSource.link_id.is_not(None))
    db.execute(delete(KgLink).where(KgLink.id.not_in(sourced_links)))
    db.flush()
    return len(orphans)


def impact_of_chats(db: Session, user: User, chat_ids: set[str]) -> int:
    """Ideas whose every visible source belongs to these chats (FR-035 confirmation)."""
    if not chat_ids:
        return 0
    counts: dict[str, list[bool]] = defaultdict(list)
    for idea_id, chat_id in db.execute(
        select(KgSource.idea_id, KgSource.chat_id).where(
            KgSource.user_id == user.id,
            KgSource.idea_id.is_not(None),
            KgSource.chat_id.in_(_live_chats()),
        )
    ):
        if idea_id is not None:
            counts[idea_id].append(chat_id in chat_ids)
    return sum(1 for flags in counts.values() if flags and all(flags))
