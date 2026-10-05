from __future__ import annotations

from typing import Any

from fastapi.testclient import TestClient

from tests.contract.notes_helpers import API, make_session

__all__ = ["API", "make_session", "start", "put_chunk", "stop", "upload_all"]


def start(c: TestClient, key: str, mime: str = "audio/webm") -> dict[str, Any]:
    r = c.post(f"{API}/sessions/{key}/recordings", json={"mimeType": mime})
    assert r.status_code == 201, r.text
    return r.json()  # type: ignore[no-any-return]


def put_chunk(c: TestClient, rec_id: str, seq: int, data: bytes) -> Any:
    return c.put(
        f"{API}/recordings/{rec_id}/chunks/{seq}",
        content=data,
        headers={"Content-Type": "application/octet-stream"},
    )


def stop(c: TestClient, rec_id: str, **body: Any) -> Any:
    return c.post(f"{API}/recordings/{rec_id}/stop", json=body)


def upload_all(c: TestClient, rec_id: str, parts: list[bytes]) -> None:
    for i, p in enumerate(parts):
        r = put_chunk(c, rec_id, i, p)
        assert r.status_code == 200, r.text
