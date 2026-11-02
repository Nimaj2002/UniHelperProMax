"""020 T016/T036: the Pomodoro phase order, independent of the API."""

from __future__ import annotations

from unihelper.services.time_service import _next_phase

PREFS = {"pomodoro_periods": 4}


def test_phase_order_over_a_full_cycle() -> None:
    phase, period, seen = "work", 1, []
    for _ in range(9):
        seen.append((phase, period))
        phase, period = _next_phase(PREFS, phase, period)
    assert seen == [
        ("work", 1), ("short_break", 1), ("work", 2), ("short_break", 2), ("work", 3),
        ("short_break", 3), ("work", 4), ("long_break", 4), ("work", 1),
    ]  # fmt: skip
