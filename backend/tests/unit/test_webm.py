from __future__ import annotations

import struct

import pytest

from tests.webm_fixture import make_webm
from unihelper.domain import webm as w

pytestmark = pytest.mark.unit


def cues_of(data: bytes) -> tuple[w.Layout, list[tuple[int, int]], float | None]:
    """Re-parse a finalized file: (layout, [(cue time, cluster position)], duration)."""
    layout = w.analyse(data)
    _, pos = w.read_id(data, layout.header_end)
    _, seg_data = w.read_size(data, pos)
    cues: list[tuple[int, int]] = []
    duration = None
    p = seg_data
    while p < layout.clusters[0].offset:
        eid, q = w.read_id(data, p)
        size, q = w.read_size(data, q)
        payload = data[q : q + size]
        if eid == w.INFO:
            i = 0
            while i < len(payload):
                iid, i2 = w.read_id(payload, i)
                isz, i3 = w.read_size(payload, i2)
                if iid == w.DURATION:
                    duration = struct.unpack(">d", payload[i3 : i3 + isz])[0]
                i = i3 + isz
        if eid == w.CUES:
            i = 0
            while i < len(payload):
                _, i2 = w.read_id(payload, i)
                psz, i3 = w.read_size(payload, i2)
                point = payload[i3 : i3 + psz]
                _, j = w.read_id(point, 0)
                tsz, j = w.read_size(point, j)
                time = w.read_uint(point[j : j + tsz])
                j += tsz
                _, j = w.read_id(point, j)
                _, j = w.read_size(point, j)
                _, j = w.read_id(point, j)  # CueTrack
                ts, j = w.read_size(point, j)
                j += ts
                _, j = w.read_id(point, j)  # CueClusterPosition
                cs, j = w.read_size(point, j)
                cues.append((time, w.read_uint(point[j : j + cs])))
                i = i3 + psz
        p = q + size
    return layout, cues, duration


@pytest.mark.parametrize("known", [False, True])
def test_analyse_duration(known: bool) -> None:
    layout = w.analyse(make_webm(3.5, known_cluster_size=known))
    assert len(layout.clusters) == 4
    assert [c.timecode for c in layout.clusters] == [0, 1000, 2000, 3000]
    assert layout.duration_ms == 3500  # last block at 3480 + one 20 ms frame


def test_finalize_adds_duration_and_cues_keeping_clusters() -> None:
    data = make_webm(5)
    out, duration = w.finalize(data)
    assert duration == 5000
    first = w.analyse(data).clusters[0].offset
    assert out.endswith(data[first:])  # cluster bytes preserved verbatim
    layout, cues, dur = cues_of(out)
    assert dur == pytest.approx(5000.0)
    _, pos = w.read_id(out, layout.header_end)
    _, seg_data = w.read_size(out, pos)
    assert cues == [(c.timecode, c.offset - seg_data) for c in layout.clusters]
    for c in layout.clusters:  # every cue position lands on a Cluster id
        assert w.read_id(out, c.offset)[0] == w.CLUSTER


def test_finalize_is_idempotent() -> None:
    once, d1 = w.finalize(make_webm(2))
    twice, d2 = w.finalize(once)
    assert once == twice and d1 == d2


def test_truncated_crash_tail_still_analyses() -> None:
    data = make_webm(4)
    cut = data[: len(data) - 1234]  # crash in the middle of the last cluster
    out, duration = w.finalize(cut)
    assert 3000 < duration < 4000
    assert out.endswith(cut[w.analyse(cut).clusters[0].offset :])


@pytest.mark.parametrize("bad", [b"", b"not a webm file", make_webm(1)[:30]])
def test_garbage_raises(bad: bytes) -> None:
    with pytest.raises(w.WebmError):
        w.finalize(bad)


def test_vint_round_trip() -> None:
    for n in (0, 1, 126, 127, 128, 16382, 16383, 2**20, 2**40):
        size, pos = w.read_size(w.encode_size(n), 0)
        assert size == n
    assert w.read_size(w.encode_size(w.UNKNOWN), 0)[0] == w.UNKNOWN
