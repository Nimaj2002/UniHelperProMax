"""Shared helpers for the 020 time tracking tests: a controllable server clock and API calls."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi.testclient import TestClient

from tests.contract.openapi_check import check

API = "/api/v1/time"
T0 = datetime(2026, 11, 2, 9, 0, tzinfo=UTC)


class Clock:
    def __init__(self) -> None:
        self.now = T0

    def tick(self, **kw: float) -> datetime:
        self.now += timedelta(**kw)
        return self.now


def v(n: int) -> dict[str, str]:
    return {"If-Match": f'"{n}"'}


def timer_call(c: TestClient, method: str, path: str = "", status: int = 200, **kw: Any) -> Any:
    r = c.request(method, f"{API}/timer{path}", **kw)
    assert r.status_code == status, r.text
    if status < 300:
        check(r.json(), "TimerResponse", spec="020")
    return r.json()


def start(c: TestClient, style: str = "track", **body: Any) -> Any:
    return timer_call(c, "POST", "/start", 201, json={"style": style, **body})


def act(c: TestClient, action: str, version: int, status: int = 200, **body: Any) -> Any:
    return timer_call(c, "POST", f"/{action}", status, json=body or None, headers=v(version))


def entries(c: TestClient, start: datetime | None = None, end: datetime | None = None) -> Any:
    params = {"from": (start or T0 - timedelta(days=1)).isoformat(),
              "to": (end or T0 + timedelta(days=2)).isoformat()}  # fmt: skip
    r = c.get(f"{API}/entries", params=params)
    assert r.status_code == 200, r.text
    check(r.json(), "Entry", many=True, spec="020")
    return r.json()


def tag(c: TestClient, name: str = "Homework", color: str = "tag-1") -> Any:
    r = c.post(f"{API}/tags", json={"name": name, "color": color})
    assert r.status_code == 201, r.text
    return r.json()
