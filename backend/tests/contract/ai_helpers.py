"""Helpers for the 014 AI endpoint and chat tests: endpoints on the fake LLM (tests/fake_llm.py)."""

from __future__ import annotations

from typing import Any

from fastapi.testclient import TestClient

API = "/api/v1"
BASES = {
    "openai": "http://fake/v1",
    "anthropic": "http://fake/anthropic",
    "gemini": "http://fake/gemini",
}
REMOTE_BASES = {
    "openai": "https://llm.example.com/v1",
    "anthropic": "https://llm.example.com/anthropic",
    "gemini": "https://llm.example.com/gemini",
}
CAPS = {"images": True, "pdf": True, "audio": True}


def model(model_id: str, caps: dict[str, bool] | None = None, **kw: Any) -> dict[str, Any]:
    return {
        "modelId": model_id,
        "displayName": model_id.title(),
        "capabilities": caps or CAPS,
        "hidden": False,
        **kw,
    }


def create_endpoint(
    c: TestClient,
    style: str = "openai",
    name: str | None = None,
    remote: bool = False,
    api_key: str | None = None,
    models: list[str] | None = None,
    caps: dict[str, bool] | None = None,
    **extra: Any,
) -> dict[str, Any]:
    body: dict[str, Any] = {
        "name": name or f"{style} {'remote' if remote else 'local'}",
        "style": style,
        "baseUrl": (REMOTE_BASES if remote else BASES)[style],
        "models": [model(m, caps) for m in (models or ["echo", "slow"])],
        **extra,
    }
    if api_key is not None:
        from tests.conftest import register_test_key

        body["apiKey"] = register_test_key(api_key)
    r = c.post(f"{API}/ai/endpoints", json=body)
    assert r.status_code == 201, r.text
    return r.json()  # type: ignore[no-any-return]


def model_ref(endpoint: dict[str, Any], model_id: str = "echo") -> dict[str, str]:
    found = next(m for m in endpoint["models"] if m["modelId"] == model_id)
    return {"endpointId": endpoint["id"], "modelId": found["id"]}


def ack(c: TestClient, endpoint: dict[str, Any]) -> None:
    r = c.post(f"{API}/ai/endpoints/{endpoint['id']}/privacy-ack")
    assert r.status_code == 200, r.text
