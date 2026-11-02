"""020 timer contract (T015, T037, T052, T068): Track, Pomodoro, Focus, undo, links."""

from __future__ import annotations

from collections.abc import Callable

import pytest
from fastapi.testclient import TestClient

from tests.conftest import assert_problem
from tests.contract.time_helpers import (
    API,
    T0,
    Clock,
    act,
    entries,
    start,
    tag,
    timer_call,
    v,
)

pytestmark = pytest.mark.contract


# ---- Track (US1) -----------------------------------------------------------------------------


def test_no_timer(owner_client: TestClient, clock: Clock) -> None:
    r = timer_call(owner_client, "GET")
    assert r["timer"] is None and r["serverNow"].startswith("2026-11-02T09:00:00")


def test_track_start_stop_saves_entry(owner_client: TestClient, clock: Clock) -> None:
    c = owner_client
    h = tag(c)
    t = start(c, description=" Problem set ", tagId=h["id"])["timer"]
    assert (t["style"], t["state"], t["description"], t["tagId"]) == (
        "track", "running", "Problem set", h["id"],
    )  # fmt: skip
    clock.tick(minutes=25)
    assert timer_call(c, "GET")["timer"]["startedAt"] == t["startedAt"]  # stored, not ticked
    r = act(c, "stop", t["version"])
    assert r["timer"] is None and r["undo"] is None
    assert r["saved"]["durationSeconds"] == 25 * 60 and r["saved"]["source"] == "track"
    assert [e["id"] for e in entries(c)] == [r["saved"]["id"]]


def test_short_run_is_discarded_with_undo(owner_client: TestClient, clock: Clock) -> None:
    c = owner_client
    t = start(c, description="oops")["timer"]
    clock.tick(seconds=3)
    r = act(c, "stop", t["version"])
    assert r["saved"] is None and r["undo"]["previous"]["description"] == "oops"
    assert entries(c) == []
    back = timer_call(c, "POST", "/undo", json={"undo": r["undo"], "timerVersion": None})
    assert back["timer"]["startedAt"] == t["startedAt"]


def test_start_replaces_running_timer_and_undo_restores(
    owner_client: TestClient, clock: Clock
) -> None:
    c = owner_client
    a = start(c, description="A")["timer"]
    clock.tick(minutes=10)
    r = start(c, description="B")
    assert r["timer"]["description"] == "B" and r["undo"]["entryId"]
    assert [e["description"] for e in entries(c)] == ["A"]
    back = timer_call(
        c, "POST", "/undo", json={"undo": r["undo"], "timerVersion": r["timer"]["version"]}
    )
    assert back["timer"]["description"] == "A" and back["timer"]["startedAt"] == a["startedAt"]
    assert entries(c) == []
    # a second undo is refused: the timer changed since
    r2 = c.post(f"{API}/timer/undo", json={"undo": r["undo"], "timerVersion": 999})
    assert_problem(r2, 409, "undo_unavailable")


def test_stop_at_is_clamped_and_set_end(owner_client: TestClient, clock: Clock) -> None:
    c = owner_client
    t = start(c)["timer"]
    clock.tick(hours=2)
    # an offline Stop retried later keeps the moment the user pressed it
    r = act(c, "stop", t["version"], at=(T0.replace(minute=30)).isoformat())
    assert r["saved"]["durationSeconds"] == 30 * 60
    t = start(c)["timer"]
    clock.tick(hours=1)
    for bad in (T0.isoformat(), clock.now.replace(hour=23).isoformat()):
        res = c.post(f"{API}/timer/set-end", json={"endedAt": bad}, headers=v(t["version"]))
        assert res.status_code == 422, res.text
    r = act(c, "set-end", t["version"], endedAt=clock.now.replace(hour=11, minute=15).isoformat())
    assert r["timer"] is None and r["saved"]["durationSeconds"] == 15 * 60


def test_errors(owner_client: TestClient, clock: Clock) -> None:
    c = owner_client
    assert_problem(c.post(f"{API}/timer/stop", json={}, headers=v(1)), 409, "no_timer")
    res = c.post(f"{API}/timer/start", json={"style": "track", "tagId": "nope"})
    assert_problem(res, 404, "not_found")
    t = start(c)["timer"]
    assert_problem(c.post(f"{API}/timer/stop", json={}, headers=v(99)), 412, "version_conflict")
    assert_problem(c.post(f"{API}/timer/resume", headers=v(t["version"])), 409, "not_paused")
    assert_problem(c.post(f"{API}/timer/skip", headers=v(t["version"])), 409, "not_pomodoro")


def test_patch_timer_and_track_pause(owner_client: TestClient, clock: Clock) -> None:
    c = owner_client
    h = tag(c)
    t = start(c)["timer"]
    r = timer_call(
        c, "PATCH", json={"description": "Reading", "tagId": h["id"], "reminderAck": 1},
        headers=v(t["version"]),
    )  # fmt: skip
    assert (r["timer"]["description"], r["timer"]["tagId"], r["timer"]["reminderAck"]) == (
        "Reading", h["id"], 1,
    )  # fmt: skip
    clock.tick(minutes=5)
    r = act(c, "pause", r["timer"]["version"])  # Track pause ends the entry (research R7)
    assert r["timer"] is None and r["saved"]["description"] == "Reading"


def test_timers_are_per_user(
    owner_client: TestClient, make_member: Callable[..., TestClient], clock: Clock
) -> None:
    start(owner_client)
    member = make_member()
    assert timer_call(member, "GET")["timer"] is None


# ---- Pomodoro (US4) --------------------------------------------------------------------------


