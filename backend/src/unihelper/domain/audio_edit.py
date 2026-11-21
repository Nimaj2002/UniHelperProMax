"""Audio editing without re-encoding (025): validate a trim range, copy a range of packets into a
new file, and compute waveform peaks. Uses PyAV (FFmpeg bindings); nothing here touches the
database or the user file tree."""

from __future__ import annotations

from array import array
from dataclasses import dataclass
from pathlib import Path

import av
from av.audio.resampler import AudioResampler

MIN_RANGE_MS = 100
PEAK_RATE = 8000  # Hz the waveform is analysed at: cheap, plenty for a picture

# output container per file extension (the staging file's own extension is ".part")
_MUXERS = {
    ".webm": "webm",
    ".mp3": "mp3",
    ".m4a": "mp4",
    ".ogg": "ogg",
    ".oga": "ogg",
    ".opus": "ogg",
    ".wav": "wav",
    ".flac": "flac",
    ".aac": "adts",
}


class AudioEditError(Exception):
    """The audio can't be read or written."""


class InvalidRange(ValueError):
    """The requested range is not a valid trim."""


@dataclass(frozen=True)
class Peaks:
    duration_ms: int
    peaks: list[float]  # one value per bucket, 0..1


def validate_range(start_ms: int, end_ms: int, duration_ms: int) -> None:
    """Valid only if 0 <= start < end <= duration, at least MIN_RANGE_MS long, and not the whole
    audio (nothing to trim)."""
    if start_ms < 0 or end_ms > duration_ms or start_ms >= end_ms:
        raise InvalidRange("The selected range is outside the audio.")
    if end_ms - start_ms < MIN_RANGE_MS:
        raise InvalidRange("The selected range is too short.")
    if start_ms == 0 and end_ms == duration_ms:
        raise InvalidRange("Nothing to trim: the whole audio is selected.")


def duration_ms(src: Path) -> int:
    """Length from the container header, or by decoding when the container doesn't record it."""
    try:
        with av.open(str(src)) as inp:
            if inp.duration:
                return round(inp.duration / 1000)  # microseconds
    except av.error.FFmpegError as err:
        raise AudioEditError(str(err)) from err
    return compute_peaks(src, 50).duration_ms


MAX_RANGES = 20


def validate_ranges(ranges: list[tuple[int, int]], duration_ms: int) -> list[tuple[int, int]]:
    """The windows to keep, sorted. Each must be valid on its own, they must not overlap, and one
    window covering the whole audio is nothing to trim. Returns the sorted list."""
    if not ranges or len(ranges) > MAX_RANGES:
        raise InvalidRange(f"Keep between 1 and {MAX_RANGES} windows.")
    ordered = sorted(ranges)
    for start, end in ordered:
        if start < 0 or end > duration_ms or start >= end:
            raise InvalidRange("A window is outside the audio.")
        if end - start < MIN_RANGE_MS:
            raise InvalidRange("A window is too short.")
    for (_, prev_end), (start, _) in zip(ordered, ordered[1:], strict=False):
        if start < prev_end:
            raise InvalidRange("Windows must not overlap.")
    if len(ordered) == 1 and ordered[0] == (0, duration_ms):
        raise InvalidRange("Nothing to trim: the whole audio is selected.")
    return ordered


def trim_copy(src: Path, dst: Path, start_ms: int, end_ms: int, ext: str) -> int:
    """One window: see `trim_copy_ranges`."""
    return trim_copy_ranges(src, dst, [(start_ms, end_ms)], ext)


def trim_copy_ranges(src: Path, dst: Path, ranges: list[tuple[int, int]], ext: str) -> int:
    """Copy the packets of the (sorted, non-overlapping) windows from src into dst, joined in
    order, same codec, no re-encode. Cuts fall on codec-frame boundaries (about 20-30 ms).
    Returns the new duration in ms.
    shortcut: reads packets from the start instead of seeking (WebM from MediaRecorder has no
    index); upgrade to seek-first if multi-hour trims prove slow. Joins between windows are
    packet-exact but not crossfaded (an MP3 join can click)."""
    muxer = _MUXERS.get(ext.lower())
    if muxer is None:
        raise AudioEditError(f"Can't write {ext} files.")
    windows = [(a / 1000, b / 1000) for a, b in ranges]
    try:
        with av.open(str(src)) as inp, av.open(str(dst), "w", format=muxer) as out:
            in_stream = inp.streams.audio[0]
            out_stream = out.add_stream_from_template(in_stream)
            tb = float(in_stream.time_base or 0)
            if not tb:
                raise AudioEditError("The audio has no timing information.")
            idx = 0
            base: int | None = None  # pts of the first packet written from this window
            offset = 0  # output ticks already written by earlier windows
            written = 0.0  # seconds written by earlier windows
            cur = 0.0  # seconds written from this window
            prev: float | None = None
            any_packet = False
            for packet in inp.demux(in_stream):
                if packet.pts is None or packet.size == 0:
                    continue
                t = packet.pts * tb
                while idx < len(windows) and t >= windows[idx][1]:
                    written += cur
                    cur, base, prev = 0.0, None, None
                    idx += 1
                if idx >= len(windows):
                    break
                if t < windows[idx][0]:
                    continue
                if base is None:
                    base = packet.pts
                    offset = round(written / tb)
                dur = packet.duration * tb if packet.duration else (t - prev if prev else 0.02)
                prev = t
                cur = t - base * tb + dur
                packet.pts = packet.pts - base + offset
                if packet.dts is not None:
                    packet.dts = packet.dts - base + offset
                packet.stream = out_stream
                out.mux(packet)
                any_packet = True
            if not any_packet:
                raise AudioEditError("No audio in the selected range.")
    except av.error.FFmpegError as err:
        raise AudioEditError(str(err)) from err
    return round((written + cur) * 1000)


