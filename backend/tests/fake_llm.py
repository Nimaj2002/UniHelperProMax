"""A scripted fake of the three AI request styles (014 T004, contracts/provider-styles.md).

Base URLs (as the student would enter them):
- OpenAI-compatible: `http://fake/v1`
- Anthropic:         `http://fake/anthropic`
- Google Gemini:     `http://fake/gemini`

Behaviour is chosen by the model id: `echo` (streams the last user text back in 3 chunks),
`slow` (one token every 100 ms, 200 tokens), `fail-401`, `fail-404`, `fail-413`, `fail-429`
(retry after 7 s), `fail-midstream` (an error after the first delta), `big-usage` (reports
token usage) — any other id answers like `echo`. Model lists are served in each style's shape;
`/wrong/...` paths serve another style's shape (to test "does not look like this style").

`STATE` records the last request (path, headers, JSON body) and whether the client went away
before the stream ended. Tests call `reset()`. Run standalone for Playwright:
`uv run uvicorn tests.fake_llm:app --port 8021`.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from typing import Any

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse

MODELS = [
    "echo",
    "slow",
    "fail-401",
    "fail-404",
    "fail-413",
    "fail-429",
    "fail-midstream",
    "big-usage",
]

STATE: dict[str, Any] = {}


def reset() -> None:
    STATE.clear()
    STATE.update(
        requests=[],
        last=None,
        disconnected=False,
        completed=False,
        required_key=None,  # when set, any other key answers 401
        no_model_list=False,  # GET models answers 404 (servers without a list)
        reject_stream_options=False,  # OpenAI style: 400 on stream_options (old local servers)
        slow_tokens=200,
        slow_delay=0.1,
    )


reset()

app = FastAPI()


# ───────────────────────────── helpers ─────────────────────────────


def _record(request: Request, body: Any) -> None:
    entry = {"path": request.url.path, "headers": dict(request.headers), "body": body}
    STATE["requests"].append(entry)
    STATE["last"] = entry


def _key(request: Request, style: str) -> str | None:
    if style == "openai":
        auth = request.headers.get("authorization", "")
        return auth.removeprefix("Bearer ") if auth.startswith("Bearer ") else None
    if style == "anthropic":
        return request.headers.get("x-api-key")
    return request.headers.get("x-goog-api-key")


def _error(
    style: str, status: int, message: str, headers: dict[str, str] | None = None
) -> Response:
    if style == "openai":
        code = {401: "invalid_api_key", 404: "model_not_found", 429: "rate_limit_exceeded"}
        body: dict[str, Any] = {
            "error": {
                "message": message,
                "type": "invalid_request_error",
                "param": None,
                "code": code.get(status),
            }
        }
    elif style == "anthropic":
        kind = {
            401: "authentication_error",
            404: "not_found_error",
            413: "request_too_large",
            429: "rate_limit_error",
        }.get(status, "api_error")
        body = {
            "type": "error",
            "error": {"type": kind, "message": message},
            "request_id": "req_fake",
        }
    else:
        status_name = {
            401: "UNAUTHENTICATED",
            403: "PERMISSION_DENIED",
            404: "NOT_FOUND",
            413: "INVALID_ARGUMENT",
            429: "RESOURCE_EXHAUSTED",
        }.get(status, "INTERNAL")
        details: list[Any] = []
        if status == 429:
            details = [{"@type": "type.googleapis.com/google.rpc.RetryInfo", "retryDelay": "7s"}]
        body = {
            "error": {"code": status, "message": message, "status": status_name, "details": details}
        }
    return JSONResponse(body, status_code=status, headers=headers)


def _auth_failure(request: Request, style: str, model: str | None) -> Response | None:
    required = STATE["required_key"]
    given = _key(request, style)
    if model == "fail-401" or (required is not None and given != required):
        echo = f" (got {given})" if given else ""  # a careless provider echoing the key
        return _error(style, 401, f"Invalid API key{echo}")
    return None


def _model_failure(style: str, model: str) -> Response | None:
    if model == "fail-404":
        return _error(style, 404, f"The model {model} does not exist")
    if model == "fail-413":
        return _error(style, 413, "Request too large")
    if model == "fail-429":
        return _error(style, 429, "Rate limit reached", headers={"retry-after": "7"})
    return None


def _last_user_text(style: str, body: dict[str, Any]) -> str:
    if style == "gemini":
        contents = [c for c in body.get("contents", []) if c.get("role") == "user"]
        parts = contents[-1]["parts"] if contents else []
        return " ".join(p["text"] for p in parts if "text" in p)
    messages = [m for m in body.get("messages", []) if m.get("role") == "user"]
    if not messages:
        return ""
    content = messages[-1]["content"]
    if isinstance(content, str):
        return content
    return " ".join(p.get("text", "") for p in content if p.get("type") == "text")


def _tokens(model: str, text: str) -> list[str]:
    if model == "slow":
        return [f"tok{i} " for i in range(STATE["slow_tokens"])]
    reply = f"You said: {text}" if text else "Hello!"
    third = max(1, len(reply) // 3)
    return [reply[:third], reply[third : 2 * third], reply[2 * third :]]


async def _paced(model: str, tokens: list[str]) -> AsyncIterator[str]:
    for token in tokens:
        if model == "slow":
            await asyncio.sleep(STATE["slow_delay"])
        else:
            await asyncio.sleep(0)
        yield token


def _sse(gen: AsyncIterator[bytes]) -> StreamingResponse:
    async def tracked() -> AsyncIterator[bytes]:
        STATE["disconnected"] = False
        STATE["completed"] = False
        try:
            async for chunk in gen:
                yield chunk
            STATE["completed"] = True
        finally:
            if not STATE["completed"]:
                STATE["disconnected"] = True

    return StreamingResponse(tracked(), media_type="text/event-stream")


USAGE = {"input": 812, "output": 403}

# ───────────────────────────── OpenAI-compatible ─────────────────────────────


@app.get("/v1/models")
async def openai_models(request: Request) -> Response:
    _record(request, None)
    if (failure := _auth_failure(request, "openai", None)) is not None:
        return failure
    if STATE["no_model_list"]:
        return _error("openai", 404, "Not found")
    return JSONResponse(
        {
            "object": "list",
            "data": [{"id": m, "object": "model", "owned_by": "fake"} for m in MODELS],
        }
    )


@app.post("/v1/chat/completions")
async def openai_chat(request: Request) -> Response:
    body = await request.json()
    _record(request, body)
    model = body.get("model", "")
    if (failure := _auth_failure(request, "openai", model)) is not None:
        return failure
    if STATE["reject_stream_options"] and "stream_options" in body:
        return _error("openai", 400, "Unrecognized request argument supplied: stream_options")
    if (failure := _model_failure("openai", model)) is not None:
        return failure
    tokens = _tokens(model, _last_user_text("openai", body))

    async def gen() -> AsyncIterator[bytes]:
        def chunk(payload: dict[str, Any]) -> bytes:
            return f"data: {json.dumps(payload)}\n\n".encode()

        yield chunk(
            {
                "id": "c1",
                "object": "chat.completion.chunk",
                "choices": [{"index": 0, "delta": {"role": "assistant", "content": ""}}],
            }
        )
        async for i, token in _enumerate(_paced(model, tokens)):
            if model == "fail-midstream" and i == 1:
                yield chunk(
                    {"error": {"message": "The server had an error", "type": "server_error"}}
                )
                return
            yield chunk(
                {
                    "id": "c1",
                    "object": "chat.completion.chunk",
                    "choices": [{"index": 0, "delta": {"content": token}}],
                }
            )
        yield chunk(
            {
                "id": "c1",
                "object": "chat.completion.chunk",
                "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}],
            }
        )
        if body.get("stream_options", {}).get("include_usage"):
            yield chunk(
                {
                    "id": "c1",
                    "choices": [],
                    "usage": {
                        "prompt_tokens": USAGE["input"],
                        "completion_tokens": USAGE["output"],
                        "total_tokens": USAGE["input"] + USAGE["output"],
                    },
                }
            )
        yield b"data: [DONE]\n\n"

    return _sse(gen())


# ───────────────────────────── Anthropic ─────────────────────────────


@app.get("/anthropic/v1/models")
async def anthropic_models(request: Request) -> Response:
    _record(request, None)
    if (failure := _auth_failure(request, "anthropic", None)) is not None:
        return failure
    if "anthropic-version" not in request.headers:
        return _error("anthropic", 400, "anthropic-version header is required")
    after = request.query_params.get("after_id")
    data = [
        {
            "type": "model",
            "id": m,
            "display_name": m.title(),
            "created_at": "2026-01-01T00:00:00Z",
            "max_input_tokens": 200000,
            "max_tokens": 64000,
        }
        for m in MODELS
    ]
    if after is None:  # two pages, to exercise pagination
        page, more = data[:4], True
    else:
        page, more = data[4:], False
    return JSONResponse(
        {"data": page, "has_more": more, "first_id": page[0]["id"], "last_id": page[-1]["id"]}
    )


@app.post("/anthropic/v1/messages")
async def anthropic_messages(request: Request) -> Response:
    body = await request.json()
    _record(request, body)
    model = body.get("model", "")
    if (failure := _auth_failure(request, "anthropic", model)) is not None:
        return failure
    if "max_tokens" not in body or "anthropic-version" not in request.headers:
        return _error("anthropic", 400, "max_tokens and anthropic-version are required")
    if (failure := _model_failure("anthropic", model)) is not None:
        return failure
    tokens = _tokens(model, _last_user_text("anthropic", body))

    async def gen() -> AsyncIterator[bytes]:
        def event(name: str, payload: dict[str, Any]) -> bytes:
            return f"event: {name}\ndata: {json.dumps(payload)}\n\n".encode()

        yield event(
            "message_start",
            {
                "type": "message_start",
                "message": {
                    "id": "msg_1",
                    "type": "message",
                    "role": "assistant",
                    "content": [],
                    "model": model,
                    "usage": {"input_tokens": USAGE["input"], "output_tokens": 1},
                },
            },
        )
        yield event(
            "content_block_start",
            {
                "type": "content_block_start",
                "index": 0,
                "content_block": {"type": "thinking", "thinking": ""},
            },
        )
        yield event(
            "content_block_delta",
            {
                "type": "content_block_delta",
                "index": 0,
                "delta": {"type": "thinking_delta", "thinking": "hmm"},
            },
        )
        yield event("content_block_stop", {"type": "content_block_stop", "index": 0})
        yield event("ping", {"type": "ping"})
        yield event(
            "content_block_start",
            {
                "type": "content_block_start",
                "index": 1,
                "content_block": {"type": "text", "text": ""},
            },
        )
        async for i, token in _enumerate(_paced(model, tokens)):
            if model == "fail-midstream" and i == 1:
                yield event(
                    "error",
                    {
                        "type": "error",
                        "error": {"type": "overloaded_error", "message": "Overloaded"},
                    },
                )
                return
            yield event(
                "content_block_delta",
                {
                    "type": "content_block_delta",
                    "index": 1,
                    "delta": {"type": "text_delta", "text": token},
                },
            )
        yield event("content_block_stop", {"type": "content_block_stop", "index": 1})
        yield event(
            "message_delta",
            {
                "type": "message_delta",
                "delta": {"stop_reason": "end_turn"},
                "usage": {"output_tokens": USAGE["output"]},
            },
        )
        yield event("message_stop", {"type": "message_stop"})

    return _sse(gen())


# ───────────────────────────── Google Gemini ─────────────────────────────


@app.get("/gemini/v1beta/models")
async def gemini_models(request: Request) -> Response:
    _record(request, None)
    if (failure := _auth_failure(request, "gemini", None)) is not None:
        return failure
    models = [
        {
            "name": f"models/{m}",
            "displayName": m.title(),
            "inputTokenLimit": 1048576,
            "outputTokenLimit": 65536,
            "supportedGenerationMethods": ["generateContent", "countTokens"],
        }
        for m in MODELS
    ]
    models.append(
        {
            "name": "models/embedder",
            "displayName": "Embedder",
            "supportedGenerationMethods": ["embedContent"],
        }
    )
    token = request.query_params.get("pageToken")
    if token is None:
        return JSONResponse({"models": models[:5], "nextPageToken": "p2"})
    return JSONResponse({"models": models[5:]})


@app.post("/gemini/v1beta/models/{model_action}")
async def gemini_generate(model_action: str, request: Request) -> Response:
    body = await request.json()
    _record(request, body)
    model, _, action = model_action.partition(":")
    if (failure := _auth_failure(request, "gemini", model)) is not None:
        return failure
    if action not in ("streamGenerateContent", "generateContent"):
        return _error("gemini", 404, "Unknown method")
    if (failure := _model_failure("gemini", model)) is not None:
        return failure
    tokens = _tokens(model, _last_user_text("gemini", body))

    async def gen() -> AsyncIterator[bytes]:
        def chunk(payload: dict[str, Any]) -> bytes:
            return f"data: {json.dumps(payload)}\r\n\r\n".encode()

        yield chunk(
            {
                "candidates": [
                    {
                        "content": {
                            "role": "model",
                            "parts": [{"text": "thinking...", "thought": True}],
                        },
                        "index": 0,
                    }
                ]
            }
        )
        async for i, token in _enumerate(_paced(model, tokens)):
            if model == "fail-midstream" and i == 1:
                yield chunk(
                    {"error": {"code": 500, "message": "Internal error", "status": "INTERNAL"}}
                )
                return
            yield chunk(
                {
                    "candidates": [
                        {"content": {"role": "model", "parts": [{"text": token}]}, "index": 0}
                    ]
                }
            )
        yield chunk(
            {
                "candidates": [
                    {
                        "content": {"role": "model", "parts": [{"text": ""}]},
                        "finishReason": "STOP",
                        "index": 0,
                    }
                ],
                "usageMetadata": {
                    "promptTokenCount": USAGE["input"],
                    "candidatesTokenCount": USAGE["output"],
                    "totalTokenCount": USAGE["input"] + USAGE["output"],
                },
            }
        )

    return _sse(gen())


# ───────────────────────────── other styles' shapes ─────────────────────────────


@app.get("/wrong/models")
@app.get("/wrong/v1/models")
@app.get("/wrong/v1beta/models")
async def wrong_style(request: Request) -> Response:
    """Answers every style's model-list path with Gemini's shape."""
    _record(request, None)
    return JSONResponse({"models": [{"name": "models/echo", "displayName": "Echo"}]})


@app.get("/html/{rest:path}")
@app.post("/html/{rest:path}")
async def not_an_api(rest: str) -> Response:
    return Response("<html><body>Welcome to nginx!</body></html>", media_type="text/html")


async def _enumerate(gen: AsyncIterator[str]) -> AsyncIterator[tuple[int, str]]:
    i = 0
    async for item in gen:
        yield i, item
        i += 1


if __name__ == "__main__":  # pragma: no cover
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8021)
