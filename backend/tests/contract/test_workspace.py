from __future__ import annotations

from collections.abc import Callable

import pytest
from fastapi.testclient import TestClient

from tests.conftest import assert_problem
from tests.contract.notes_helpers import API, create_note, make_session
from tests.contract.openapi_check import check

pytestmark = pytest.mark.contract


def test_workspace_state(owner_client: TestClient, make_member: Callable[..., TestClient]) -> None:
    c = owner_client
    key = make_session(c)
    empty = c.get(f"{API}/workspace/{key}")
    assert empty.status_code == 200 and empty.json() == {"openNoteIds": [], "activeNoteId": None}
    a, b = create_note(c, key, "A"), create_note(c, key, "B")
    r = c.put(
        f"{API}/workspace/{key}",
        json={"openNoteIds": [b["id"], a["id"], "ghost"], "activeNoteId": a["id"]},
    )
    assert r.status_code == 200
    check(r.json(), "WorkspaceState", spec="002")
    assert r.json() == {"openNoteIds": [b["id"], a["id"]], "activeNoteId": a["id"]}
    assert c.get(f"{API}/workspace/{key}").json()["openNoteIds"] == [b["id"], a["id"]]
    assert (
        c.put(
            f"{API}/workspace/{key}", json={"openNoteIds": [a["id"]], "activeNoteId": b["id"]}
        ).status_code
        == 422
    )
    assert (
        c.put(
            f"{API}/workspace/{key}", json={"openNoteIds": [f"n{i}" for i in range(51)]}
        ).status_code
        == 422
    )
    m = make_member()
    assert_problem(m.get(f"{API}/workspace/{key}"), 404, "not_found")
    assert_problem(m.put(f"{API}/workspace/{key}", json={"openNoteIds": []}), 404, "not_found")
