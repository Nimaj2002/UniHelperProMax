"""Recognise an imported audio file and read its duration from headers only (006 research I4).

No decoding and no dependencies: each format's container structure is checked far enough to
reject renamed or truncated files, and the duration is read the way the format records it.
Files are read with seeks (≤ a few MB), never whole — imports can be 1 GB.
"""

from __future__ import annotations

import struct
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO

from unihelper.domain import webm

FORMATS: dict[str, str] = {
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".aac": "audio/aac",
    ".wav": "audio/wav",
    ".ogg": "audio/ogg",
    ".oga": "audio/ogg",
    ".opus": "audio/ogg",
    ".webm": "audio/webm",
    ".flac": "audio/flac",
}
ACCEPTED_EXTENSIONS: tuple[str, ...] = tuple(FORMATS)

_HEAD = 64 * 1024
_TAIL_WINDOW = 64 * 1024
_WEBM_HEAD = 4 * 1024 * 1024
_ADTS_MAX_SCAN = 256 * 1024 * 1024  # 4 h at 128 kbps is ~230 MB of ADTS frames


@dataclass(frozen=True)
class ProbeResult:
    duration_ms: int | None  # None: valid audio, but the file doesn't record its length


def mime_for(file_name: str) -> str | None:
    dot = file_name.rfind(".")
    return FORMATS.get(file_name[dot:].lower()) if dot >= 0 else None


def probe(path: Path, mime: str) -> ProbeResult | None:
    """`None` when the file isn't recognisable audio of the format `mime` claims."""
    try:
        size = path.stat().st_size
        with open(path, "rb") as f:
            reader = _READERS.get(mime)
            if reader is None or size == 0:
                return None
            result = reader(f, size)
    except (OSError, struct.error, ValueError, IndexError):
        return None
    if result is None:
        return None
    if result.duration_ms is not None and result.duration_ms <= 0:
        return None
    return result


def _ms(units: float, rate: float) -> int:
    return round(units * 1000 / rate)


# ---- WAV --------------------------------------------------------------------------------


def _wav(f: BinaryIO, size: int) -> ProbeResult | None:
    head = f.read(12)
    if len(head) < 12 or head[:4] != b"RIFF" or head[8:12] != b"WAVE":
        return None
    byte_rate = 0
    pos = 12
    while pos + 8 <= size:
        f.seek(pos)
        chunk = f.read(8)
        if len(chunk) < 8:
            return None
        cid, csize = chunk[:4], struct.unpack("<I", chunk[4:])[0]
        if cid == b"fmt ":
            fmt = f.read(16)
            if len(fmt) < 16:
                return None
            _tag, channels, rate, byte_rate, _align, _bits = struct.unpack("<HHIIHH", fmt)
            if channels == 0 or rate == 0 or byte_rate == 0:
                return None
        elif cid == b"data":
            if byte_rate == 0:
                return None
            data_size = min(csize, size - pos - 8)  # streamed WAVs may claim 0xFFFFFFFF
            return ProbeResult(_ms(data_size, byte_rate))
        pos += 8 + csize + (csize & 1)
    return None


# ---- FLAC -------------------------------------------------------------------------------


def _flac(f: BinaryIO, size: int) -> ProbeResult | None:
    head = f.read(4 + 4 + 34)
    if (
        len(head) < 42
        or head[:4] != b"fLaC"
        or (head[4] & 0x7F) != 0
        or head[5:8] != b"\x00\x00\x22"
    ):
        return None
    v = int.from_bytes(head[18:26], "big")
    rate = v >> 44
    total = v & ((1 << 36) - 1)
    if rate == 0:
        return None
    return ProbeResult(_ms(total, rate) if total else None)


# ---- OGG --------------------------------------------------------------------------------


