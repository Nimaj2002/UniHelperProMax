"""WebM/Opus → Ogg/Opus without re-encoding (014 research R9).

The app's recordings are WebM with an Opus track (MediaRecorder). Gemini accepts `audio/ogg` but
doesn't list WebM, so the Opus packets are moved into Ogg pages as RFC 7845 describes: an
OpusHead page (the track's CodecPrivate, or a minimal header when it is missing), an OpusTags
page, then the audio packets with granule positions at 48 kHz. Laced blocks and files without an
Opus track are refused (`RemuxUnsupported`); the caller then suggests Transcribe. Pure
functions; no I/O.
"""

from __future__ import annotations

import struct

from unihelper.domain.webm import UNKNOWN, read_id, read_size

SEGMENT = 0x18538067
TRACKS = 0x1654AE6B
TRACK_ENTRY = 0xAE
TRACK_NUMBER = 0xD7
CODEC_ID = 0x86
CODEC_PRIVATE = 0x63A2
AUDIO = 0xE1
CHANNELS = 0x9F
CLUSTER = 0x1F43B675
SIMPLE_BLOCK = 0xA3
BLOCK_GROUP = 0xA0
BLOCK = 0xA1
CONTAINERS = {SEGMENT, TRACKS, TRACK_ENTRY, AUDIO, CLUSTER, BLOCK_GROUP}
PACKETS_PER_PAGE = 50
SERIAL = 0x55484D58  # "UHMX"
VENDOR = b"UniHelperProMax"


class RemuxUnsupported(ValueError):
    pass


def _crc_table() -> list[int]:
    table = []
    for i in range(256):
        r = i << 24
        for _ in range(8):
            r = ((r << 1) ^ 0x04C11DB7) if r & 0x80000000 else (r << 1)
        table.append(r & 0xFFFFFFFF)
    return table


_CRC = _crc_table()


def ogg_crc(data: bytes) -> int:
    crc = 0
    for byte in data:
        crc = ((crc << 8) ^ _CRC[((crc >> 24) & 0xFF) ^ byte]) & 0xFFFFFFFF
    return crc


def opus_samples(packet: bytes) -> int:
    """Samples at 48 kHz in one Opus packet (RFC 6716 §3.1, the TOC byte)."""
    if not packet:
        return 0
    toc = packet[0]
    config = toc >> 3
    if config < 12:
        tenths = (100, 200, 400, 600)[config % 4]  # SILK: 10/20/40/60 ms, in 0.1 ms
    elif config < 16:
        tenths = (100, 200)[config % 2]  # hybrid
    else:
        tenths = (25, 50, 100, 200)[config % 4]  # CELT: 2.5/5/10/20 ms
    count = toc & 0x03
    frames = (
        1 if count == 0 else 2 if count in (1, 2) else (packet[1] & 0x3F if len(packet) > 1 else 0)
    )
    return frames * tenths * 48 // 10


def _walk(
    data: bytes, start: int, end: int, out: dict[str, object], track: dict[str, object]
) -> None:
    pos = start
    while pos < end:
        try:
            eid, pos_after_id = read_id(data, pos)
            size, body = read_size(data, pos_after_id)
        except Exception:
            return  # a truncated tail (an interrupted recording): keep what came before
        stop = end if size == UNKNOWN else min(body + size, end)
        if eid in CONTAINERS:
            if eid == TRACK_ENTRY:
                entry: dict[str, object] = {}
                _walk(data, body, stop, out, entry)
                if entry.get("codec") == b"A_OPUS" and "opus_track" not in out:
                    out["opus_track"] = entry.get("number", 1)
                    out["head"] = entry.get("private")
                    out["channels"] = entry.get("channels", 1)
            else:
                _walk(data, body, stop, out, track)
            if size == UNKNOWN:
                return
        elif eid == TRACK_NUMBER:
            track["number"] = int.from_bytes(data[body:stop], "big")
        elif eid == CODEC_ID:
            track["codec"] = data[body:stop]
        elif eid == CODEC_PRIVATE:
            track["private"] = data[body:stop]
        elif eid == CHANNELS:
            track["channels"] = int.from_bytes(data[body:stop], "big")
        elif eid in (SIMPLE_BLOCK, BLOCK):
            blocks = out.setdefault("blocks", [])
            assert isinstance(blocks, list)
            blocks.append(data[body:stop])
        pos = stop


def _frames(blocks: list[bytes], track_number: int) -> list[bytes]:
    packets = []
    for block in blocks:
        number, header_end = read_size(block, 0)  # the track number is a vint like a size
        if number != track_number or len(block) < header_end + 3:
            continue
        flags = block[header_end + 2]
        if flags & 0x06:
            raise RemuxUnsupported("laced blocks")
        packets.append(block[header_end + 3 :])
    return packets


def _opus_head(channels: int) -> bytes:
    return b"OpusHead" + struct.pack("<BBHIhB", 1, channels, 0, 48000, 0, 0)


def _page(packets: list[bytes], granule: int, seq: int, flags: int) -> bytes:
    lacing = bytearray()
    for packet in packets:
        n = len(packet)
        lacing += b"\xff" * (n // 255) + bytes([n % 255])
    if len(lacing) > 255:
        raise RemuxUnsupported("packet too large for one page")
    header = struct.pack("<4sBBqIIIB", b"OggS", 0, flags, granule, SERIAL, seq, 0, len(lacing))
    page = bytearray(header + bytes(lacing) + b"".join(packets))
    struct.pack_into("<I", page, 22, ogg_crc(bytes(page)))
    return bytes(page)


def remux_webm_opus(data: bytes) -> bytes:
    found: dict[str, object] = {}
    _walk(data, 0, len(data), found, {})
    if "opus_track" not in found:
        raise RemuxUnsupported("no Opus track")
    raw_head = found.get("head")
    head = (
        raw_head
        if isinstance(raw_head, bytes) and raw_head.startswith(b"OpusHead")
        else (
            _opus_head(int(found.get("channels", 1) or 1))  # type: ignore[call-overload]
        )
    )
    blocks = found.get("blocks", [])
    assert isinstance(blocks, list)
    packets = _frames(blocks, int(found["opus_track"]))  # type: ignore[call-overload]
    if not packets:
        raise RemuxUnsupported("no audio")
    tags = b"OpusTags" + struct.pack("<I", len(VENDOR)) + VENDOR + struct.pack("<I", 0)
    pages = [_page([head], 0, 0, 0x02), _page([tags], 0, 1, 0)]
    granule = 0
    seq = 2
    for i in range(0, len(packets), PACKETS_PER_PAGE):
        group = packets[i : i + PACKETS_PER_PAGE]
        granule += sum(opus_samples(p) for p in group)
        last = i + PACKETS_PER_PAGE >= len(packets)
        pages.append(_page(group, granule, seq, 0x04 if last else 0))
        seq += 1
    return b"".join(pages)
