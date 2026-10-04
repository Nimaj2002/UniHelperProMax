"""FR-002 / FR-003c: one user's ids are 'not found' (404, never 403) for everyone else."""

from __future__ import annotations

import re
from collections.abc import Callable
from typing import Any

import pytest
from fastapi.testclient import TestClient

from tests.conftest import assert_problem
from tests.contract.test_classes_sessions_read import new_class_body

pytestmark = pytest.mark.integration
API = "/api/v1"


def _ids(c: TestClient) -> dict[str, Any]:
    cls = c.post(f"{API}/classes", json=new_class_body()).json()
    tree = c.get(f"{API}/course-tree").json()
    year = tree[0]["year"]
    sem = tree[0]["semesters"][0]["semester"]
    course = tree[0]["semesters"][0]["courses"][0]
    key = c.get(f"{API}/sessions", params={"from": "2026-09-28", "to": "2026-09-28"}).json()[0][
        "key"
    ]
    return {
        "year": year,
        "semester": sem,
        "course": course,
        "lineage": cls["lineageId"],
        "key": key,
    }


def foreign_requests(
    ids: dict[str, Any],
) -> list[tuple[str, str, dict[str, Any] | None, dict[str, str] | None]]:
    y, s, co = ids["year"], ids["semester"], ids["course"]
    v = {"If-Match": '"1"'}
    return [
        ("GET", f"/semesters?yearId={y['id']}", None, None),
        ("POST", "/semesters", {"yearId": y["id"], "name": "X"}, None),
        ("GET", f"/courses?semesterId={s['id']}", None, None),
        ("POST", "/courses", {"semesterId": s["id"], "name": "X"}, None),
        ("GET", f"/courses/{co['id']}", None, None),
        ("POST", "/classes", {**new_class_body(), "course": {"id": co["id"]}}, None),
        ("GET", f"/classes/{ids['lineage']}", None, None),
        ("GET", f"/sessions/{ids['key']}", None, None),
        ("PATCH", f"/years/{y['id']}", {"name": "Hijack"}, v),
        ("DELETE", f"/years/{y['id']}", None, v),
        ("GET", f"/years/{y['id']}/deletion-impact", None, None),
        ("PATCH", f"/semesters/{s['id']}", {"name": "Hijack"}, v),
        ("DELETE", f"/semesters/{s['id']}", None, v),
        ("GET", f"/semesters/{s['id']}/deletion-impact", None, None),
        ("PATCH", f"/courses/{co['id']}", {"name": "Hijack"}, v),
        ("DELETE", f"/courses/{co['id']}", None, v),
        ("GET", f"/courses/{co['id']}/deletion-impact", None, None),
        ("PATCH", f"/sessions/{ids['key']}?scope=all", {"location": "Hijack"}, v),
        ("DELETE", f"/sessions/{ids['key']}?scope=all", None, v),
    ]


def _live_patterns(app: Any) -> list[tuple[str, re.Pattern[str]]]:
    """(METHOD, path regex) for routes the live app serves. Unimplemented routes are skipped so
    a routing 404 can never be mistaken for an ownership 404."""
    out = []
    for path, item in app.openapi()["paths"].items():
        rx = re.compile("^" + re.sub(r"\{[^}]+\}", "[^/]+", path.removeprefix(API)) + "$")
        out.extend((m.upper(), rx) for m in item)
    return out


def _served(live: list[tuple[str, re.Pattern[str]]], method: str, path: str) -> bool:
    bare = path.split("?")[0]
    return any(m == method and rx.match(bare) for m, rx in live)


def test_isolation_both_ways(
    owner_client: TestClient, app: Any, make_member: Callable[..., TestClient]
) -> None:
    live = _live_patterns(app)
    member = make_member()
    owner_ids = _ids(owner_client)
    member_ids = _ids(member)
    for actor, ids in ((member, owner_ids), (owner_client, member_ids)):
        for method, path, body, headers in foreign_requests(ids):
            if not _served(live, method, path):
                continue
            r = actor.request(method, f"{API}{path}", json=body, headers=headers)
            assert_problem(r, 404, "not_found")
    # each sees only their own data
    for actor, ids in ((owner_client, owner_ids), (member, member_ids)):
        tree = actor.get(f"{API}/course-tree").json()
        assert [n["year"]["id"] for n in tree] == [ids["year"]["id"]]
        sessions = actor.get(
            f"{API}/sessions", params={"from": "2026-09-01", "to": "2026-12-31"}
        ).json()
        assert {s["lineageId"] for s in sessions} == {ids["lineage"]}
    # foreign ids inside a reorder are refused without revealing them
    if not _served(live, "PUT", "/years/order"):
        return
    r = member.put(
        f"{API}/years/order", json={"yearIds": [member_ids["year"]["id"], owner_ids["year"]["id"]]}
    )
    assert_problem(r, 409, "order_mismatch")
