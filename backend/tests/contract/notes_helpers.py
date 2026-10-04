from __future__ import annotations

from typing import Any

from fastapi.testclient import TestClient

from tests.contract.test_classes_sessions_read import new_class_body

API = "/api/v1"


def make_session(c: TestClient, **kw: Any) -> str:
    """Create CS 201 (Mon+Wed, 10:00) and return the key of Monday 28 Sep 2026."""
    cls = c.post(f"{API}/classes", json=new_class_body(**kw)).json()
    return f"{cls['lineageId']}:2026-09-28"


def create_note(c: TestClient, key: str, name: str, content: str = "") -> dict[str, Any]:
    r = c.post(f"{API}/sessions/{key}/notes", json={"name": name, "content": content})
    assert r.status_code == 201, r.text
    return r.json()  # type: ignore[no-any-return]


def save(
    c: TestClient,
    note: dict[str, Any],
    content: str,
    version: int | None = None,
    base_hash: str | None = None,
) -> Any:
    return c.put(
        f"{API}/notes/{note['id']}/content",
        json={"content": content, "baseHash": note["hash"] if base_hash is None else base_hash},
        headers={"If-Match": f'"{version if version is not None else note["version"]}"'},
    )
