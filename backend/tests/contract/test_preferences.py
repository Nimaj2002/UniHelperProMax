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
        "theme": "preset:yuii",
        "readerDarkPages": False,  # 007
        "lastSemesterId": None,  # 009
        "quickCreateType": "class",  # 009
        "recordingBarStyle": "full",
        "generalNotesCollapsed": False,  # 018
        "shortcuts": {},  # 019
        "time": {  # 020
            "pomodoroWorkMin": 25,
            "pomodoroShortMin": 5,
            "pomodoroLongMin": 15,
            "pomodoroPeriods": 4,
            "pomodoroAutoStart": False,
            "focusHidePanels": False,
            "longRunningHours": 3,
            "sound": True,
            "systemNotifications": False,
            "indicatorCombo": "combined",
            "timerBarStyle": "full",
            "dailyGoalMin": None,
        },
        "tour": {"status": "not_seen", "chapter": None},  # 023
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


def test_time_preferences_patch_nested(owner_client: TestClient) -> None:
    """020: `time` is merged key by key; null turns off the reminder; ranges are enforced."""
    c = owner_client
    r = c.patch(f"{API}/preferences", json={"time": {"pomodoroWorkMin": 50}})
    assert r.json()["time"]["pomodoroWorkMin"] == 50 and r.json()["time"]["sound"] is True
    r = c.patch(f"{API}/preferences", json={"time": {"longRunningHours": None}})
    assert r.json()["time"]["longRunningHours"] is None
    assert r.json()["time"]["pomodoroWorkMin"] == 50
    check(r.json(), "Preferences", spec="002")
    for bad in ({"pomodoroWorkMin": 0}, {"pomodoroPeriods": 9}, {"longRunningHours": 13},
                {"indicatorCombo": "both"}, {"timerBarStyle": "tiny"}):  # fmt: skip
        assert c.patch(f"{API}/preferences", json={"time": bad}).status_code == 422


NOT_SEEN = {"status": "not_seen", "chapter": None}


def test_preferences_023_tour(owner_client: TestClient, make_member, app) -> None:  # type: ignore[no-untyped-def]
    """023: every account starts at not_seen; a PATCH replaces the object; users are separate."""
    c = owner_client
    assert c.get(f"{API}/preferences").json()["tour"] == NOT_SEEN
    started = {"status": "in_progress", "chapter": "first_course"}
    r = c.patch(f"{API}/preferences", json={"tour": started})
    assert r.status_code == 200, r.text
    assert r.json()["tour"] == started
    check(r.json(), "Preferences", spec="002")
    assert c.get(f"{API}/preferences").json()["tour"] == started
    # another key keeps it; a new object replaces it whole (chapter back to null)
    assert c.patch(f"{API}/preferences", json={"theme": "dark"}).json()["tour"] == started
    done = c.patch(f"{API}/preferences", json={"tour": {"status": "completed"}}).json()["tour"]
    assert done == {"status": "completed", "chapter": None}
    # a second account is independent
    assert make_member().get(f"{API}/preferences").json()["tour"] == NOT_SEEN


def test_preferences_023_tour_default_for_old_rows(owner_client: TestClient, app) -> None:  # type: ignore[no-untyped-def]
    """Stored preferences from before 023 have no `tour`: the default applies (FR-022)."""
    import json

    from unihelper.models import UiPreferences

    owner_client.patch(f"{API}/preferences", json={"theme": "dark"})
    with app.state.sessionmaker() as db:
        row = db.query(UiPreferences).one()
        data = json.loads(row.data)
        data.pop("tour", None)
        row.data = json.dumps(data)
        db.commit()
    assert owner_client.get(f"{API}/preferences").json()["tour"] == NOT_SEEN


@pytest.mark.parametrize(
    ("tour", "code"),
    [
        ({"chapter": "welcome"}, "missing"),
        ({"status": "done"}, "literal_error"),
        ({"status": "in_progress", "chapter": "intro"}, "literal_error"),
        ({"status": "completed", "step": 3}, "extra_forbidden"),
    ],
)
def test_preferences_023_tour_invalid(
    owner_client: TestClient, tour: dict[str, object], code: str
) -> None:
    r = owner_client.patch(f"{API}/preferences", json={"tour": tour})
    assert r.status_code == 422
    assert code in _codes(r)
