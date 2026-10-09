"""Helpers for 007 document tests."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient

from tests.contract.notes_helpers import API, make_session

__all__ = ["API", "make_session", "upload_pdf", "documents_dir"]


def upload_pdf(
    c: TestClient, key: str, file_name: str, data: bytes, headers: dict[str, str] | None = None
) -> Any:
    return c.post(
        f"{API}/sessions/{key}/documents/import",
        params={"fileName": file_name},
        content=data,
        headers={"Content-Type": "application/octet-stream", **(headers or {})},
    )


def documents_dir(data_dir: Path, date: str = "2026-09-28") -> Path:
    return data_dir / "files/owner/2026/Fall 2026/CS 201" / date / "documents"
