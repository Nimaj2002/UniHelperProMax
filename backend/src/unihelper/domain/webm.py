"""Minimal WebM (EBML/Matroska) reader/writer for MediaRecorder output (003 research A4).

MediaRecorder writes a live stream: the Segment and Clusters have "unknown" sizes and there is
no Duration and no Cues, so players show an infinite length and cannot seek. `finalize()`
rewrites the header once: Info gains a Duration and a Cues index (one CuePoint per Cluster) is
inserted before the first Cluster. Every Cluster byte is kept unchanged (it is only moved), so a
recording truncated by a crash still plays. Pure functions; no I/O.
"""

from __future__ import annotations

import struct
from dataclasses import dataclass, field

EBML = 0x1A45DFA3
SEGMENT = 0x18538067
SEEK_HEAD = 0x114D9B74
INFO = 0x1549A966
TIMECODE_SCALE = 0x2AD7B1
DURATION = 0x4489
TRACKS = 0x1654AE6B
CUES = 0x1C53BB6B
CUE_POINT = 0xBB
CUE_TIME = 0xB3
CUE_TRACK_POSITIONS = 0xB7
CUE_TRACK = 0xF7
CUE_CLUSTER_POSITION = 0xF1
CLUSTER = 0x1F43B675
TIMECODE = 0xE7
SIMPLE_BLOCK = 0xA3
BLOCK_GROUP = 0xA0
BLOCK = 0xA1
VOID = 0xEC

CLUSTER_CHILDREN = {TIMECODE, SIMPLE_BLOCK, BLOCK_GROUP, 0xA7, 0xAB, VOID}  # + Position, PrevSize
UNKNOWN = -1
FRAME_MS = 20  # Opus frame length used to account for the last block


class WebmError(ValueError):
    pass


# ---- EBML primitives --------------------------------------------------------------------------


def read_id(data: bytes, pos: int) -> tuple[int, int]:
    if pos >= len(data):
        raise WebmError("unexpected end of data")
    first = data[pos]
    length = 1
    mask = 0x80
    while length <= 4 and not first & mask:
        mask >>= 1
        length += 1
    if length > 4 or pos + length > len(data):
        raise WebmError("invalid element id")
    return int.from_bytes(data[pos : pos + length], "big"), pos + length


def read_size(data: bytes, pos: int) -> tuple[int, int]:
    if pos >= len(data):
        raise WebmError("unexpected end of data")
    first = data[pos]
    length = 1
    mask = 0x80
    while length <= 8 and not first & mask:
        mask >>= 1
        length += 1
    if length > 8 or pos + length > len(data):
        raise WebmError("invalid element size")
    value = first & (mask - 1)
    all_ones = value == mask - 1
    for b in data[pos + 1 : pos + length]:
        value = (value << 8) | b
        all_ones = all_ones and b == 0xFF
    return (UNKNOWN if all_ones else value), pos + length


