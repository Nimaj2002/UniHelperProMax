"""Client for the OpenAI audio transcription API, shared by every OpenAI-style provider (B1).

`POST {base}/v1/audio/transcriptions` with a streamed multipart body (so upload progress can be
reported) → `{"text": "…"}`. Errors become `ProviderError`s whose messages are fixed texts:
provider responses are only inspected to choose a category, never shown or logged (they could
echo credentials).
"""

from __future__ import annotations

import json
import logging
import secrets
from collections.abc import AsyncIterator

import httpx

from unihelper.domain import proxy as proxy_domain
from unihelper.transcription.base import AudioPart, Progress, ProviderError

log = logging.getLogger("unihelper.transcription")

CHUNK = 64 * 1024
MSG_UNREACHABLE = (
    "The transcription server couldn't be reached. Check the address in Settings → Transcription."
)
MSG_NOT_A_TRANSCRIBER = (
    "The server at this address doesn't offer transcription. "
    "Check the address in Settings → Transcription."
)
MSG_CREDENTIALS = "The provider rejected the credentials. Check them in Settings → Transcription."
MSG_MODEL = "The model isn't available on this server. Check the model in Settings → Transcription."
MSG_TOO_LARGE = "The audio file is too large for this provider."
MSG_UNSUPPORTED = "The provider couldn't accept this audio file."
MSG_TIMEOUT = "The transcription server took too long to answer."


def endpoint(base: str, path: str) -> str:
    """Accept addresses with or without a trailing slash or `/v1`."""
    root = base.strip().rstrip("/")
    if root.endswith("/v1"):
        root = root[: -len("/v1")]
    return f"{root}/v1/{path.lstrip('/')}"


def _error_info(response: httpx.Response) -> tuple[str, str]:
    """(error code, lower-cased message) from an OpenAI-style error body, for classification."""
    try:
        body = response.json()
    except ValueError:
        return "", response.text[:500].lower()
    err = body.get("error", body) if isinstance(body, dict) else {}
    if not isinstance(err, dict):
        return "", str(err).lower()
    return str(err.get("code") or ""), str(err.get("message") or "").lower()


def classify(response: httpx.Response) -> ProviderError:
    status = response.status_code
    code, message = _error_info(response)
    if status in (401, 403):
        return ProviderError(
            "invalid_credentials", MSG_CREDENTIALS, settings_related=True, status=status
        )
    if status == 404:
        if code == "model_not_found" or "model" in message:
            return ProviderError("unknown", MSG_MODEL, settings_related=True, status=status)
        return ProviderError(
            "unavailable", MSG_NOT_A_TRANSCRIBER, settings_related=True, status=status
        )
    if status == 413:
        return ProviderError("file_rejected", MSG_TOO_LARGE, status=status)
    if status in (400, 415, 422):
        if code == "model_not_found" or "model" in message:
            return ProviderError("unknown", MSG_MODEL, settings_related=True, status=status)
        return ProviderError("file_rejected", MSG_UNSUPPORTED, status=status)
    if status == 429:
        if code == "insufficient_quota" or "quota" in message:
            return ProviderError("quota_exceeded", status=status)
        return ProviderError("unavailable", retryable=True, status=status)
    if status in (502, 503, 504):
        return ProviderError("unavailable", retryable=True, status=status)
    if status >= 500:
        return ProviderError("unavailable", status=status)
    return ProviderError("unknown", status=status)


def _transport_error(exc: httpx.HTTPError, proxied: bool = False) -> ProviderError:
    failure = proxy_domain.failure(exc) if proxied else None
    if failure is not None:  # 021: name the proxy; the job is never retried without it
        return ProviderError(
            "unavailable",
            proxy_domain.MESSAGES[failure],
            settings_related=True,
            retryable=failure != "credentials_rejected",
        )
    if isinstance(exc, httpx.ConnectTimeout | httpx.ConnectError):
        return ProviderError("unavailable", MSG_UNREACHABLE, settings_related=True, retryable=True)
    if isinstance(exc, httpx.TimeoutException):
        return ProviderError("unavailable", MSG_TIMEOUT)
    if isinstance(exc, httpx.UnsupportedProtocol | httpx.InvalidURL):
        return ProviderError("unavailable", MSG_UNREACHABLE, settings_related=True)
    return ProviderError("unavailable", retryable=True)


