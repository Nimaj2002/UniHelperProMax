"""Helpers for 006 import tests."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient

from tests.contract.notes_helpers import API, make_session

__all__ = ["API", "make_session", "import_audio", "audios_dir", "uploads_dir"]


def import_audio(
    c: TestClient,
    key: str,
    file_name: str,
    data: bytes,
    duration_ms: int | None = None,
    headers: dict[str, str] | None = None,
) -> Any:
    params: dict[str, Any] = {"fileName": file_name}
    if duration_ms is not None:
        params["durationMs"] = duration_ms
    return c.post(
        f"{API}/sessions/{key}/recordings/import",
        params=params,
        content=data,
        headers={"Content-Type": "application/octet-stream", **(headers or {})},
    )


def audios_dir(data_dir: Path, date: str = "2026-09-28") -> Path:
    return data_dir / "files/owner/2026/Fall 2026/CS 201" / date / "audios"


def uploads_dir(data_dir: Path) -> Path:
    return data_dir / "files/.uploads"


def staged_files(data_dir: Path) -> list[Path]:
    d = uploads_dir(data_dir)
    return sorted(d.glob("*")) if d.exists() else []
