"""014 T031: an endpoint key never appears in a log record, a response body or a file — even
when the provider echoes it back in an error (FR-019, SC-005)."""

from __future__ import annotations

import logging
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from tests import fake_llm
from tests.contract.ai_helpers import API, BASES, create_endpoint

pytestmark = pytest.mark.integration
KEY = "sk-test-LEAKCHECK-1234567890"


def test_key_never_leaks(
    owner_client: TestClient, tmp_data_dir: Path, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.DEBUG)
    c = owner_client
    bodies: list[str] = []
    ep = create_endpoint(c, "openai", api_key=KEY)
    bodies.append(str(ep))
    url = f"{API}/ai/endpoints/{ep['id']}"
    for r in (
        c.get(f"{API}/ai/endpoints"),
        c.get(url),
        c.post(
            f"{API}/ai/endpoints/test",
            json={"style": "openai", "baseUrl": BASES["openai"], "useSavedKeyOf": ep["id"]},
        ),
        # the fake answers 401 and echoes the key it was given in its error message
        c.post(
            f"{API}/ai/endpoints/test",
            json={
                "style": "openai",
                "baseUrl": BASES["openai"],
                "apiKey": KEY,
                "modelId": "fail-401",
            },
        ),
        c.post(
            f"{API}/ai/endpoints/models/discover",
            json={"style": "openai", "baseUrl": BASES["openai"], "useSavedKeyOf": ep["id"]},
        ),
        c.patch(url, json={"name": "Renamed"}, headers={"If-Match": str(ep["version"])}),
    ):
        assert r.status_code < 500, r.text
        bodies.append(r.text)
    assert fake_llm.STATE["last"]["headers"]["authorization"] == f"Bearer {KEY}"  # it was used
    for body in bodies:
        assert KEY not in body
    assert KEY not in caplog.text
    for record in caplog.records:
        assert KEY not in record.getMessage()
    for path in tmp_data_dir.rglob("*"):
        if path.is_file():
            assert KEY.encode() not in path.read_bytes(), path
