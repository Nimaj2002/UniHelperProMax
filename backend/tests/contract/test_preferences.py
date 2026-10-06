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
        "playerVolume": 1.0,
        "playerMuted": False,
        "theme": "system",
    }
    check(r.json(), "Preferences", spec="002")
    r = c.patch(f"{API}/preferences", json={"editorMode": "raw"})
    assert r.json()["editorMode"] == "raw" and r.json()["workspaceLeftCollapsed"] is False
    c.patch(f"{API}/preferences", json={"workspaceRightCollapsed": True})
    prefs = c.get(f"{API}/preferences").json()
    assert (prefs["editorMode"], prefs["workspaceRightCollapsed"]) == ("raw", True)
    # player preferences (feature 003)
    r = c.patch(f"{API}/preferences", json={"playerVolume": 0.4, "playerMuted": True})
    assert (r.json()["playerVolume"], r.json()["playerMuted"]) == (0.4, True)
    check(r.json(), "Preferences", spec="002")
    assert c.patch(f"{API}/preferences", json={"playerVolume": 1.5}).status_code == 422
    assert c.patch(f"{API}/preferences", json={"theme": "pink"}).status_code == 422  # unknown theme
    for choice in ("light", "dark", "system"):
        assert c.patch(f"{API}/preferences", json={"theme": choice}).json()["theme"] == choice
    assert c.patch(f"{API}/preferences", json={"editorMode": "wysiwyg"}).status_code == 422
