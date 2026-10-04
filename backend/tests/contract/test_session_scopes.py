from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient

from tests.conftest import assert_problem
from tests.contract.openapi_check import check
from tests.contract.test_classes_sessions_read import new_class_body

pytestmark = pytest.mark.contract
API = "/api/v1"


def setup(c: TestClient) -> dict[str, Any]:
    body = new_class_body()
    body["course"]["new"]["semester"]["new"]["endDate"] = "2026-12-31"
    cls = c.post(f"{API}/classes", json=body).json()
    return cls


def sessions(c: TestClient, a: str = "2026-09-28", b: str = "2026-10-31") -> list[dict[str, Any]]:
    return c.get(f"{API}/sessions", params={"from": a, "to": b}).json()  # type: ignore[no-any-return]


def key(lineage: str, d: str) -> str:
    return f"{lineage}:{d}"


def im(v: int) -> dict[str, str]:
    return {"If-Match": f'"{v}"'}


def test_patch_this_and_errors(owner_client: TestClient) -> None:
    c = owner_client
    cls = setup(c)
    k = key(cls["lineageId"], "2026-09-30")
    r = c.patch(
        f"{API}/sessions/{k}",
        params={"scope": "this"},
        json={"location": "Room B"},
        headers=im(cls["version"]),
    )
    assert r.status_code == 200, r.text
    check(r.json(), "ScopeResult")
    s = c.get(f"{API}/sessions/{k}").json()
    assert s["location"] == "Room B" and s["isException"] is True and s["exceptionVersion"] == 1
    # a second "this" edit must send the exception's version
    assert_problem(
        c.patch(
            f"{API}/sessions/{k}", params={"scope": "this"}, json={"location": "C"}, headers=im(99)
        ),
        412,
        "version_conflict",
    )
    assert (
        c.patch(
            f"{API}/sessions/{k}", params={"scope": "this"}, json={"location": "C"}, headers=im(1)
        ).status_code
        == 200
    )
    assert_problem(
        c.patch(
            f"{API}/sessions/{k}", params={"scope": "this"}, json={"color": "red"}, headers=im(2)
        ),
        422,
        "field_not_allowed",
    )
    assert_problem(
        c.patch(f"{API}/sessions/{k}", params={"scope": "this"}, json={"location": "x"}),
        428,
        "if_match_required",
    )
    assert_problem(
        c.patch(f"{API}/sessions/{k}", json={"location": "x"}, headers=im(1)),
        422,
        "validation_failed",
    )
    assert_problem(
        c.patch(
            f"{API}/sessions/{k}", params={"scope": "nope"}, json={"location": "x"}, headers=im(1)
        ),
        422,
        "validation_failed",
    )
    assert_problem(
        c.patch(
            f"{API}/sessions/garbage",
            params={"scope": "all"},
            json={"location": "x"},
            headers=im(1),
        ),
        404,
        "not_found",
    )


def test_patch_following_and_all(owner_client: TestClient) -> None:
    c = owner_client
    cls = setup(c)
    lin = cls["lineageId"]
    r = c.patch(
        f"{API}/sessions/{key(lin, '2026-10-12')}",
        params={"scope": "following"},
        json={"startTime": "11:00", "endTime": "12:30"},
        headers=im(cls["version"]),
    )
    assert r.status_code == 200
    assert len(r.json()["affectedSeriesIds"]) == 2  # truncated + new segment
    detail = c.get(f"{API}/classes/{lin}").json()
    check(detail, "ClassDetail")
    assert len(detail["segments"]) == 2
    by_date = {s["date"]: s for s in sessions(c)}
    assert by_date["2026-10-07"]["start"].startswith("2026-10-07T10:00")
    assert by_date["2026-10-12"]["start"].startswith("2026-10-12T11:00")
    # stale version of the original segment (bumped by the split)
    assert_problem(
        c.patch(
            f"{API}/sessions/{key(lin, '2026-10-05')}",
            params={"scope": "all"},
            json={"color": "green"},
            headers=im(cls["version"]),
        ),
        412,
        "version_conflict",
    )
    seg_v = by_date["2026-10-05"]["seriesVersion"]
    r = c.patch(
        f"{API}/sessions/{key(lin, '2026-10-05')}",
        params={"scope": "all"},
        json={"color": "green"},
        headers=im(seg_v),
    )
    assert r.status_code == 200
    assert {s["color"] for s in sessions(c)} == {"green"}


def test_delete_scopes(owner_client: TestClient) -> None:
    c = owner_client
    cls = setup(c)
    lin = cls["lineageId"]
    r = c.delete(
        f"{API}/sessions/{key(lin, '2026-10-05')}",
        params={"scope": "this"},
        headers=im(cls["version"]),
    )
    assert r.status_code == 200
    check(r.json(), "ScopeResult")
    assert "2026-10-05" not in {s["date"] for s in sessions(c)}
    assert_problem(c.get(f"{API}/sessions/{key(lin, '2026-10-05')}"), 404, "not_found")
    assert c.get(f"{API}/classes/{lin}").json()["exceptionCount"] == 1
    v = sessions(c)[0]["seriesVersion"]
    r = c.delete(
        f"{API}/sessions/{key(lin, '2026-10-19')}", params={"scope": "following"}, headers=im(v)
    )
    assert r.status_code == 200
    assert max(s["date"] for s in sessions(c, b="2026-12-31")) == "2026-10-14"
    v = sessions(c)[0]["seriesVersion"]
    assert (
        c.delete(
            f"{API}/sessions/{key(lin, '2026-09-28')}", params={"scope": "all"}, headers=im(v)
        ).status_code
        == 200
    )
    assert sessions(c, b="2026-12-31") == []
    assert_problem(c.get(f"{API}/classes/{lin}"), 404, "not_found")
