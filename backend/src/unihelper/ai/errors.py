"""Turn provider failures into plain-language, classified errors (014 research R6, FR-039).

The provider's own message is passed through only after removing anything that looks like a
key, and cut to 500 characters. Log lines carry only the category, the status and the exception
type — never bodies, never keys."""

from __future__ import annotations

import json
import logging
import re
from typing import Any

import httpx

from unihelper.ai.base import AiError, EndpointConfig, Style
from unihelper.domain import proxy as proxy_domain
from unihelper.domain.addresses import localhost_hint

log = logging.getLogger("unihelper.ai")

MAX_MESSAGE = 500
KEYLIKE = re.compile(r"(sk-[A-Za-z0-9_\-]{6,}|AIza[0-9A-Za-z_\-]{10,}|[A-Za-z0-9_\-]{32,})")
LOCAL_HINT = localhost_hint("AI server (for example Ollama or LM Studio)")

MESSAGES: dict[str, str] = {
    "network": "Couldn't reach the AI server.",
    "timeout": "The AI server didn't answer in time.",
    "key_rejected": "The provider rejected the API key.",
    "rate_limited": "The provider is limiting requests right now.",
    "model_not_found": "The provider doesn't know this model.",
    "too_large": "The message is too large for this provider.",
    "context_exceeded": "This conversation is larger than the model can take.",
    "not_this_style": "The address answered, but it doesn't look like this request style.",
    "provider": "The provider reported an error.",
}


def scrub(message: str, key: str | None = None) -> str:
    if key:
        message = message.replace(key, "[redacted]")
    message = KEYLIKE.sub("[redacted]", message)
    message = " ".join(message.split())
    return message[:MAX_MESSAGE]


def _json(text: str) -> Any:
    try:
        return json.loads(text)
    except ValueError:
        return None


def looks_like(body: Any) -> Style | None:
    """Which style a JSON body (models list or error) seems to come from (research R4)."""
    if not isinstance(body, dict):
        return None
    if body.get("type") == "error" or "has_more" in body or "first_id" in body:
        return "anthropic"
    error = body.get("error")
    # Gemini errors always carry a text `status`; an int `code` alone is also OpenAI-compatible
    # routers' shape ({"error": {"message", "code": 429}}), so it doesn't decide the style
    if isinstance(error, dict) and isinstance(error.get("status"), str):
        return "gemini"
    models = body.get("models")
    if isinstance(models, list) and all(
        isinstance(m, dict) and str(m.get("name", "")).startswith("models/") for m in models
    ):
        return "gemini"
    data = body.get("data")
    if isinstance(data, list):
        if data and all(isinstance(m, dict) and m.get("type") == "model" for m in data):
            return "anthropic"
        return "openai"
    if isinstance(error, dict) and "message" in error:
        return "openai"
    return None


def _provider_message(body: Any, text: str) -> str:
    if isinstance(body, dict):
        error = body.get("error")
        if isinstance(error, dict) and error.get("message"):
            return str(error["message"])
        if isinstance(error, str):
            return error
        if body.get("message"):
            return str(body["message"])
    return text[:200] if text and not text.lstrip().startswith("<") else ""


def _retry_after(headers: httpx.Headers | None, body: Any) -> int | None:
    if headers is not None:
        value = headers.get("retry-after")
        if value:
            try:
                return max(0, round(float(value)))
            except ValueError:
                pass
    error = body.get("error") if isinstance(body, dict) else None
    details = error.get("details") if isinstance(error, dict) else None
    for detail in details if isinstance(details, list) else []:
        delay = detail.get("retryDelay") if isinstance(detail, dict) else None
        if isinstance(delay, str) and delay.endswith("s"):
            try:
                return max(0, round(float(delay[:-1])))
            except ValueError:
                pass
    return None


def _kind(body: Any) -> str:
    """The provider's own error type/code/status, lower-cased, for matching."""
    if not isinstance(body, dict):
        return ""
    error = body.get("error")
    if isinstance(error, dict):
        return " ".join(str(error.get(k, "")) for k in ("type", "code", "status")).lower()
    return ""


def classify_response(
    style: Style,
    status: int,
    text: str,
    headers: httpx.Headers | None,
    cfg: EndpointConfig | None = None,
) -> AiError:
    body = _json(text)
    kind = _kind(body)
    raw = _provider_message(body, text)
    message = scrub(raw, cfg.api_key if cfg else None)
    lowered = message.lower()
    seen = looks_like(body)
    if body is None and text.lstrip().startswith("<"):
        error = AiError("not_this_style", MESSAGES["not_this_style"], status=status)
    elif seen is not None and seen != style and status < 500:
        error = AiError(
            "not_this_style", MESSAGES["not_this_style"], looks_like=seen, status=status
        )
    elif (
        status in (401, 403)
        or "authentication" in kind
        or "permission" in kind
        or ("unauthenticated" in kind)
    ):
        error = AiError("key_rejected", MESSAGES["key_rejected"], status=status)
    elif status == 429 or "rate_limit" in kind or "resource_exhausted" in kind:
        error = AiError(
            "rate_limited",
            MESSAGES["rate_limited"],
            retry_after_seconds=_retry_after(headers, body),
            status=status,
        )
    elif "context_length" in kind or "context length" in lowered or "too many tokens" in lowered:
        error = AiError("context_exceeded", MESSAGES["context_exceeded"], status=status)
    elif (
        status == 413
        or "request_too_large" in kind
        or (status == 400 and ("too large" in lowered or "size" in lowered and "exceed" in lowered))
    ):
        error = AiError("too_large", MESSAGES["too_large"], status=status)
    elif status == 404 or "not_found" in kind or "model_not_found" in kind:
        error = AiError("model_not_found", MESSAGES["model_not_found"], status=status)
    elif "overloaded" in kind or status == 529:
        error = AiError(
            "provider", "The provider is busy right now. Try again shortly.", status=status
        )
    else:
        error = AiError("provider", message or MESSAGES["provider"], status=status)
    if error.category == "provider" and message and error.message != message:
        error.message = f"{error.message} {message}"[:MAX_MESSAGE]
    log.info("ai provider error: style=%s status=%s category=%s", style, status, error.category)
    return error


def classify_exception(exc: BaseException, cfg: EndpointConfig) -> AiError:
    if isinstance(exc, AiError):
        return exc
    proxy_failure = proxy_domain.failure(exc) if cfg.proxied else None
    if proxy_failure is not None:
        error = AiError("proxy", proxy_domain.MESSAGES[proxy_failure])
    elif isinstance(exc, httpx.TimeoutException):
        error = AiError("timeout", MESSAGES["timeout"])
    elif isinstance(exc, httpx.TransportError):
        message = MESSAGES["network"]
        if cfg.locality == "local":
            message = f"{message} {LOCAL_HINT}"
        error = AiError("network", message)
    else:
        error = AiError("provider", MESSAGES["provider"])
    log.info(
        "ai request failed: style=%s category=%s (%s)",
        cfg.style,
        error.category,
        type(exc).__name__,
    )
    return error


def in_stream_error(style: Style, payload: Any, cfg: EndpointConfig) -> AiError:
    """An error sent inside the event stream (Anthropic `event: error`, an `error` object)."""
    status = 500
    if isinstance(payload, dict):
        error = payload.get("error")
        if isinstance(error, dict) and isinstance(error.get("code"), int):
            status = error["code"]
    return classify_response(style, status, json.dumps(payload), None, cfg)
