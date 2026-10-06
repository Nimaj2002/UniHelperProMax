from __future__ import annotations

import logging
from collections.abc import AsyncIterator

import httpx
import pytest

from tests import fake_transcriber
from tests.webm_fixture import make_webm
from unihelper.transcription.base import AudioPart, ProviderError
from unihelper.transcription.openai_client import OpenAITranscriptionClient, endpoint

pytestmark = [pytest.mark.unit, pytest.mark.anyio]
KEY = "sk-secret-value-1234"


@pytest.fixture
async def http() -> AsyncIterator[httpx.AsyncClient]:
    fake_transcriber.app.state.calls.clear()
    fake_transcriber.app.state.required_key = None
    fake_transcriber.app.state.fail_once_done.clear()
    transport = httpx.ASGITransport(app=fake_transcriber.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://fake") as c:
        yield c


def part() -> AudioPart:
    return AudioPart(make_webm(3), "Recording 10-02.webm", "audio/webm", 3000)


async def run(http: httpx.AsyncClient, model: str = "whisper-1", **kw: object) -> str:
    progress: list[float] = []

    async def on_progress(f: float) -> None:
        progress.append(f)

    text = await OpenAITranscriptionClient(http).transcribe(
        str(kw.pop("base", "http://fake")),
        part(),
        model=model,
        language=kw.pop("language", None),  # type: ignore[arg-type]
        api_key=kw.pop("api_key", None),  # type: ignore[arg-type]
        on_progress=on_progress,
        provider_id="test",
    )
    assert progress and progress[-1] == 1.0
    return text


def test_endpoint_normalisation() -> None:
    for base in ("http://h:1", "http://h:1/", "http://h:1/v1", "http://h:1/v1/"):
        assert endpoint(base, "audio/transcriptions") == "http://h:1/v1/audio/transcriptions"


async def test_success_language_and_auth(http: httpx.AsyncClient) -> None:
    text = await run(http)
    assert text.startswith("Transcript of Recording 10-02.webm (")
    assert fake_transcriber.app.state.calls[-1]["language"] is None
    assert fake_transcriber.app.state.calls[-1]["authorized"] is False
    assert (await run(http, language="auto")).endswith("bytes)")
    assert (await run(http, language="tr")).endswith("lang=tr")
    fake_transcriber.app.state.required_key = KEY
    assert (await run(http, api_key=KEY, base="http://fake/v1/")).startswith("Transcript")
    assert fake_transcriber.app.state.calls[-1]["authorized"] is True


@pytest.mark.parametrize(
    ("model", "category", "settings", "retryable"),
    [
        ("fail-401", "invalid_credentials", True, False),
        ("fail-404-model", "unknown", True, False),
        ("fail-413", "file_rejected", False, False),
        ("fail-429-quota", "quota_exceeded", False, False),
        ("fail-429-once", "unavailable", False, True),
        ("fail-503", "unavailable", False, True),
    ],
)
async def test_error_mapping(
    http: httpx.AsyncClient,
    caplog: pytest.LogCaptureFixture,
    model: str,
    category: str,
    settings: bool,
    retryable: bool,
) -> None:
    caplog.set_level(logging.DEBUG)
    with pytest.raises(ProviderError) as exc:
        await run(http, model=model, api_key=KEY)
    err = exc.value
    assert (err.category, err.settings_related, err.retryable) == (category, settings, retryable)
    assert KEY not in str(err) and KEY not in caplog.text


async def test_wrong_key_and_unreachable(http: httpx.AsyncClient) -> None:
    fake_transcriber.app.state.required_key = KEY
    with pytest.raises(ProviderError) as exc:
        await run(http, api_key="sk-wrong")
    assert exc.value.category == "invalid_credentials"

    def refuse(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused", request=request)

    async with httpx.AsyncClient(transport=httpx.MockTransport(refuse)) as down:
        with pytest.raises(ProviderError) as exc:
            await run(down)
    assert exc.value.category == "unavailable" and exc.value.settings_related


async def test_connection_test(http: httpx.AsyncClient) -> None:
    await OpenAITranscriptionClient(http).test("http://fake", None, "test")
    fake_transcriber.app.state.required_key = KEY
    with pytest.raises(ProviderError):
        await OpenAITranscriptionClient(http).test("http://fake", "nope", "test")


def _server(models: int, transcriptions: int):  # type: ignore[no-untyped-def]
    seen: list[str] = []

    def handle(request: httpx.Request) -> httpx.Response:
        seen.append(f"{request.method} {request.url.path}")
        if request.url.path.endswith("/models"):
            return httpx.Response(
                models, json={"data": []} if models == 200 else {"detail": "Not Found"}
            )
        return httpx.Response(transcriptions, json={"detail": "field required"})

    return httpx.MockTransport(handle), seen


@pytest.mark.parametrize("validation_status", [400, 415, 422])
async def test_server_without_models_endpoint_is_probed(validation_status: int) -> None:
    """Many local servers (e.g. Voice Studio) only implement /v1/audio/transcriptions."""
    transport, seen = _server(404, validation_status)
    async with httpx.AsyncClient(transport=transport) as http:
        await OpenAITranscriptionClient(http).test("http://localhost:3900", None, "voice-studio")
    assert seen == ["GET /v1/models", "POST /v1/audio/transcriptions"]


@pytest.mark.parametrize(
    ("status", "category"),
    [(404, "unavailable"), (401, "invalid_credentials"), (500, "unavailable")],
)
async def test_probe_failures(status: int, category: str) -> None:
    transport, _ = _server(404, status)
    async with httpx.AsyncClient(transport=transport) as http:
        with pytest.raises(ProviderError) as exc:
            await OpenAITranscriptionClient(http).test(
                "http://localhost:3900", None, "voice-studio"
            )
    assert exc.value.category == category
