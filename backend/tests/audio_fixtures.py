"""Generate small, structurally valid audio files of a given duration (006 import tests).

Only the parts `domain/audio_probe.py` reads are realistic (headers, frame headers, page
granules, boxes); payloads are filler. WebM comes from `tests/webm_fixture.py`.
"""

from __future__ import annotations

import struct

# ---- WAV --------------------------------------------------------------------------------


def wav(ms: int, rate: int = 16000, channels: int = 1) -> bytes:
    bits = 16
    block_align = channels * bits // 8
    byte_rate = rate * block_align
    frames = rate * ms // 1000
    data = bytes(frames * block_align)
    fmt = struct.pack("<HHIIHH", 1, channels, rate, byte_rate, block_align, bits)
    body = b"WAVE" + b"fmt " + struct.pack("<I", len(fmt)) + fmt
    body += b"data" + struct.pack("<I", len(data)) + data
    return b"RIFF" + struct.pack("<I", len(body)) + body


# ---- FLAC -------------------------------------------------------------------------------


def flac(ms: int, rate: int = 44100, channels: int = 2, bps: int = 16) -> bytes:
    total = rate * ms // 1000
    bits = (
        (4096 << 64)  # min block size (16)
        | (4096 << 48)  # max block size (16)
        | (0 << 24)  # min frame size (24)
        | 0  # max frame size (24)
    )
    head = bits.to_bytes(10, "big")
    tail = (rate << 44) | ((channels - 1) << 41) | ((bps - 1) << 36) | total
    info = head + tail.to_bytes(8, "big") + bytes(16)  # + MD5
    assert len(info) == 34
    block = bytes([0x80 | 0]) + len(info).to_bytes(3, "big") + info  # last block, STREAMINFO
    frames = (b"\xff\xf8\x69\x08\x00\x00" + bytes(64)) * 4  # frame-sync'ed filler
    return b"fLaC" + block + frames


# ---- OGG --------------------------------------------------------------------------------

_CRC_TABLE: list[int] = []
for _i in range(256):
    _r = _i << 24
    for _ in range(8):
        _r = ((_r << 1) ^ 0x04C11DB7) if _r & 0x80000000 else (_r << 1)
    _CRC_TABLE.append(_r & 0xFFFFFFFF)


def _ogg_crc(data: bytes) -> int:
    crc = 0
    for b in data:
        crc = ((crc << 8) & 0xFFFFFFFF) ^ _CRC_TABLE[((crc >> 24) & 0xFF) ^ b]
    return crc


def _ogg_page(
    packet: bytes, granule: int, seq: int, header_type: int = 0, serial: int = 0x1234
) -> bytes:
    segs = []
    n = len(packet)
    while n >= 255:
        segs.append(255)
        n -= 255
    segs.append(n)
    head = (
        b"OggS"
        + bytes([0, header_type])
        + struct.pack("<qII", granule, serial, seq)
        + b"\x00\x00\x00\x00"
        + bytes([len(segs)])
        + bytes(segs)
    )
    page = head + packet
    crc = _ogg_crc(page)
    return page[:22] + struct.pack("<I", crc) + page[26:]


def _ogg(id_packet: bytes, comment_packet: bytes, final_granule: int, pages: int = 5) -> bytes:
    out = _ogg_page(id_packet, 0, 0, header_type=0x02)
    out += _ogg_page(comment_packet, 0, 1)
    for i in range(pages):
        granule = final_granule * (i + 1) // pages
        last = i == pages - 1
        out += _ogg_page(bytes([i % 251]) * 120, granule, 2 + i, header_type=0x04 if last else 0)
    return out


def ogg_opus(ms: int, pre_skip: int = 312) -> bytes:
    head = b"OpusHead" + struct.pack("<BBHIhB", 1, 1, pre_skip, 48000, 0, 0)
    tags = b"OpusTags" + struct.pack("<I", 4) + b"test" + struct.pack("<I", 0)
    return _ogg(head, tags, pre_skip + 48 * ms)