def _ogg(f: BinaryIO, size: int) -> ProbeResult | None:
    head = f.read(_HEAD)
    if head[:4] != b"OggS" or len(head) < 28:
        return None
    nsegs = head[26]
    packet = head[27 + nsegs : 27 + nsegs + 64]
    if packet.startswith(b"OpusHead"):
        rate, pre_skip = 48000, struct.unpack("<H", packet[10:12])[0]
    elif packet.startswith(b"\x01vorbis"):
        rate, pre_skip = struct.unpack("<I", packet[12:16])[0], 0
    else:
        return None
    if rate == 0:
        return None
    granule = _last_granule(f, size)
    if granule is None or granule <= pre_skip:
        return ProbeResult(None)
    return ProbeResult(_ms(granule - pre_skip, rate))


def _last_granule(f: BinaryIO, size: int) -> int | None:
    end = size
    while end > 0:
        start = max(0, end - _TAIL_WINDOW)
        f.seek(start)
        window = f.read(end - start + 27)  # overlap so a page header across windows is seen
        i = window.rfind(b"OggS")
        while i != -1:
            if i + 14 <= len(window) and window[i + 4] == 0:
                granule: int = struct.unpack("<q", window[i + 6 : i + 14])[0]
                if granule >= 0:
                    return granule
            i = window.rfind(b"OggS", 0, i)
        if start == 0:
            return None
        end = start
    return None


# ---- M4A --------------------------------------------------------------------------------


def _boxes(f: BinaryIO, start: int, end: int):  # type: ignore[no-untyped-def]
    pos = start
    while pos + 8 <= end:
        f.seek(pos)
        h = f.read(8)
        if len(h) < 8:
            return
        bsize, kind = struct.unpack(">I", h[:4])[0], h[4:]
        header = 8
        if bsize == 1:
            bsize = struct.unpack(">Q", f.read(8))[0]
            header = 16
        elif bsize == 0:
            bsize = end - pos
        if bsize < header:
            return
        yield kind, pos + header, min(pos + bsize, end)
        pos += bsize


def _m4a(f: BinaryIO, size: int) -> ProbeResult | None:
    first = next(iter(_boxes(f, 0, size)), None)
    if first is None or first[0] != b"ftyp":
        return None
    for kind, body, end in _boxes(f, 0, size):
        if kind != b"moov":
            continue
        for sub, sbody, _send in _boxes(f, body, end):
            if sub != b"mvhd":
                continue
            f.seek(sbody)
            version = f.read(1)[0]
            if version == 1:
                f.seek(sbody + 4 + 16)
                timescale, duration = struct.unpack(">IQ", f.read(12))
            else:
                f.seek(sbody + 4 + 8)
                timescale, duration = struct.unpack(">II", f.read(8))
            if timescale == 0:
                return None
            return ProbeResult(_ms(duration, timescale))
        return None
    return None


# ---- AAC (ADTS) -------------------------------------------------------------------------

_ADTS_RATES = (96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000)


def _adts_header(h: bytes) -> tuple[int, int] | None:
    """(frame length, sample rate) of a valid ADTS header, else None."""
    if len(h) < 7 or h[0] != 0xFF or (h[1] & 0xF6) != 0xF0:  # sync + layer 00
        return None
    idx = (h[2] >> 2) & 0x0F
    length = ((h[3] & 0x03) << 11) | (h[4] << 3) | (h[5] >> 5)
    if idx >= len(_ADTS_RATES) or length < 7:
        return None
    return length, _ADTS_RATES[idx]


def _aac(f: BinaryIO, size: int) -> ProbeResult | None:
    first = _adts_header(f.read(7))
    if first is None:
        return None
    rate = first[1]
    frames, pos = 0, 0
    limit = min(size, _ADTS_MAX_SCAN)
    while pos + 7 <= limit:
        f.seek(pos)
        hdr = _adts_header(f.read(7))
        if hdr is None:
            break
        frames += 1
        pos += hdr[0]
    if frames == 0:
        return None
    if pos < size and limit < size:  # very long file: extrapolate from the scanned part
        frames = round(frames * size / pos)
    return ProbeResult(_ms(frames * 1024, rate))


# ---- MP3 --------------------------------------------------------------------------------

_MP3_BITRATES = {
    (3, 1): (0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320),  # MPEG-1 L3
    (2, 1): (0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160),  # MPEG-2/2.5 L3
}
_MP3_RATES = {3: (44100, 48000, 32000), 2: (22050, 24000, 16000), 0: (11025, 12000, 8000)}


