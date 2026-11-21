"""025: trim range rules, packet-copy trim and waveform peaks on real generated audio."""

from __future__ import annotations

from pathlib import Path

import av
import pytest

from tests.audio_real import make_audio
from unihelper.domain import audio_edit
from unihelper.domain.audio_edit import AudioEditError, InvalidRange

pytestmark = pytest.mark.unit

# (extension, muxer, codec)
FORMATS = [
    (".wav", "wav", "pcm_s16le"),
    (".mp3", "mp3", "libmp3lame"),
    (".ogg", "ogg", "libopus"),
    (".webm", "webm", "libopus"),
    (".m4a", "mp4", "aac"),
    (".flac", "flac", "flac"),
]


def duration_ms(path: Path) -> int:
    return round(audio_edit.compute_peaks(path, 100).duration_ms)


def test_validate_range() -> None:
    audio_edit.validate_range(1000, 5000, 10000)
    for bad in [
        (-1, 500, 10000),
        (5, 5, 10000),
        (0, 10001, 10000),
        (1000, 1050, 10000),
        (0, 10000, 10000),
    ]:
        with pytest.raises(InvalidRange):
            audio_edit.validate_range(*bad)


@pytest.mark.parametrize(("ext", "muxer", "codec"), FORMATS)
def test_trim_copy_length(tmp_path: Path, ext: str, muxer: str, codec: str) -> None:
    src = tmp_path / f"a{ext}"
    if codec not in av.codecs_available:
        pytest.skip(f"{codec} encoder missing in this FFmpeg build")
    make_audio(src, muxer, codec, 6.0)
    dst = tmp_path / f"b{ext}.out"
    got = audio_edit.trim_copy(src, dst, 1000, 4000, ext)
    assert abs(got - 3000) <= 100
    assert abs(duration_ms(dst) - 3000) <= 150


def test_peaks_shape_and_loudness(tmp_path: Path) -> None:
    src = tmp_path / "a.wav"
    make_audio(src, "wav", "pcm_s16le", 4.0, loud_from=2.0)
    p = audio_edit.compute_peaks(src, 40)
    assert len(p.peaks) == 40
    assert abs(p.duration_ms - 4000) <= 50
    assert max(p.peaks[:15]) < 0.01 and min(p.peaks[25:]) > 0.1
    assert all(0 <= v <= 1 for v in p.peaks)


def test_unreadable_and_unsupported(tmp_path: Path) -> None:
    bad = tmp_path / "x.mp3"
    bad.write_bytes(b"not audio at all")
    with pytest.raises(AudioEditError):
        audio_edit.compute_peaks(bad, 10)
    with pytest.raises(AudioEditError):
        audio_edit.trim_copy(bad, tmp_path / "y.mp3", 0, 500, ".mp3")
    with pytest.raises(AudioEditError):
        audio_edit.trim_copy(bad, tmp_path / "y.xyz", 0, 500, ".xyz")


def test_sparse_peaks_match_full(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Long files are sampled (025): the picture matches the full decode."""
    src = tmp_path / "a.mp3"
    make_audio(src, "mp3", "libmp3lame", 30.0, loud_from=15.0)
    full = audio_edit.compute_peaks(src, 60)
    monkeypatch.setattr(audio_edit, "SPARSE_MIN_S", 1)
    sparse = audio_edit.compute_peaks(src, 60)
    assert len(sparse.peaks) == 60 and abs(sparse.duration_ms - full.duration_ms) <= 100
    assert max(sparse.peaks[:25]) < 0.05 and min(sparse.peaks[35:]) > 0.1
    assert max(abs(a - b) for a, b in zip(sparse.peaks, full.peaks, strict=True)) < 0.1


def test_validate_ranges() -> None:
    assert audio_edit.validate_ranges([(5000, 6000), (1000, 2000)], 10000) == [
        (1000, 2000),
        (5000, 6000),
    ]
    assert audio_edit.validate_ranges([(1000, 2000), (2000, 3000)], 10000)  # touching is fine
    for bad in ([], [(0, 10000)], [(1000, 3000), (2000, 4000)], [(1000, 1050)], [(9000, 10001)]):
        with pytest.raises(InvalidRange):
            audio_edit.validate_ranges(bad, 10000)
    with pytest.raises(InvalidRange):
        audio_edit.validate_ranges([(i * 100, i * 100 + 100) for i in range(21)], 100000)


@pytest.mark.parametrize(("ext", "muxer", "codec"), FORMATS)
def test_trim_copy_ranges_joins_windows(tmp_path: Path, ext: str, muxer: str, codec: str) -> None:
    if codec not in av.codecs_available:
        pytest.skip(f"{codec} encoder missing in this FFmpeg build")
    src = tmp_path / f"a{ext}"
    make_audio(src, muxer, codec, 10.0, loud_from=6.0)
    dst = tmp_path / f"m{ext}.out"
    got = audio_edit.trim_copy_ranges(src, dst, [(1000, 3000), (5000, 8000)], ext)
    assert abs(got - 5000) <= 200
    assert abs(duration_ms(dst) - 5000) <= 250
