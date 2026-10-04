from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from tests.contract.notes_helpers import API
from tests.contract.openapi_check import check

pytestmark = pytest.mark.contract


def test_preferences(owner_client: TestClient) -> None:
    c = owner_client
    r = c.get(f"{API}/preferences")
    assert r.json() == {
        "editorMode": "live",
        "workspaceLeftCollapsed": False,
        "workspaceRightCollapsed": False,
    }
    check(r.json(), "Preferences", spec="002")
    r = c.patch(f"{API}/preferences", json={"editorMode": "raw"})
    assert r.json()["editorMode"] == "raw" and r.json()["workspaceLeftCollapsed"] is False
    c.patch(f"{API}/preferences", json={"workspaceRightCollapsed": True})
    assert c.get(f"{API}/preferences").json() == {
        "editorMode": "raw",
        "workspaceLeftCollapsed": False,
        "workspaceRightCollapsed": True,
    }
    assert c.patch(f"{API}/preferences", json={"theme": "pink"}).status_code == 422
    assert c.patch(f"{API}/preferences", json={"editorMode": "wysiwyg"}).status_code == 422