@dataclass
class _Mp3Frame:
    version: int  # 3 = MPEG-1, 2 = MPEG-2, 0 = MPEG-2.5
    kbps: int
    rate: int
    mono: bool
    length: int

    @property
    def samples(self) -> int:
        return 1152 if self.version == 3 else 576


def _mp3_frame(h: bytes) -> _Mp3Frame | None:
    if len(h) < 4 or h[0] != 0xFF or (h[1] & 0xE0) != 0xE0:
        return None
    version = (h[1] >> 3) & 0x03
    layer = (h[1] >> 1) & 0x03
    br_idx = h[2] >> 4
    sr_idx = (h[2] >> 2) & 0x03
    if version == 1 or layer != 1 or br_idx in (0, 15) or sr_idx == 3:
        return None  # only layer III, no free-format
    kbps = _MP3_BITRATES[(3 if version == 3 else 2, 1)][br_idx]
    rate = _MP3_RATES[version][sr_idx]
    padding = (h[2] >> 1) & 1
    coef = 144 if version == 3 else 72
    return _Mp3Frame(version, kbps, rate, (h[3] >> 6) == 3, coef * kbps * 1000 // rate + padding)


def _mp3(f: BinaryIO, size: int) -> ProbeResult | None:
    head = f.read(10)
    start = 0
    if head[:3] == b"ID3" and len(head) == 10:
        start = 10 + ((head[6] << 21) | (head[7] << 14) | (head[8] << 7) | head[9])
        if head[5] & 0x10:
            start += 10  # footer
    f.seek(start)
    buf = f.read(_HEAD)
    i = 0
    while i + 4 <= len(buf):
        frame = _mp3_frame(buf[i : i + 4])
        if frame is not None:
            nxt = buf[i + frame.length : i + frame.length + 4]
            if len(nxt) < 4 or _mp3_frame(nxt) is not None:  # two frames in a row: real sync
                break
        i += 1
    else:
        return None
    if frame is None:
        return None
    side = (17 if frame.mono else 32) if frame.version == 3 else (9 if frame.mono else 17)
    body = buf[i + 4 : i + frame.length]
    for tag in (b"Xing", b"Info"):
        if body[side : side + 4] == tag:
            flags = struct.unpack(">I", body[side + 4 : side + 8])[0]
            if flags & 0x1:
                frames = struct.unpack(">I", body[side + 8 : side + 12])[0]
                return ProbeResult(_ms(frames * frame.samples, frame.rate))
    if body[32 : 32 + 4] == b"VBRI":
        frames = struct.unpack(">I", body[32 + 14 : 32 + 18])[0]
        return ProbeResult(_ms(frames * frame.samples, frame.rate))
    audio_bytes = size - start - i
    return ProbeResult(round(audio_bytes * 8 / frame.kbps))  # CBR estimate (kbps → ms)


# ---- WebM -------------------------------------------------------------------------------


def _webm(f: BinaryIO, size: int) -> ProbeResult | None:
    head = f.read(min(size, _WEBM_HEAD))
    if head[:4] != b"\x1a\x45\xdf\xa3":
        return None
    try:
        layout = webm.analyse(head)
    except webm.WebmError:
        return None
    for eid, raw in layout.info_children:
        if eid == webm.DURATION:
            _id, p = webm.read_id(raw, 0)
            dsize, p = webm.read_size(raw, p)
            fmt = ">f" if dsize == 4 else ">d"
            ticks = struct.unpack(fmt, raw[p : p + dsize])[0]
            return ProbeResult(round(ticks * layout.timecode_scale / 1_000_000))
    if size <= _WEBM_HEAD:
        return ProbeResult(layout.duration_ms)  # the whole file was analysed
    return ProbeResult(None)  # long file without a Duration element: browser value is used


_READERS = {
    "audio/wav": _wav,
    "audio/flac": _flac,
    "audio/ogg": _ogg,
    "audio/mp4": _m4a,
    "audio/aac": _aac,
    "audio/mpeg": _mp3,
    "audio/webm": _webm,
}