def encode_id(element_id: int) -> bytes:
    return element_id.to_bytes((element_id.bit_length() + 7) // 8, "big")


def encode_size(size: int, width: int | None = None) -> bytes:
    if size == UNKNOWN:
        return b"\x01\xff\xff\xff\xff\xff\xff\xff"
    length = width or 1
    while size >= (1 << (7 * length)) - 1:
        length += 1
    return ((1 << (7 * length)) | size).to_bytes(length, "big")


def element(element_id: int, payload: bytes) -> bytes:
    return encode_id(element_id) + encode_size(len(payload)) + payload


def uint(element_id: int, value: int, width: int | None = None) -> bytes:
    n = width or max(1, (value.bit_length() + 7) // 8)
    return encode_id(element_id) + encode_size(n) + value.to_bytes(n, "big")


def read_uint(payload: bytes) -> int:
    return int.from_bytes(payload, "big") if payload else 0


# ---- analysis ---------------------------------------------------------------------------------


@dataclass
class Cluster:
    offset: int  # absolute offset of the Cluster element in the file
    timecode: int
    last_block: int = 0  # max relative block timecode seen


@dataclass
class Layout:
    header_end: int  # end of the EBML header element
    segment_start: int  # offset of the Segment element
    segment_data: int  # first byte inside the Segment
    timecode_scale: int = 1_000_000
    info_children: list[tuple[int, bytes]] = field(default_factory=list)  # (id, raw element)
    kept: list[bytes] = field(default_factory=list)  # Tracks, Tags, … (raw elements)
    clusters: list[Cluster] = field(default_factory=list)
    track: int = 1

    @property
    def duration_ms(self) -> int:
        if not self.clusters:
            return 0
        last = self.clusters[-1]
        ticks = last.timecode + last.last_block
        return round(ticks * self.timecode_scale / 1_000_000) + FRAME_MS


def _block_info(payload: bytes) -> tuple[int, int]:
    """(track number, signed 16-bit relative timecode) of a (Simple)Block payload."""
    track, p = read_size(payload, 0)
    if p + 2 > len(payload):
        raise WebmError("short block")
    return track, struct.unpack(">h", payload[p : p + 2])[0]


def _parse_cluster(data: bytes, start: int, end: int, cluster: Cluster, layout: Layout) -> int:
    """Parse children from `start`; for unknown-size clusters stop at a non-child id."""
    pos = start
    while pos < end:
        try:
            cid, p = read_id(data, pos)
        except WebmError:
            return len(data)
        if end == len(data) and cid not in CLUSTER_CHILDREN:
            return pos  # next segment-level element (unknown-size cluster ended)
        try:
            size, p = read_size(data, p)
        except WebmError:
            return len(data)
        if size == UNKNOWN or p + size > len(data):
            return len(data)  # truncated tail (crash): keep what we have
        payload = data[p : p + size]
        if cid == TIMECODE:
            cluster.timecode = read_uint(payload)
        elif cid == SIMPLE_BLOCK:
            track, rel = _block_info(payload)
            layout.track = track
            cluster.last_block = max(cluster.last_block, rel)
        elif cid == BLOCK_GROUP:
            q = 0
            while q < len(payload):
                bid, q2 = read_id(payload, q)
                bsize, q3 = read_size(payload, q2)
                if bid == BLOCK and bsize != UNKNOWN:
                    track, rel = _block_info(payload[q3 : q3 + bsize])
                    layout.track = track
                    cluster.last_block = max(cluster.last_block, rel)
                q = q3 + max(bsize, 0)
        pos = p + size
    return pos


def analyse(data: bytes) -> Layout:
    eid, pos = read_id(data, 0)
    if eid != EBML:
        raise WebmError("not an EBML file")
    size, pos = read_size(data, pos)
    header_end = pos + size
    sid, pos = read_id(data, header_end)
    if sid != SEGMENT:
        raise WebmError("no Segment")
    seg_size, seg_data = read_size(data, pos)
    seg_end = len(data) if seg_size == UNKNOWN else min(len(data), seg_data + seg_size)
    layout = Layout(header_end=header_end, segment_start=header_end, segment_data=seg_data)

    pos = seg_data
    while pos < seg_end:
        try:
            cid, p = read_id(data, pos)
            size, p = read_size(data, p)
        except WebmError:
            break
        if cid == CLUSTER:
            cluster = Cluster(offset=pos, timecode=0)
            end = len(data) if size == UNKNOWN else min(len(data), p + size)
            next_pos = _parse_cluster(data, p, end, cluster, layout)
            layout.clusters.append(cluster)
            pos = next_pos if size == UNKNOWN else p + size
            continue
        if size == UNKNOWN or p + size > len(data):
            break
        raw = data[pos : p + size]
        if cid == INFO:
            q = p
            while q < p + size:
                iid, q2 = read_id(data, q)
                isize, q3 = read_size(data, q2)
                layout.info_children.append((iid, data[q : q3 + isize]))
                if iid == TIMECODE_SCALE:
                    layout.timecode_scale = read_uint(data[q3 : q3 + isize]) or 1_000_000
                q = q3 + isize
        elif cid in (SEEK_HEAD, CUES, VOID):
            pass  # rebuilt / dropped by finalize
        else:
            layout.kept.append(raw)
        pos = p + size
    if not layout.clusters:
        raise WebmError("no audio clusters")
    return layout


# ---- rewrite ----------------------------------------------------------------------------------


def _cues(layout: Layout, cluster_base: int) -> bytes:
    """Cues with fixed-width numbers so their size does not depend on the positions."""
    points = b""
    first = layout.clusters[0].offset
    for c in layout.clusters:
        position = cluster_base + (c.offset - first)
        positions = uint(CUE_TRACK, layout.track, 1) + uint(CUE_CLUSTER_POSITION, position, 8)
        points += element(
            CUE_POINT, uint(CUE_TIME, c.timecode, 8) + element(CUE_TRACK_POSITIONS, positions)
        )
    return element(CUES, points)


def finalize(data: bytes) -> tuple[bytes, int]:
    """Return (rewritten file, duration in ms). Cluster bytes are preserved verbatim."""
    layout = analyse(data)
    duration_ticks = layout.duration_ms * 1_000_000 / layout.timecode_scale
    info_payload = b"".join(raw for iid, raw in layout.info_children if iid != DURATION)
    info_payload += encode_id(DURATION) + encode_size(8) + struct.pack(">d", duration_ticks)
    info = element(INFO, info_payload)
    kept = b"".join(layout.kept)
    before_cues = len(info) + len(kept)
    cues_size = len(_cues(layout, 0))  # fixed width: size independent of positions
    cues = _cues(layout, before_cues + cues_size)
    head = data[: layout.header_end] + encode_id(SEGMENT) + encode_size(UNKNOWN)
    body = info + kept + cues + data[layout.clusters[0].offset :]
    return head + body, layout.duration_ms


# ---- splitting (004 research B5) --------------------------------------------------------------


def _rebase_cluster(raw: bytes, base: int) -> bytes:
    """Rewrite a cluster's Timecode to `timecode - base`, keeping the element's byte width."""
    _, p = read_id(raw, 0)
    _, p = read_size(raw, p)
    end = len(raw)
    while p < end:
        cid, q = read_id(raw, p)
        size, q = read_size(raw, q)
        if cid == TIMECODE:
            value = read_uint(raw[q : q + size]) - base
            return raw[:q] + max(value, 0).to_bytes(size, "big") + raw[q + size :]
        if size == UNKNOWN:
            break
        p = q + size
    return raw


def split(data: bytes, max_bytes: int | None) -> list[tuple[bytes, int]]:
    """Split into independently playable WebM files of at most `max_bytes` each, at Cluster
    boundaries: [(part bytes, part duration ms)]. Cluster payloads are kept; only each part's
    cluster Timecodes are rebased so every part starts at 0."""
    layout = analyse(data)
    to_ms = layout.timecode_scale / 1_000_000
    if max_bytes is None or len(data) <= max_bytes:
        return [(data, layout.duration_ms)]
    info_payload = b"".join(raw for iid, raw in layout.info_children if iid != DURATION)
    prefix = (
        data[: layout.header_end]
        + encode_id(SEGMENT)
        + encode_size(UNKNOWN)
        + element(INFO, info_payload)
        + b"".join(layout.kept)
    )
    bounds = [c.offset for c in layout.clusters] + [len(data)]
    raws = [data[bounds[i] : bounds[i + 1]] for i in range(len(layout.clusters))]
    groups: list[list[int]] = [[]]
    size = len(prefix)
    for i, raw in enumerate(raws):
        if len(prefix) + len(raw) > max_bytes:
            raise WebmError("a single cluster is larger than the part limit")
        if groups[-1] and size + len(raw) > max_bytes:
            groups.append([])
            size = len(prefix)
        groups[-1].append(i)
        size += len(raw)
    parts: list[tuple[bytes, int]] = []
    for g, idx in enumerate(groups):
        base = layout.clusters[idx[0]].timecode
        body = b"".join(_rebase_cluster(raws[i], base) for i in idx)
        if g + 1 < len(groups):
            end_ms = round(layout.clusters[groups[g + 1][0]].timecode * to_ms)
        else:
            end_ms = layout.duration_ms
        parts.append((prefix + body, max(0, end_ms - round(base * to_ms))))
    return parts
