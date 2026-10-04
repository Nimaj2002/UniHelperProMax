"""SC-003 backend budget: sessions for a full semester are expanded quickly."""

from __future__ import annotations

import time

import pytest
from fastapi.testclient import TestClient

from tests.contract.test_classes_sessions_read import new_class_body

pytestmark = pytest.mark.integration
API = "/api/v1"
DAYS = [
    ["MO", "WE", "FR"],
    ["TU", "TH", "FR"],
    ["MO", "TU", "TH"],
    ["WE", "TH", "FR"],
    ["MO", "WE", "TH"],
    ["TU", "WE", "FR"],
]


def best_of(c: TestClient, params: dict[str, str], n: int = 5) -> float:
    times = []
    for _ in range(n):
        t0 = time.perf_counter()
        r = c.get(f"{API}/sessions", params=params)
        times.append(time.perf_counter() - t0)
        assert r.status_code == 200
    return min(times)


def test_sessions_endpoint_budget(owner_client: TestClient) -> None:
    c = owner_client
    for i, days in enumerate(DAYS):
        body = new_class_body(
            course={
                "new": {
                    "name": f"C{i}",
                    "semester": {
                        "new": {
                            "name": "Fall",
                            "endDate": "2027-01-15",
                            "year": {"new": {"name": "2026"}},
                        }
                    },
                }
            },
            startTime=f"{8 + i:02d}:00",
            endTime=f"{8 + i:02d}:50",
            recurrence={"freq": "weekly", "byWeekday": days, "end": {"kind": "semester_end"}},
        )
        assert c.post(f"{API}/classes", json=body).status_code == 201
    six_weeks = best_of(c, {"from": "2026-10-05", "to": "2026-11-15"})
    year = best_of(c, {"from": "2026-01-01", "to": "2027-02-04"})
    assert six_weeks < 0.150, f"6-week range took {six_weeks * 1000:.0f} ms"
    assert year < 0.500, f"400-day range took {year * 1000:.0f} ms"