def _prefs(c: TestClient, **time: object) -> None:
    r = c.patch("/api/v1/preferences", json={"time": time})
    assert r.status_code == 200, r.text


def test_pomodoro_cycle(owner_client: TestClient, clock: Clock) -> None:
    c = owner_client
    _prefs(c, pomodoroWorkMin=1, pomodoroShortMin=1, pomodoroLongMin=2, pomodoroPeriods=2)
    t = start(c, "pomodoro", description="LA")["timer"]
    assert (t["phase"], t["period"]) == ("work", 1)
    assert_problem(c.post(f"{API}/timer/advance", headers=v(t["version"])), 409, "not_due")
    clock.tick(minutes=1)
    r = act(c, "advance", t["version"])  # work 1 done → short break, waiting (no auto start)
    assert r["saved"]["source"] == "pomodoro" and r["saved"]["durationSeconds"] == 60
    assert (r["timer"]["phase"], r["timer"]["state"]) == ("short_break", "waiting")
    r = act(c, "advance", r["timer"]["version"])  # user starts the break
    assert r["timer"]["state"] == "running"
    clock.tick(minutes=1)
    r = act(c, "advance", r["timer"]["version"])  # breaks are never saved
    assert r["saved"] is None and (r["timer"]["phase"], r["timer"]["period"]) == ("work", 2)
    r = act(c, "advance", r["timer"]["version"])
    clock.tick(minutes=1)
    r = act(c, "advance", r["timer"]["version"])  # 2nd work → long break
    assert r["timer"]["phase"] == "long_break"
    r = act(c, "skip", r["timer"]["version"])  # long break skipped → Work 1 again
    assert (r["timer"]["phase"], r["timer"]["period"], r["timer"]["state"]) == (
        "work", 1, "running",
    )  # fmt: skip
    assert len(entries(c)) == 2


def test_pomodoro_auto_start_pause_resume_reset(owner_client: TestClient, clock: Clock) -> None:
    c = owner_client
    _prefs(c, pomodoroWorkMin=10, pomodoroAutoStart=True)
    t = start(c, "pomodoro")["timer"]
    clock.tick(minutes=4)
    t = act(c, "pause", t["version"])["timer"]
    assert t["state"] == "paused"
    clock.tick(minutes=3)
    t = act(c, "resume", t["version"])["timer"]
    assert t["pausedMs"] == 3 * 60_000 and t["plannedEndAt"].startswith("2026-11-02T09:13")
    clock.tick(minutes=6)  # 13 min since start = planned end
    r = act(c, "advance", t["version"])
    assert r["saved"]["durationSeconds"] == 10 * 60 and r["saved"]["pausedSeconds"] == 180
    assert (r["timer"]["phase"], r["timer"]["state"]) == ("short_break", "running")  # auto start
    r = act(c, "skip", r["timer"]["version"])
    clock.tick(minutes=2)
    r = act(c, "reset", r["timer"]["version"])  # work so far saved
    assert r["timer"] is None and r["saved"]["durationSeconds"] == 120


def test_pomodoro_settles_while_closed(owner_client: TestClient, clock: Clock) -> None:
    c = owner_client
    _prefs(c, pomodoroWorkMin=25, pomodoroAutoStart=True)
    start(c, "pomodoro")
    clock.tick(hours=2)  # nobody watched the end
    r = timer_call(c, "GET")
    assert r["settled"][0]["phase"] == "work"
    assert r["settled"][0]["finishedAt"].startswith("2026-11-02T09:25")
    # auto start never runs while closed; the entry ends at the planned end
    assert (r["timer"]["phase"], r["timer"]["state"]) == ("short_break", "waiting")
    assert entries(c)[0]["endedAt"].startswith("2026-11-02T09:25")
    assert timer_call(c, "GET")["settled"] == []  # idempotent


# ---- Focus (US5) -----------------------------------------------------------------------------


def test_focus_session(owner_client: TestClient, clock: Clock) -> None:
    c = owner_client
    res = c.post(f"{API}/timer/start", json={"style": "focus", "focusMinutes": 481})
    assert res.status_code == 422
    t = start(c, "focus", focusMinutes=25, goal="Chapter 6", hidePanels=True)["timer"]
    assert t["plannedEndAt"].startswith("2026-11-02T09:25") and t["hidePanels"] is True
    t = act(c, "extend", t["version"])["timer"]
    assert t["focusMinutes"] == 30
    clock.tick(minutes=30)
    r = act(c, "advance", t["version"])
    assert r["timer"] is None and r["saved"]["description"] == "Chapter 6"
    assert r["saved"]["source"] == "focus" and r["saved"]["durationSeconds"] == 30 * 60
    t = start(c, "focus", focusMinutes=478)["timer"]
    assert_problem(c.post(f"{API}/timer/extend", headers=v(t["version"])), 422, "too_long")
    clock.tick(minutes=10)
    r = act(c, "stop", t["version"])  # finish early: time so far
    assert r["saved"]["durationSeconds"] == 600


# ---- links (US11) ----------------------------------------------------------------------------


def test_start_from_task_links_it(owner_client: TestClient, clock: Clock) -> None:
    c = owner_client
    task = c.post("/api/v1/tasks", json={"title": "Essay"}).json()
    t = start(c, taskId=task["id"])["timer"]
    assert (t["taskId"], t["linkTitle"]) == (task["id"], "Essay")
    clock.tick(minutes=1)
    saved = act(c, "stop", t["version"])["saved"]
    assert saved["taskId"] == task["id"] and saved["linkTitle"] == "Essay"
    res = c.post(f"{API}/timer/start", json={"style": "track", "sessionKey": "bad"})
    assert_problem(res, 404, "not_found")
