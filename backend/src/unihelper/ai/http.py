"""HTTP plumbing shared by the adapters: the https rule before any key, classified failures,
and streamed lines whose response is always closed (so cancelling a run closes the upstream
connection — research R1)."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

import httpx

from unihelper.ai.base import AiError, EndpointConfig, timeouts
from unihelper.ai.errors import classify_exception, classify_response
from unihelper.domain.ai_addresses import AddressError, require_secure


class NoModelList(Exception):
    """The endpoint has no model list (many local servers); the user types model ids."""


def url(cfg: EndpointConfig, path: str) -> str:
    return cfg.base_url.rstrip("/") + path


def secure(cfg: EndpointConfig) -> None:
    try:
        require_secure(cfg.base_url, cfg.locality)
    except AddressError as exc:
        raise AiError("https_required", exc.message) from exc


async def get_json(
    http: httpx.AsyncClient,
    cfg: EndpointConfig,
    path: str,
    headers: dict[str, str],
    params: dict[str, Any] | None = None,
) -> Any:
    secure(cfg)
    try:
        response = await http.get(
            url(cfg, path),
            headers=headers,
            params=params,
            timeout=timeouts(),
            follow_redirects=False,
        )
    except httpx.HTTPError as exc:
        raise classify_exception(exc, cfg) from exc
    if response.status_code == 404:
        error = classify_response(cfg.style, 404, response.text, response.headers, cfg)
        if error.category == "not_this_style":
            raise error
        raise NoModelList
    if response.status_code >= 400:
        raise classify_response(
            cfg.style, response.status_code, response.text, response.headers, cfg
        )
    try:
        return response.json()
    except ValueError as exc:
        raise AiError("not_this_style", "The address answered, but not with JSON.") from exc


async def post_json(
    http: httpx.AsyncClient,
    cfg: EndpointConfig,
    path: str,
    headers: dict[str, str],
    body: dict[str, Any],
) -> Any:
    secure(cfg)
    try:
        response = await http.post(
            url(cfg, path), headers=headers, json=body, timeout=timeouts(), follow_redirects=False
        )
    except httpx.HTTPError as exc:
        raise classify_exception(exc, cfg) from exc
    if response.status_code >= 400:
        raise classify_response(
            cfg.style, response.status_code, response.text, response.headers, cfg
        )
    if "html" in response.headers.get("content-type", ""):
        raise AiError("not_this_style", "The address answered with a web page, not an API.")
    try:
        return response.json()
    except ValueError:
        return None  # a probe only needs the success; some servers stream regardless


@asynccontextmanager
async def stream_lines(
    http: httpx.AsyncClient,
    cfg: EndpointConfig,
    path: str,
    headers: dict[str, str],
    body: dict[str, Any],
) -> AsyncIterator[AsyncIterator[str]]:
    secure(cfg)
    request = http.build_request(
        "POST",
        url(cfg, path),
        headers={**headers, "accept": "text/event-stream"},
        json=body,
        timeout=timeouts(),
    )
    try:
        response = await http.send(request, stream=True, follow_redirects=False)
    except httpx.HTTPError as exc:
        raise classify_exception(exc, cfg) from exc
    try:
        if response.status_code >= 400:
            text = (await response.aread()).decode("utf-8", "replace")
            raise classify_response(cfg.style, response.status_code, text, response.headers, cfg)
        content_type = response.headers.get("content-type", "")
        if "html" in content_type:
            raise AiError("not_this_style", "The address answered with a web page, not an API.")

        async def lines() -> AsyncIterator[str]:
            try:
                async for line in response.aiter_lines():
                    yield line
            except httpx.HTTPError as exc:
                raise classify_exception(exc, cfg) from exc

        yield lines()
    finally:
        await response.aclose()
