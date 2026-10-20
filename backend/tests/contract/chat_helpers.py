"""Helpers for the 014 chat tests: send messages, read a run's event stream, wait for runs."""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient

from tests.contract.ai_helpers import API, ack, create_endpoint, model_ref
from tests.contract.notes_helpers import make_session

__all__ = [
    "API",
    "ack",
    "create_endpoint",
    "events",
    "make_session",
    "model_ref",
    "send",
    "start_chat",
    "wait_idle",
    "chat_files",
]


def start_chat(
    c: TestClient, key: str, ref: dict[str, str], text: str = "Hello there", **extra: Any
) -> dict[str, Any]:
    r = c.post(f"{API}/sessions/{key}/chats", json={"text": text, "model": ref, **extra})
    assert r.status_code == 201, r.text
    return r.json()  # type: ignore[no-any-return]


def send(
    c: TestClient, chat_id: str, ref: dict[str, str], text: str = "And then?", **extra: Any
) -> dict[str, Any]:
    r = c.post(f"{API}/chats/{chat_id}/messages", json={"text": text, "model": ref, **extra})
    assert r.status_code == 202, r.text
    return r.json()  # type: ignore[no-any-return]


def events(
    c: TestClient, run_id: str, last_id: int | None = None
) -> list[tuple[int | None, str, dict[str, Any]]]:
    """The whole event stream of a run (it ends after the terminal event)."""
    headers = {"Last-Event-ID": str(last_id)} if last_id is not None else {}
    r = c.get(f"{API}/chat-runs/{run_id}/events", headers=headers)
    assert r.status_code == 200, r.text
    assert r.headers["content-type"].startswith("text/event-stream")
    out: list[tuple[int | None, str, dict[str, Any]]] = []
    for block in r.text.split("\n\n"):
        if not block.strip() or block.startswith(":"):
            continue
        fields = dict(line.split(": ", 1) for line in block.splitlines() if ": " in line)
        out.append(
            (
                int(fields["id"]) if "id" in fields else None,
                fields["event"],
                json.loads(fields["data"]),
            )
        )
    return out


def wait_idle(c: TestClient, timeout: float = 15.0) -> None:
    """Until no run of this user is active."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if not c.get(f"{API}/chat-runs/active").json():
            return
        time.sleep(0.05)
    raise AssertionError("runs still active")


def chat_files(tmp_data_dir: Path) -> list[Path]:
    return sorted(p for p in tmp_data_dir.rglob("chats/*") if p.is_file())
