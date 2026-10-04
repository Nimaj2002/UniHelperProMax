from __future__ import annotations

import time

import pytest
from fastapi.testclient import TestClient

from tests.contract.notes_helpers import API
from tests.contract.test_classes_sessions_read import new_class_body

pytestmark = pytest.mark.integration


def test_300_sessions_under_200ms(owner_client: TestClient) -> None:
    c = owner_client
    body = new_class_body(
        recurrence={
            "freq": "weekly",
            "byWeekday": ["MO", "TU", "WE", "TH", "FR"],
            "end": {"kind": "count", "count": 300},
        }
    )
    course = c.post(f"{API}/classes", json=body).json()["courseId"]
    best = 1e9
    for _ in range(5):
        t0 = time.perf_counter()
        r = c.get(f"{API}/courses/{course}/timeline")
        best = min(best, time.perf_counter() - t0)
    assert len(r.json()["entries"]) == 300
    assert best < 0.200, f"timeline took {best * 1000:.0f} ms"
