"""022 T074 (SC-009): a graph of 2,000 ideas and 3,000 links reads in < 300 ms and searches in
< 100 ms. Runs only with UNIHELPER_SLOW_TESTS=1."""

from __future__ import annotations

import os
import time

import pytest
from fastapi.testclient import TestClient

from tests.contract.teacher_helpers import API, lesson_setup, script, start, wait_idle
from unihelper.models import Chat, KgIdea, KgLink, KgLinkPremise, KgSource, User
from unihelper.models.base import new_id

pytestmark = [
    pytest.mark.integration,
    pytest.mark.slow,
    pytest.mark.skipif(
        not os.environ.get("UNIHELPER_SLOW_TESTS"), reason="slow: set UNIHELPER_SLOW_TESTS=1"
    ),
]


def test_big_graph_reads_fast(owner_client: TestClient) -> None:
    c = owner_client
    key, ref = lesson_setup(c)
    script("Hi.\n")
    chat_id = start(c, key, ref)["chat"]["id"]
    wait_idle(c)
    app = c.app  # type: ignore[attr-defined]
    with app.state.sessionmaker() as db:
        user = db.query(User).one()
        chat = db.get(Chat, chat_id)
        assert chat is not None
        ideas = [
            KgIdea(
                id=new_id(),
                user_id=user.id,
                name=f"Idea {i}",
                norm_name=f"idea {i}",
                statement=f"Statement number {i}.",
            )
            for i in range(2000)
        ]
        db.add_all(ideas)
        db.flush()
        db.add_all(KgSource(user_id=user.id, idea_id=i.id, chat_id=chat.id) for i in ideas)
        for n in range(3000):
            premise, conclusion = ideas[n % 2000], ideas[(n * 7 + 1) % 2000]
            if premise.id == conclusion.id:
                continue
            link = KgLink(
                id=new_id(), user_id=user.id, conclusion_id=conclusion.id, signature=f"s{n}"
            )
            db.add(link)
            db.flush()
            db.add(KgLinkPremise(link_id=link.id, idea_id=premise.id))
            db.add(KgSource(user_id=user.id, link_id=link.id, chat_id=chat.id))
        db.commit()
    c.get(f"{API}/knowledge-graph")  # warm up
    t = time.perf_counter()
    graph = c.get(f"{API}/knowledge-graph").json()
    assert time.perf_counter() - t < 0.3
    assert len(graph["ideas"]) == 2000 and len(graph["links"]) > 2900
    t = time.perf_counter()
    found = c.get(f"{API}/knowledge-graph/ideas", params={"q": "Idea 19"}).json()
    assert time.perf_counter() - t < 0.1
    assert found
