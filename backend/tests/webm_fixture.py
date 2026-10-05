"""Generate MediaRecorder-like WebM (unknown-size Segment and Clusters, Opus-ish blocks)."""

from __future__ import annotations

import struct

from unihelper.domain import webm as w


def make_webm(
    seconds: float, cluster_ms: int = 1000, frame_ms: int = 20, known_cluster_size: bool = False
) -> bytes:
    header = w.element(w.EBML, w.uint(0x4286, 1) + w.element(0x4282, b"webm"))
    info = w.element(w.INFO, w.uint(w.TIMECODE_SCALE, 1_000_000) + w.element(0x4D80, b"Chrome"))
    track = w.element(0xAE, w.uint(0xD7, 1) + w.uint(0x83, 2) + w.element(0x86, b"A_OPUS"))
    tracks = w.element(w.TRACKS, track)
    body = info + tracks
    total = int(seconds * 1000)
    for start in range(0, total, cluster_ms):
        blocks = b""
        for rel in range(0, min(cluster_ms, total - start), frame_ms):
            payload = b"\x81" + struct.pack(">h", rel) + b"\x80" + bytes([rel % 251]) * 40
            blocks += w.element(w.SIMPLE_BLOCK, payload)
        content = w.uint(w.TIMECODE, start) + blocks
        if known_cluster_size:
            body += w.element(w.CLUSTER, content)
        else:
            body += w.encode_id(w.CLUSTER) + w.encode_size(w.UNKNOWN) + content
    return header + w.encode_id(w.SEGMENT) + w.encode_size(w.UNKNOWN) + body


def chunks(data: bytes, n: int) -> list[bytes]:
    size = -(-len(data) // n)
    return [data[i : i + size] for i in range(0, len(data), size)]
