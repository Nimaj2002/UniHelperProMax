"""Quickstart scenarios 8–9 through the API against real SQLite: scope edits keep keys stable."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from tests.contract.test_classes_sessions_read import new_class_body

pytestmark = pytest.mark.integration
API = "/api/v1"


def test_scenarios_8_and_9(owner_client: TestClient) -> None:
    c = owner_client
    body = new_class_body()
    body["course"]["new"]["semester"]["new"]["endDate"] = "2026-12-31"
    cls = c.post(f"{API}/classes", json=body).json()
    lin = cls["lineageId"]

    def all_sessions() -> dict[str, dict]:  # type: ignore[type-arg]
        r = c.get(f"{API}/sessions", params={"from": "2026-09-01", "to": "2026-12-31"})
        return {s["date"]: s for s in r.json()}

    keys_before = {d: s["key"] for d, s in all_sessions().items()}

    # 8a: one Wednesday changes room ("this session")
    c.patch(
        f"{API}/sessions/{lin}:2026-09-30",
        params={"scope": "this"},
        json={"location": "Room B"},
        headers={"If-Match": f'"{cls["version"]}"'},
    )
    # 8b: from 12 Oct on, the class moves to 11:00 ("this and following")
    v = all_sessions()["2026-10-12"]["seriesVersion"]
    c.patch(
        f"{API}/sessions/{lin}:2026-10-12",
        params={"scope": "following"},
        json={"startTime": "11:00", "endTime": "12:30"},
        headers={"If-Match": f'"{v}"'},
    )
    # 8c: colour green for "all sessions" — the single-session room change is preserved
    v = all_sessions()["2026-10-05"]["seriesVersion"]
    r = c.patch(
        f"{API}/sessions/{lin}:2026-10-05",
        params={"scope": "all"},
        json={"color": "green"},
        headers={"If-Match": f'"{v}"'},
    )
    assert r.json()["preservedOverrides"] == 1

    s = all_sessions()
    assert s["2026-09-30"]["location"] == "Room B"
    assert {d: x["location"] for d, x in s.items() if d != "2026-09-30"} == {
        d: "FENS G032" for d in s if d != "2026-09-30"
    }
    assert all(x["start"][11:16] == "10:00" for d, x in s.items() if d < "2026-10-12")
    assert all(x["start"][11:16] == "11:00" for d, x in s.items() if d >= "2026-10-12")
    assert {x["color"] for x in s.values()} == {"green"}

    # 9: cancel one Monday
    v = s["2026-10-19"]["seriesVersion"]
    c.delete(
        f"{API}/sessions/{lin}:2026-10-19", params={"scope": "this"}, headers={"If-Match": f'"{v}"'}
    )
    after = all_sessions()
    assert set(keys_before) - set(after) == {"2026-10-19"}
    # session keys are stable across every operation
    assert {d: after[d]["key"] for d in after} == {d: keys_before[d] for d in after}