def ogg_vorbis(ms: int, rate: int = 44100) -> bytes:
    ident = b"\x01vorbis" + struct.pack("<IBIiiiBB", 0, 2, rate, 0, 128000, 0, 0xB8, 1)
    comment = b"\x03vorbis" + struct.pack("<I", 4) + b"test" + struct.pack("<I", 0) + b"\x01"
    return _ogg(ident, comment, rate * ms // 1000)


# ---- AAC (ADTS) -------------------------------------------------------------------------

_ADTS_RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000]


def adts_aac(ms: int, rate: int = 44100, payload: int = 40) -> bytes:
    idx = _ADTS_RATES.index(rate)
    frames = round(rate * ms / 1000 / 1024)
    length = 7 + payload
    header = (
        (0xFFF << 44)
        | (0 << 43)  # MPEG-4
        | (0 << 41)  # layer
        | (1 << 40)  # protection absent
        | (1 << 38)  # profile: AAC LC
        | (idx << 34)
        | (1 << 30)  # channel configuration: mono
        | (length << 13)
        | (0x7FF << 2)
    ).to_bytes(7, "big")
    return (header + bytes(payload)) * frames


# ---- MP3 --------------------------------------------------------------------------------


def _id3(size: int = 64) -> bytes:
    ss = bytes([(size >> 21) & 0x7F, (size >> 14) & 0x7F, (size >> 7) & 0x7F, size & 0x7F])
    return b"ID3\x04\x00\x00" + ss + bytes(size)


_MP3_BITRATES = {32: 1, 64: 5, 128: 9, 192: 11, 320: 14}  # MPEG-1 layer III kbps → index


def _mp3_frame(kbps: int, rate: int = 44100, body: bytes = b"") -> bytes:
    rate_idx = {44100: 0, 48000: 1, 32000: 2}[rate]
    header = (
        (0x7FF << 21)
        | (0b11 << 19)  # MPEG-1
        | (0b01 << 17)  # layer III
        | (1 << 16)  # no CRC
        | (_MP3_BITRATES[kbps] << 12)
        | (rate_idx << 10)
        | (0b11 << 6)  # mono
    ).to_bytes(4, "big")
    size = 144 * kbps * 1000 // rate
    return header + body.ljust(size - 4, b"\x00")


def mp3_cbr(ms: int, kbps: int = 128, rate: int = 44100) -> bytes:
    frames = round(rate * ms / 1000 / 1152)
    return _id3() + _mp3_frame(kbps, rate) * frames


def mp3_xing(ms: int, rate: int = 44100) -> bytes:
    frames = round(rate * ms / 1000 / 1152)
    side_info = bytes(17)  # MPEG-1 mono
    xing = _mp3_frame(128, rate, side_info + b"Xing" + struct.pack(">II", 0x1, frames))
    audio = b"".join(_mp3_frame(64 if i % 3 else 192, rate) for i in range(frames))  # VBR
    return _id3() + xing + audio


# ---- M4A --------------------------------------------------------------------------------


def _box(kind: bytes, payload: bytes) -> bytes:
    return struct.pack(">I", 8 + len(payload)) + kind + payload


def m4a(ms: int, moov_at_end: bool = False, timescale: int = 44100) -> bytes:
    ftyp = _box(b"ftyp", b"M4A " + struct.pack(">I", 0) + b"M4A isom")
    mvhd = (
        struct.pack(">IIIII", 0, 0, 0, timescale, timescale * ms // 1000)
        + struct.pack(">IH", 0x00010000, 0x0100)
        + bytes(10)
        + bytes(36)
        + bytes(24)
        + struct.pack(">I", 2)
    )
    moov = _box(b"moov", _box(b"mvhd", mvhd))
    mdat = _box(b"mdat", bytes(2048))
    return ftyp + (mdat + moov if moov_at_end else moov + mdat)


# ---- broken inputs ----------------------------------------------------------------------


def truncated(data: bytes, keep: int = 10) -> bytes:
    return data[:keep]


def renamed_pdf() -> bytes:
    return b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n1 0 obj << /Type /Catalog >> endobj\n" + bytes(512)
