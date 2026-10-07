"""audio_probe recognises each import format and reads its duration from headers (T007)."""

from __future__ import annotations

import random
from collections.abc import Callable
from pathlib import Path

import pytest

from tests import audio_fixtures as fx
from tests.webm_fixture import make_webm
from unihelper.domain import webm
from unihelper.domain.audio_probe import ACCEPTED_EXTENSIONS, FORMATS, mime_for, probe

pytestmark = pytest.mark.unit


def _write(tmp_path: Path, data: bytes, name: str = "a.bin") -> Path:
    path = tmp_path / name
    path.write_bytes(data)
    return path


CASES: list[tuple[str, str, Callable[[int], bytes], float]] = [
    ("wav", "audio/wav", fx.wav, 50),
    ("flac", "audio/flac", fx.flac, 50),
    ("opus", "audio/ogg", fx.ogg_opus, 50),
    ("vorbis", "audio/ogg", fx.ogg_vorbis, 50),
    ("aac", "audio/aac", fx.adts_aac, 50),
    ("mp3-xing", "audio/mpeg", fx.mp3_xing, 50),
    ("m4a", "audio/mp4", fx.m4a, 50),
]


@pytest.mark.parametrize(("label", "mime", "make", "tolerance"), CASES, ids=[c[0] for c in CASES])
@pytest.mark.parametrize("ms", [1500, 61_000])
def test_duration_per_format(
    tmp_path: Path, label: str, mime: str, make: Callable[[int], bytes], tolerance: float, ms: int
) -> None:
    result = probe(_write(tmp_path, make(ms)), mime)
    assert result is not None
    assert result.duration_ms is not None
    assert abs(result.duration_ms - ms) <= tolerance


def test_mp3_cbr_estimate_within_two_percent(tmp_path: Path) -> None:
    result = probe(_write(tmp_path, fx.mp3_cbr(90_000)), "audio/mpeg")
    assert result is not None and result.duration_ms is not None
    assert abs(result.duration_ms - 90_000) <= 90_000 * 0.02


def test_m4a_with_moov_after_mdat(tmp_path: Path) -> None:
    result = probe(_write(tmp_path, fx.m4a(42_000, moov_at_end=True)), "audio/mp4")
    assert result is not None and result.duration_ms == 42_000


def test_webm_without_duration_element(tmp_path: Path) -> None:
    result = probe(_write(tmp_path, make_webm(3)), "audio/webm")
    assert result is not None and result.duration_ms is not None
    assert abs(result.duration_ms - 3000) <= 50


def test_finalized_webm_reads_the_duration_element(tmp_path: Path) -> None:
    data, duration = webm.finalize(make_webm(5))
    result = probe(_write(tmp_path, data), "audio/webm")
    assert result is not None and result.duration_ms == duration


def test_flac_without_total_samples_is_audio_of_unknown_length(tmp_path: Path) -> None:
    result = probe(_write(tmp_path, fx.flac(0)), "audio/flac")
    assert result is not None and result.duration_ms is None


BROKEN = [
    ("truncated-wav", fx.truncated(fx.wav(1000)), "audio/wav"),
    ("truncated-flac", fx.truncated(fx.flac(1000)), "audio/flac"),
    ("truncated-m4a", fx.truncated(fx.m4a(1000)), "audio/mp4"),
    ("truncated-ogg", fx.truncated(fx.ogg_opus(1000)), "audio/ogg"),
    ("pdf-as-mp3", fx.renamed_pdf(), "audio/mpeg"),
    ("pdf-as-webm", fx.renamed_pdf(), "audio/webm"),
    ("wav-as-flac", fx.wav(1000), "audio/flac"),
    ("mp3-as-aac", fx.mp3_cbr(1000), "audio/aac"),
    ("empty", b"", "audio/wav"),
    ("random", random.Random(6).randbytes(4096), "audio/mpeg"),
    ("unknown-mime", fx.wav(1000), "audio/x-unknown"),
]


@pytest.mark.parametrize(("label", "data", "mime"), BROKEN, ids=[b[0] for b in BROKEN])
def test_rejects_files_that_are_not_that_format(
    tmp_path: Path, label: str, data: bytes, mime: str
) -> None:
    assert probe(_write(tmp_path, data), mime) is None


def test_missing_file_is_not_audio(tmp_path: Path) -> None:
    assert probe(tmp_path / "nope.wav", "audio/wav") is None


def test_formats_match_research_table() -> None:
    assert FORMATS == {
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
    assert ACCEPTED_EXTENSIONS == tuple(FORMATS)
    assert mime_for("Lecture 3.MP3") == "audio/mpeg"
    assert mime_for("notes.pdf") is None
    assert mime_for(".mp3") == "audio/mpeg"  # empty name: imported as "Imported audio"
    assert mime_for("lecture") is None