SPARSE_MIN_S = 300  # from 5 minutes on, listen to a slice of each bar instead of all of it
SPARSE_BURST = (0.1, 0.5)  # seconds decoded per bar: a quarter of the bar, within these limits


def compute_peaks(src: Path, buckets: int) -> Peaks:
    """Waveform in `buckets` values (max absolute level 0..1), decoded as a stream so a
    multi-hour file never sits in memory. Long files are sampled: every packet is read (cheap)
    but only the start of each bar is decoded, which is several times faster and still draws the
    same picture (shortcut: loud transients between samples can be missed)."""
    try:
        with av.open(str(src)) as inp:
            stream = inp.streams.audio[0]
            seconds = inp.duration / 1_000_000 if inp.duration else 0.0
            if seconds >= SPARSE_MIN_S:
                return _sparse_peaks(inp, stream, seconds, buckets)
            return _full_peaks(inp, stream, buckets)
    except av.error.FFmpegError as err:
        raise AudioEditError(str(err)) from err


def _full_peaks(
    inp: av.container.InputContainer, stream: av.audio.stream.AudioStream, buckets: int
) -> Peaks:
    frames: list[tuple[int, float]] = []  # (samples, loudest sample) per decoded frame
    resampler = AudioResampler(format="flt", layout="mono", rate=PEAK_RATE)
    for decoded in inp.decode(stream):
        for frame in resampler.resample(decoded):
            _add(frames, frame)
    for frame in resampler.resample(None):
        _add(frames, frame)
    total = sum(n for n, _ in frames)
    if total == 0:
        raise AudioEditError("The audio has no samples.")
    peaks = [0.0] * buckets
    pos = 0
    for n, level in frames:
        mid = pos + n // 2  # a frame (~1k samples) is far smaller than a bucket
        i = min(buckets - 1, mid * buckets // total)
        peaks[i] = max(peaks[i], level)
        pos += n
    return Peaks(duration_ms=round(total * 1000 / PEAK_RATE), peaks=peaks)


def _sparse_peaks(
    inp: av.container.InputContainer,
    stream: av.audio.stream.AudioStream,
    seconds: float,
    buckets: int,
) -> Peaks:
    tb = float(stream.time_base or 0)
    if not tb:
        raise AudioEditError("The audio has no timing information.")
    bar = seconds / buckets
    burst = min(SPARSE_BURST[1], max(SPARSE_BURST[0], bar / 4))
    peaks = [0.0] * buckets
    resampler = AudioResampler(format="flt", layout="mono", rate=PEAK_RATE)
    decoding = False
    for packet in inp.demux(stream):
        if packet.pts is None or packet.size == 0:
            continue
        t = packet.pts * tb
        i = min(buckets - 1, max(0, int(t / bar)))
        if t - i * bar >= burst:
            decoding = False
            continue
        if not decoding:  # a new slice: the decoder starts fresh
            stream.codec_context.flush_buffers()
            decoding = True
        for decoded in packet.decode():
            for frame in resampler.resample(decoded):
                level = _level(frame)
                if level > peaks[i]:
                    peaks[i] = level
    if not any(peaks):
        raise AudioEditError("The audio has no samples.")
    return Peaks(duration_ms=round(seconds * 1000), peaks=peaks)


def _level(frame: av.AudioFrame) -> float:
    n = frame.samples
    if n == 0:
        return 0.0
    samples = array("f")
    samples.frombytes(bytes(frame.planes[0])[: n * 4])
    return min(1.0, max(max(samples), -min(samples)))


def _add(frames: list[tuple[int, float]], frame: av.AudioFrame) -> None:
    if frame.samples:
        frames.append((frame.samples, _level(frame)))