class _Multipart:
    """A multipart/form-data body streamed in chunks, reporting the uploaded fraction."""

    def __init__(self, fields: dict[str, str], part: AudioPart, on_progress: Progress) -> None:
        self.boundary = secrets.token_hex(16)
        self.on_progress = on_progress
        b = self.boundary
        head = b""
        for name, value in fields.items():
            head += (
                f'--{b}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'
            ).encode()
        safe_name = part.file_name.replace('"', "'").encode("ascii", "replace").decode()
        head += (
            f'--{b}\r\nContent-Disposition: form-data; name="file"; filename="{safe_name}"\r\n'
            f"Content-Type: {part.mime_type}\r\n\r\n"
        ).encode()
        self.head = head
        self.data = part.data
        self.tail = f"\r\n--{b}--\r\n".encode()
        self.length = len(head) + len(part.data) + len(self.tail)

    @property
    def content_type(self) -> str:
        return f"multipart/form-data; boundary={self.boundary}"

    async def __aiter__(self) -> AsyncIterator[bytes]:
        yield self.head
        total = len(self.data) or 1
        for i in range(0, len(self.data), CHUNK):
            yield self.data[i : i + CHUNK]
            await self.on_progress(min(1.0, (i + CHUNK) / total))
        yield self.tail
        await self.on_progress(1.0)


class OpenAITranscriptionClient:
    def __init__(self, http: httpx.AsyncClient, proxied: bool = False) -> None:
        self.http = http
        self.proxied = proxied

    async def transcribe(
        self,
        base: str,
        part: AudioPart,
        *,
        model: str,
        language: str | None,
        api_key: str | None,
        on_progress: Progress,
        provider_id: str,
    ) -> str:
        fields = {"model": model, "response_format": "json"}
        if language and language != "auto":
            fields["language"] = language
        body = _Multipart(fields, part, on_progress)
        headers = {"Content-Type": body.content_type, "Content-Length": str(body.length)}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"
        minutes = part.duration_ms / 60_000
        timeout = httpx.Timeout(connect=10, read=600 + 120 * minutes, write=600, pool=10)
        try:
            response = await self.http.post(
                endpoint(base, "audio/transcriptions"),
                content=body.__aiter__(),
                headers=headers,
                timeout=timeout,
            )
        except httpx.HTTPError as exc:
            err = _transport_error(exc, self.proxied)
            log.warning(
                "transcription transport error provider=%s kind=%s", provider_id, type(exc).__name__
            )
            raise err from None
        if response.status_code >= 400:
            err = classify(response)
            log.warning(
                "transcription failed provider=%s status=%s category=%s",
                provider_id,
                response.status_code,
                err.category,
            )
            raise err
        try:
            text = response.json().get("text", "")
        except (ValueError, AttributeError):
            log.warning("transcription bad response provider=%s", provider_id)
            raise ProviderError("unknown") from None
        return str(text or "").strip()

    async def test(
        self, base: str, api_key: str | None, provider_id: str, model: str | None = None
    ) -> None:
        """Connection test for 005: `GET {base}/v1/models`; when the server lists its models,
        the configured model must be among them. Servers without `/v1/models` (many local
        transcription servers) are checked on the transcription endpoint itself instead."""
        headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
        try:
            response = await self.http.get(endpoint(base, "models"), headers=headers, timeout=15)
        except httpx.HTTPError as exc:
            raise _transport_error(exc, self.proxied) from None
        if response.status_code in (404, 405, 501):
            await self._probe_transcriptions(base, headers)
            return
        if response.status_code >= 400:
            raise classify(response)
        try:
            body = json.loads(response.content or b"{}")
        except ValueError:
            log.warning("connection test non-json provider=%s", provider_id)
            raise ProviderError(
                "unavailable", MSG_NOT_A_TRANSCRIBER, settings_related=True
            ) from None
        listed = body.get("data") if isinstance(body, dict) else None
        if model and isinstance(listed, list) and listed:
            ids = {str(m.get("id")) for m in listed if isinstance(m, dict)}
            if model not in ids:
                raise ProviderError("unknown", MSG_MODEL, settings_related=True)

    async def _probe_transcriptions(self, base: str, headers: dict[str, str]) -> None:
        """POST an empty form: a validation error (400/415/422) proves the endpoint exists
        without sending any audio; 404/405 means this isn't a transcription server."""
        try:
            response = await self.http.post(
                endpoint(base, "audio/transcriptions"),
                headers=headers,
                files={"model": (None, "probe")},
                timeout=15,
            )
        except httpx.HTTPError as exc:
            raise _transport_error(exc, self.proxied) from None
        status = response.status_code
        if status in (401, 403, 502, 503, 504):
            raise classify(response)  # wrong key / temporarily unavailable
        if status in (404, 405) or status >= 500:
            raise ProviderError("unavailable", MSG_NOT_A_TRANSCRIBER, settings_related=True)
        # 2xx/400/415/422/429: something that speaks the transcription API answered


def test_reason(err: ProviderError) -> str:
    """Failure category shown by Settings → Transcription (005 C2)."""
    if err.category == "invalid_credentials":
        return "invalid_credentials"
    if err.message in proxy_domain.MESSAGES.values():
        return "proxy"
    return {
        MSG_UNREACHABLE: "unreachable",
        MSG_TIMEOUT: "timeout",
        MSG_NOT_A_TRANSCRIBER: "not_a_transcription_service",
        MSG_MODEL: "model_not_found",
    }.get(err.message, "unknown")
