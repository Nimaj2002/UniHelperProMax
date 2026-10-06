from __future__ import annotations

import pytest

from tests.webm_fixture import make_webm
from unihelper.domain import webm as w

pytestmark = pytest.mark.unit


def payloads(data: bytes) -> list[bytes]:
    """Cluster bytes without the Timecode value (block data must survive a split)."""
    layout = w.analyse(data)
    bounds = [c.offset for c in layout.clusters] + [len(data)]
    out = []
    for i in range(len(layout.clusters)):
        raw = data[bounds[i] : bounds[i + 1]]
        _, p = w.read_id(raw, 0)
        _, p = w.read_size(raw, p)
        _, q = w.read_id(raw, p)  # Timecode
        size, q = w.read_size(raw, q)
        out.append(raw[q + size :])
    return out


def test_unlimited_or_small_is_one_part() -> None:
    data = make_webm(5)
    assert w.split(data, None) == [(data, 5000)]
    assert w.split(data, len(data)) == [(data, 5000)]


@pytest.mark.parametrize("finalized", [False, True])
def test_parts_are_valid_rebased_and_complete(finalized: bool) -> None:
    data = make_webm(30)
    if finalized:
        data, _ = w.finalize(data)
    limit = len(data) // 4
    parts = w.split(data, limit)
    assert len(parts) >= 4
    assert all(len(p) <= limit for p, _ in parts)
    joined: list[bytes] = []
    for part, duration in parts:
        layout = w.analyse(part)  # every part parses on its own
        assert layout.clusters[0].timecode == 0
        assert layout.duration_ms == pytest.approx(duration, abs=20)
        joined += payloads(part)
    assert joined == payloads(data)
    assert sum(d for _, d in parts) == pytest.approx(30_000, abs=20)


def test_cluster_larger_than_limit_raises() -> None:
    data = make_webm(3)
    with pytest.raises(w.WebmError):
        w.split(data, 200)
