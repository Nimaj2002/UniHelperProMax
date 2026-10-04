"""Constitution VI guard: the live API and the documented contract list the same operations.
(The companion check that every operation is exercised runs in conftest.pytest_sessionfinish.)"""

from __future__ import annotations

import re
from typing import Any

import pytest

from tests.contract.openapi_check import contract_operations

pytestmark = pytest.mark.contract


def _norm(op: str) -> str:
    method, path = op.split(" ", 1)
    return f"{method} {re.sub(r'\{[^}]+\}', '{}', path)}"


def test_live_api_matches_contract(app: Any) -> None:
    live = {
        _norm(f"{m.upper()} {p.removeprefix('/api/v1')}")
        for p, item in app.openapi()["paths"].items()
        for m in item
    }
    documented = {_norm(op) for op in contract_operations()}
    assert sorted(live - documented) == [], "live operations missing from contracts/openapi.yaml"
    assert sorted(documented - live) == [], "documented operations not implemented"
