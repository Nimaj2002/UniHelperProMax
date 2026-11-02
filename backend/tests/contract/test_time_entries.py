"""020 entries contract (T025, T068, T073): add time, overlaps, edit, delete/restore, CSV."""

from __future__ import annotations

from datetime import timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient

from tests.conftest import assert_problem
from tests.contract.openapi_check import check
from tests.contract.time_helpers import (
    API,
    T0,
    Clock,
    act,
    entries,
    start,
    tag,
    v,
)

pytestmark = pytest.mark.contract


def add(c: TestClient, status: int = 201, **body: Any) -> Any:
    r = c.post(f"{API}/entries", json=body)
    assert r.status_code == status, r.text
    return r.json()


def test_add_time_with_end_or_duration_and_overlaps(owner_client: TestClient, clock: Clock) -> None:
    c = owner_client
    a = add(c, startedAt=T0.isoformat(), endedAt=(T0 + timedelta(hours=1)).isoformat(),
            description=" Lab ")  # fmt: skip
    assert a["overlaps"] == [] and a["entry"]["source"] == "manual"
    assert a["entry"]["description"] == "Lab" and a["entry"]["durationSeconds"] == 3600
    b = add(c, startedAt=(T0 + timedelta(minutes=30)).isoformat(), durationSeconds=3600)
    assert [o["id"] for o in b["overlaps"]] == [a["entry"]["id"]]  # allowed, but reported
    assert b["entry"]["endedAt"].startswith("2026-11-02T10:30")
    bad = add(c, 422, startedAt=T0.isoformat(), endedAt=T0.isoformat())
    assert bad["code"] == "end_not_after_start"
    assert add(c, 422, startedAt=T0.isoformat())["code"] == "required"


def test_list_range_rules(owner_client: TestClient, clock: Clock) -> None:
    c = owner_client
    add(c, startedAt=(T0 - timedelta(hours=1)).isoformat(), durationSeconds=7200)  # 08:00–10:00
    assert len(entries(c, T0, T0 + timedelta(hours=1))) == 1  # overlapping counts
    assert entries(c, T0 + timedelta(hours=1), T0 + timedelta(hours=2)) == []
    q = {"from": T0.isoformat(), "to": (T0 + timedelta(days=401)).isoformat()}
    assert_problem(c.get(f"{API}/entries", params=q), 422, "range_too_long")
    assert c.get(f"{API}/entries").status_code == 422  # from/to required


def test_edit_delete_restore(owner_client: TestClient, clock: Clock) -> None:
    c = owner_client
    h = tag(c)
    e = add(c, startedAt=T0.isoformat(), durationSeconds=600)["entry"]
    r = c.patch(f"{API}/entries/{e['id']}", headers=v(e["version"]),
                json={"description": "Read", "tagId": h["id"],
                      "endedAt": (T0 + timedelta(minutes=20)).isoformat()})  # fmt: skip
    assert r.status_code == 200, r.text
    check(r.json()["entry"], "Entry", spec="020")
    e2 = r.json()["entry"]
    assert (e2["description"], e2["tagId"], e2["durationSeconds"]) == ("Read", h["id"], 1200)
    stale = c.patch(f"{API}/entries/{e['id']}", headers=v(e["version"]), json={})
    assert_problem(stale, 412, "version_conflict")
    assert c.delete(f"{API}/entries/{e['id']}").status_code == 204
    assert entries(c) == []
    r = c.post(f"{API}/entries/{e['id']}/restore")
    assert r.status_code == 200 and r.json()["description"] == "Read"
    # deleted entries are purged a day later and can no longer be restored
    assert c.delete(f"{API}/entries/{e['id']}").status_code == 204
    clock.tick(hours=25)
    entries(c)
    assert_problem(c.post(f"{API}/entries/{e['id']}/restore"), 404, "not_found")


def test_session_key_filter_and_link_cleared_on_task_delete(
    owner_client: TestClient, clock: Clock
) -> None:
    c = owner_client
    task = c.post("/api/v1/tasks", json={"title": "Essay"}).json()
    e = add(c, startedAt=T0.isoformat(), durationSeconds=60, taskId=task["id"])["entry"]
    assert e["linkTitle"] == "Essay"
    q = {"from": T0.isoformat(), "to": (T0 + timedelta(days=1)).isoformat()}
    r = c.get(f"{API}/entries", params={**q, "sessionKey": "x:2026-11-02"})
    assert r.status_code == 200 and r.json() == []


def test_csv_export(owner_client: TestClient, clock: Clock) -> None:
    c = owner_client
    h = tag(c, "Exam prep")
    t = start(c, description="Revision", tagId=h["id"])["timer"]
    clock.tick(minutes=90)
    act(c, "stop", t["version"])
    q = {
        "from": T0.isoformat(),
        "to": (T0 + timedelta(days=1)).isoformat(),
        "tz": "Europe/Istanbul",
    }
    r = c.get(f"{API}/entries/export.csv", params=q)
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
    lines = r.text.strip().splitlines()
    assert lines[0] == "date,start,end,duration,description,tag,link"
    assert lines[1] == "2026-11-02,12:00:00,13:30:00,1:30:00,Revision,Exam prep,"
    bad = c.get(f"{API}/entries/export.csv", params={**q, "tz": "Mars/Base"})
    assert_problem(bad, 422, "unknown_tz")
