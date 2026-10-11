"""Helpers for 010 calendar import/export tests: uploads, default plans and seeded semesters."""

from __future__ import annotations

from typing import Any

from fastapi.testclient import TestClient
from httpx import Response

from tests.contract.notes_helpers import API
from tests.fixtures.ics.make_large import fixture

__all__ = ["API", "apply", "default_plan", "group", "seed_semester", "upload_ics", "upload_bytes"]


def upload_bytes(c: TestClient, data: bytes, name: str = "calendar.ics") -> Response:
    return c.post(
        f"{API}/calendar-imports",
        params={"fileName": name},
        content=data,
        headers={"Content-Type": "text/calendar"},
    )


def upload_ics(c: TestClient, name: str) -> Response:
    """POST a fixture from tests/fixtures/ics/."""
    return upload_bytes(c, fixture(name), name)


def preview_of(c: TestClient, name: str) -> dict[str, Any]:
    r = upload_ics(c, name)
    assert r.status_code == 201, r.text
    return r.json()  # type: ignore[no-any-return]


def group(preview: dict[str, Any], title: str) -> dict[str, Any]:
    return next(g for g in preview["groups"] if g["title"] == title)


def default_plan(
    preview: dict[str, Any], destination: dict[str, Any], **overrides: dict[str, Any]
) -> dict[str, Any]:
    """The plan the preview's defaults describe; `overrides` maps a group title to fields."""
    groups = []
    for g in preview["groups"]:
        item: dict[str, Any] = {
            "groupId": g["groupId"],
            "selected": g["defaults"]["selected"],
            "importAs": g["defaults"]["importAs"],
        }
        if g["unsupported"]:
            item["unsupported"] = "first_only"
        item.update(overrides.get(g["title"], {}))
        groups.append(item)
    return {"destination": destination, "groups": groups}


def apply(c: TestClient, upload_id: str, plan: dict[str, Any]) -> Response:
    return c.post(f"{API}/calendar-imports/{upload_id}/apply", json=plan)


def import_file(
    c: TestClient, name: str, destination: dict[str, Any], **overrides: dict[str, Any]
) -> dict[str, Any]:
    preview = preview_of(c, name)
    r = apply(c, preview["uploadId"], default_plan(preview, destination, **overrides))
    assert r.status_code == 200, r.text
    return r.json()  # type: ignore[no-any-return]


def seed_semester(
    c: TestClient,
    year: str = "2026",
    semester: str = "Fall 2026",
    courses: tuple[str, ...] = ("Linear Algebra",),
) -> dict[str, Any]:
    """A year, semester and courses (each with one class so they exist); returns their ids."""
    ids: dict[str, Any] = {"courses": {}}
    sem_ref: dict[str, Any] = {"new": {"name": semester, "year": {"new": {"name": year}}}}
    for i, name in enumerate(courses or ("Placeholder",)):
        body = {
            "course": {"new": {"name": name, "semester": sem_ref}},
            "startDate": "2026-09-07",
            "startTime": f"{8 + i:02d}:00",
            "endTime": f"{8 + i:02d}:50",
            "color": "slate",
            "recurrence": {"freq": "none"},
        }
        r = c.post(f"{API}/classes", json=body)
        assert r.status_code == 201, r.text
        lineage = r.json()["lineageId"] if "lineageId" in r.json() else r.json()["id"]
        detail = c.get(f"{API}/classes/{lineage}").json()
        course_id = detail["course"]["id"]
        ids["courses"][name] = course_id
        ids["semester"] = detail["course"]["semesterId"]
        sem_ref = {"id": ids["semester"]}
    return ids


def sessions(
    c: TestClient, start: str = "2026-09-01", end: str = "2027-03-01"
) -> list[dict[str, Any]]:
    r = c.get(f"{API}/sessions", params={"from": start, "to": end})
    assert r.status_code == 200, r.text
    return r.json()  # type: ignore[no-any-return]
