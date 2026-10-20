"""014 T107: WebM/Opus recordings become valid Ogg/Opus with the same packets."""

from __future__ import annotations

import struct

import pytest

from tests.webm_fixture import make_webm
from unihelper.domain import webm as w
from unihelper.domain.ogg_opus import RemuxUnsupported, ogg_crc, opus_samples, remux_webm_opus

pytestmark = pytest.mark.unit


def pages(data: bytes) -> list[dict]:  # type: ignore[type-arg]
    out, pos = [], 0
    while pos < len(data):
        assert data[pos : pos + 4] == b"OggS"
        flags, granule, _serial, seq, crc, count = struct.unpack_from("<xBqIIIB", data, pos + 4)
        lacing = data[pos + 27 : pos + 27 + count]
        size = 27 + count + sum(lacing)
        page = bytearray(data[pos : pos + size])
        struct.pack_into("<I", page, 22, 0)
        assert ogg_crc(bytes(page)) == crc
        body = data[pos + 27 + count : pos + size]
        packets, start, length = [], 0, 0
        for value in lacing:
            length += value
            if value < 255:
                packets.append(body[start : start + length])
                start, length = start + length, 0
        out.append({"flags": flags, "granule": granule, "seq": seq, "packets": packets})
        pos += size
    return out


def test_remux_keeps_every_packet() -> None:
    data = make_webm(3)  # 150 blocks of 20 ms
    ogg = remux_webm_opus(data)
    got = pages(ogg)
    assert got[0]["flags"] == 0x02 and got[0]["packets"][0].startswith(b"OpusHead")
    assert got[1]["packets"][0].startswith(b"OpusTags")
    audio = [p for page in got[2:] for p in page["packets"]]
    assert len(audio) == 150
    assert audio[0] == bytes([0]) * 40
    assert got[-1]["flags"] & 0x04  # end of stream
    assert [p["seq"] for p in got] == list(range(len(got)))
    granules = [p["granule"] for p in got[2:]]
    assert granules == sorted(granules)
    assert granules[-1] == sum(opus_samples(p) for p in audio)


def test_opus_samples() -> None:
    assert opus_samples(bytes([(19 << 3) | 0])) == 960  # CELT 20 ms, one frame
    assert opus_samples(bytes([(19 << 3) | 1])) == 1920  # two frames
    assert opus_samples(bytes([(1 << 3) | 3, 3])) == 3 * 960  # SILK 20 ms × 3
    assert opus_samples(b"") == 0


def test_unsupported() -> None:
    header = w.element(w.EBML, w.uint(0x4286, 1))
    track = w.element(0xAE, w.uint(0xD7, 1) + w.element(0x86, b"A_VORBIS"))
    segment = w.element(w.SEGMENT, w.element(w.TRACKS, track))
    with pytest.raises(RemuxUnsupported):
        remux_webm_opus(header + segment)
    laced = make_webm(1).replace(b"\xa3", b"\xa3", 1)
    blocks = bytearray(laced)
    idx = blocks.find(b"\x81\x00\x00\x80")  # the first SimpleBlock: set Xiph lacing
    blocks[idx + 3] = 0x82
    with pytest.raises(RemuxUnsupported):
        remux_webm_opus(bytes(blocks))
