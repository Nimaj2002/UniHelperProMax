"""025: trim → save on the real API, SQLite and file system. A failure never damages the
original. The 3-hour case is slow: run with UNIHELPER_SLOW_TESTS=1."""

from __future__ import annotations

import hashlib
import os
import struct
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from tests.audio_real import make_audio
from tests.contract.import_helpers import API, audios_dir, import_audio, make_session, staged_files

pytestmark = pytest.mark.integration


def _sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def _setup(c: TestClient, tmp_path: Path) -> tuple[str, dict, bytes]:  # type: ignore[type-arg]
    key = make_session(c)
    src = tmp_path / "lecture.wav"
    make_audio(src, "wav", "pcm_s16le", 6.0)
    r = import_audio(c, key, "lecture.wav", src.read_bytes())
    assert r.status_code == 201, r.text
    return key, r.json(), src.read_bytes()


def test_failed_overwrite_leaves_original_intact(
    owner_client: TestClient,
    tmp_path: Path,
    tmp_data_dir: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    c = owner_client
    _key, rec, _data = _setup(c, tmp_path)
    original = audios_dir(tmp_data_dir) / rec["fileName"]
    before = _sha(original)

    def boom(*_a: object, **_k: object) -> None:
        raise OSError("disk full")

    monkeypatch.setattr("unihelper.storage.storage_service.StorageService.swap_in_upload", boom)
    with pytest.raises(OSError):
        c.post(
            f"{API}/recordings/{rec['id']}/trim",
            json={"startMs": 1000, "endMs": 3000, "mode": "overwrite"},
            headers={"If-Match": f'"{rec["version"]}"'},
        )
    assert _sha(original) == before
    assert staged_files(tmp_data_dir) == []  # nothing left in staging
    again = c.get(f"{API}/recordings/{rec['id']}").json()
    assert again["version"] == rec["version"] and again["durationMs"] == rec["durationMs"]
    assert c.get(f"{API}/trash").json() == []  # no Trash entry for a failed overwrite


def test_failed_new_save_adds_nothing(
    owner_client: TestClient,
    tmp_path: Path,
    tmp_data_dir: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    c = owner_client
    key, rec, _data = _setup(c, tmp_path)

    def boom(*_a: object, **_k: object) -> None:
        raise OSError("disk full")

    monkeypatch.setattr("unihelper.storage.storage_service.StorageService.commit_upload", boom)
    with pytest.raises(OSError):
        c.post(
            f"{API}/recordings/{rec['id']}/trim",
            json={"startMs": 1000, "endMs": 3000, "mode": "new", "name": "Cut"},
        )
    assert len(c.get(f"{API}/sessions/{key}/recordings").json()) == 1
    assert [p.name for p in audios_dir(tmp_data_dir).iterdir()] == [rec["fileName"]]
    assert staged_files(tmp_data_dir) == []


def test_overwrite_then_peaks_reflect_new_audio(owner_client: TestClient, tmp_path: Path) -> None:
    c = owner_client
    _key, rec, _data = _setup(c, tmp_path)
    before = c.get(f"{API}/recordings/{rec['id']}/peaks").json()["durationMs"]
    r = c.post(
        f"{API}/recordings/{rec['id']}/trim",
        json={"startMs": 0, "endMs": 2000, "mode": "overwrite"},
        headers={"If-Match": f'"{rec["version"]}"'},
    )
    assert r.status_code == 200, r.text
    after = c.get(f"{API}/recordings/{rec['id']}/peaks").json()["durationMs"]
    assert before > 5900 and abs(after - 2000) <= 100


@pytest.mark.slow
@pytest.mark.skipif(
    not os.environ.get("UNIHELPER_SLOW_TESTS"), reason="slow: set UNIHELPER_SLOW_TESTS=1"
)
def test_three_hour_file(owner_client: TestClient, tmp_path: Path) -> None:
    c = owner_client
    key = make_session(c)
    rate, seconds = 8000, 3 * 3600
    data_len = rate * seconds * 2
    head = (
        b"RIFF"
        + struct.pack("<I", 36 + data_len)
        + b"WAVEfmt "
        + struct.pack("<IHHIIHH", 16, 1, 1, rate, rate * 2, 2, 16)
        + b"data"
        + struct.pack("<I", data_len)
    )
    big = tmp_path / "long.wav"
    with open(big, "wb") as fh:
        fh.write(head)
        block = bytes(rate * 2 * 60)
        for _ in range(seconds // 60):
            fh.write(block)
    with open(big, "rb") as fh:
        r = c.post(
            f"{API}/sessions/{key}/recordings/import",
            params={"fileName": "long.wav"},
            content=fh.read(),
            headers={"Content-Type": "application/octet-stream"},
        )
    assert r.status_code == 201, r.text
    rec = r.json()
    t0 = time.monotonic()
    p = c.get(f"{API}/recordings/{rec['id']}/peaks")
    assert p.status_code == 200 and time.monotonic() - t0 < 60
    t0 = time.monotonic()
    t = c.post(
        f"{API}/recordings/{rec['id']}/trim",
        json={"startMs": 600_000, "endMs": 7_200_000, "mode": "new", "name": "Part"},
    )
    assert t.status_code == 201, t.text
    assert time.monotonic() - t0 < 60
