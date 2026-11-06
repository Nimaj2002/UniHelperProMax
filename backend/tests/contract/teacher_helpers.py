"""Helpers for the 022 teacher tests: scripted teacher replies, starting lessons, answering."""

from __future__ import annotations

import json
from typing import Any

from fastapi.testclient import TestClient

from tests import fake_llm
from tests.contract.chat_helpers import API, create_endpoint, events, make_session, wait_idle

__all__ = [
    "API",
    "block",
    "events",
    "lesson_setup",
    "run_graph",
    "script",
    "start",
    "wait_idle",
    "CHOICE",
    "TEXT",
]

CHOICE = {
    "kind": "choice",
    "title": "Zero determinant",
    "prompt": "If det(A) = 0, what follows?",
    "options": ["A is invertible", "A has a non-trivial null space", "A is diagonal"],
    "answer": 1,
    "explanation": "Dependent columns give a non-zero solution of Ax = 0.",
}
TEXT = {
    "kind": "text",
    "title": "Why",
    "prompt": "Explain in one sentence why.",
    "solution": "Because the columns are dependent.",
}


def block(kind: str, payload: object) -> str:
    return f"```uh-{kind}\n{json.dumps(payload)}\n```\n"


def script(*replies: str) -> None:
    """The next replies of the fake `teacher` model, in order."""
    fake_llm.STATE["script"].extend(replies)


def lesson_setup(c: TestClient) -> tuple[str, dict[str, str]]:
    """A session and a local endpoint with the `teacher` model: (session key, model ref)."""
    ep = create_endpoint(c, "openai", models=["echo", "teacher"])
    found = next(m for m in ep["models"] if m["modelId"] == "teacher")
    return make_session(c), {"endpointId": ep["id"], "modelId": found["id"]}


def start(
    c: TestClient, key: str, ref: dict[str, str], text: str = "Teach me determinants", **extra: Any
) -> dict[str, Any]:
    body = {"text": text, "model": ref, "kind": "lesson", **extra}
    r = c.post(f"{API}/sessions/{key}/teacher-chats", json=body)
    assert r.status_code == 201, r.text
    return r.json()  # type: ignore[no-any-return]


def run_graph(c: TestClient) -> int:
    """Run the knowledge-graph worker once, inside the app's event loop."""
    worker = c.app.state.graph_worker  # type: ignore[attr-defined]
    return c.portal.call(worker.run_once)  # type: ignore[union-attr,no-any-return]
