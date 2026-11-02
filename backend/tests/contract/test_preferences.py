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
        "recordingBarStyle": "full",
        "generalNotesCollapsed": False,  # 018
        "shortcuts": {},  # 019
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


def test_preferences_recording_bar_style(owner_client: TestClient) -> None:
    c = owner_client
    r = c.patch(f"{API}/preferences", json={"recordingBarStyle": "minimal"})
    assert r.json()["recordingBarStyle"] == "minimal"
    assert c.get(f"{API}/preferences").json()["recordingBarStyle"] == "minimal"
    assert c.patch(f"{API}/preferences", json={"recordingBarStyle": "huge"}).status_code == 422


NEW_NOTE = {"chord": "Alt+Shift+KeyM", "label": "Alt+Shift+M"}


def _codes(r: object) -> set[str]:
    return {e["code"] for e in r.json()["errors"]}  # type: ignore[attr-defined]


def test_preferences_019_shortcuts(owner_client: TestClient) -> None:
    c = owner_client
    first = {"workspace.newNote": [NEW_NOTE, None]}
    r = c.patch(f"{API}/preferences", json={"shortcuts": first})
    assert r.status_code == 200, r.text
    assert r.json()["shortcuts"] == first
    check(r.json(), "Preferences", spec="002")
    assert c.get(f"{API}/preferences").json()["shortcuts"] == first
    # another key keeps the map; a new map replaces it whole; {} clears it
    assert c.patch(f"{API}/preferences", json={"theme": "dark"}).json()["shortcuts"] == first
    second = {"player.playPause": [{"chord": "Space", "label": "Space"}, None]}
    assert c.patch(f"{API}/preferences", json={"shortcuts": second}).json()["shortcuts"] == second
    assert c.patch(f"{API}/preferences", json={"shortcuts": {}}).json()["shortcuts"] == {}


@pytest.mark.parametrize(
    ("shortcuts", "code"),
    [
        ({f"a.c{i}": [None, None] for i in range(201)}, "too_long"),
        ({"NewNote": [None, None]}, "string_pattern_mismatch"),
        ({"a." + "b" * 63: [None, None]}, "string_too_long"),
        ({"a.b": [None]}, "missing"),
        ({"a.b": [None, None, None]}, "too_long"),
        ({"a.b": [{"chord": "Alt+K!", "label": "x"}, None]}, "string_pattern_mismatch"),
        ({"a.b": [{"chord": "Shift+Alt+KeyK", "label": "x"}, None]}, "string_pattern_mismatch"),
        ({"a.b": [{"chord": "KeyK", "label": ""}, None]}, "string_too_short"),
        ({"a.b": [{"chord": "KeyK", "label": "x" * 33}, None]}, "string_too_long"),
        ({"a.b": [{"chord": "KeyK", "label": "K", "extra": 1}, None]}, "extra_forbidden"),
    ],
)
def test_preferences_019_shortcuts_invalid(
    owner_client: TestClient, shortcuts: dict[str, object], code: str
) -> None:
    r = owner_client.patch(f"{API}/preferences", json={"shortcuts": shortcuts})
    assert r.status_code == 422
    assert code in _codes(r)
