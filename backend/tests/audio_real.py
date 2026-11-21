"""Real encoded audio for 025 tests (tones made with PyAV; no numpy needed)."""

from __future__ import annotations

import math
from array import array
from fractions import Fraction
from pathlib import Path

import av
from av.audio.frame import AudioFrame


def make_audio(path: Path, muxer: str, codec: str, seconds: float, loud_from: float = 0.0) -> None:
    """A 48 kHz tone; silent before `loud_from` seconds."""
    rate = 48000
    with av.open(str(path), "w", format=muxer) as out:
        stream = out.add_stream(codec, rate=rate)
        stream.layout = "mono"
        size = 960
        t = 0
        while t < int(seconds * rate):
            n = size
            samples = [
                int(12000 * math.sin(2 * math.pi * 440 * (t + i) / rate))
                if (t + i) / rate >= loud_from
                else 0
                for i in range(n)
            ]
            frame = AudioFrame(format="s16", layout="mono", samples=n)
            frame.planes[0].update(array("h", samples).tobytes())
            frame.sample_rate = rate
            frame.pts = t
            frame.time_base = Fraction(1, rate)
            for packet in stream.encode(frame):
                out.mux(packet)
            t += n
        for packet in stream.encode(None):
            out.mux(packet)
