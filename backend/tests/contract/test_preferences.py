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
        "readerDarkPages": False,  # 007
        "lastSemesterId": None,  # 009
        "quickCreateType": "class",  # 009
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
    for bad in ("preset:", "preset:Dracula", "preset:../x", "preset:a--b"):
        assert c.patch(f"{API}/preferences", json={"theme": bad}).status_code == 422, bad
    r = c.patch(f"{API}/preferences", json={"readerDarkPages": True})  # 007 FR-022a
    assert (
        r.json()["readerDarkPages"] is True
        and c.get(f"{API}/preferences").json()["readerDarkPages"]
    )
    for choice in ("light", "dark", "system", "preset:rose-pine-dawn", "preset:dracula"):
        assert c.patch(f"{API}/preferences", json={"theme": choice}).json()["theme"] == choice
    assert c.patch(f"{API}/preferences", json={"editorMode": "wysiwyg"}).status_code == 422


def test_preferences_009_last_semester_and_quick_create_type(owner_client: TestClient) -> None:
    c = owner_client
    r = c.patch(f"{API}/preferences", json={"lastSemesterId": "sem-1", "quickCreateType": "event"})
    assert r.status_code == 200, r.text
    check(r.json(), "Preferences", spec="002")
    check(r.json(), "PreferencesAddition", spec="009")
    assert (r.json()["lastSemesterId"], r.json()["quickCreateType"]) == ("sem-1", "event")
    # other changes keep them; an explicit null clears the semester only
    r = c.patch(f"{API}/preferences", json={"editorMode": "raw"})
    assert (r.json()["lastSemesterId"], r.json()["quickCreateType"]) == ("sem-1", "event")
    r = c.patch(f"{API}/preferences", json={"lastSemesterId": None, "quickCreateType": None})
    assert (r.json()["lastSemesterId"], r.json()["quickCreateType"]) == (None, "event")
    prefs = c.get(f"{API}/preferences").json()
    assert (prefs["lastSemesterId"], prefs["quickCreateType"]) == (None, "event")
    assert c.patch(f"{API}/preferences", json={"quickCreateType": "task"}).status_code == 422
    assert c.patch(f"{API}/preferences", json={"lastSemesterId": ""}).status_code == 422
