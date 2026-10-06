"""A predictable OpenAI-style transcription server for tests and local development (004 B12).

`POST /v1/audio/transcriptions` answers `{"text": "Transcript of <file> (<n> bytes)[ lang=xx]"}`.
The `model` field selects a behaviour so tests can drive failures without extra endpoints:
`fail-401`, `fail-404-model`, `fail-413`, `fail-429-quota`, `fail-429-once`, `fail-503`,
`slow-<seconds>`, `silent` (empty text). Set `app.state.required_key` to demand a Bearer key.
Run: `uv run uvicorn tests.fake_transcriber:app --port 8020`.
"""

from __future__ import annotations

import asyncio
from email.parser import BytesParser
from email.policy import HTTP
from typing import Any

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

app = FastAPI(title="fake transcriber")
app.state.calls = []
app.state.required_key = None
app.state.fail_once_done = set()


def _error(status: int, message: str, code: str | None = None) -> JSONResponse:
    return JSONResponse({"error": {"message": message, "type": "fake", "code": code}}, status)


def _parse_multipart(content_type: str, body: bytes) -> dict[str, Any]:
    msg = BytesParser(policy=HTTP).parsebytes(
        f"Content-Type: {content_type}\r\n\r\n".encode() + body
    )
    fields: dict[str, Any] = {}
    for part in msg.iter_parts():
        name = part.get_param("name", header="content-disposition")
        payload = part.get_payload(decode=True) or b""
        filename = part.get_filename()
        if filename is not None:
            fields[str(name)] = (filename, payload)
        else:
            fields[str(name)] = payload.decode()
    return fields


def _auth_error(request: Request) -> JSONResponse | None:
    required = app.state.required_key
    if required is None:
        return None
    if request.headers.get("authorization") != f"Bearer {required}":
        return _error(401, "Incorrect API key provided", "invalid_api_key")
    return None


@app.get("/v1/models")
async def models(request: Request) -> Any:
    return _auth_error(request) or {"data": [{"id": "whisper-1"}]}


@app.post("/v1/audio/transcriptions")
async def transcriptions(request: Request) -> Any:
    body = await request.body()
    fields = _parse_multipart(request.headers.get("content-type", ""), body)
    filename, data = fields.get("file", ("", b""))
    model = str(fields.get("model", ""))
    language = fields.get("language")
    app.state.calls.append(
        {
            "file": filename,
            "size": len(data),
            "model": model,
            "language": language,
            "authorized": "authorization" in request.headers,
        }
    )
    if (err := _auth_error(request)) is not None:
        return err
    if model.startswith("slow-"):
        await asyncio.sleep(float(model.removeprefix("slow-")))
    if model == "fail-401":
        return _error(401, "Incorrect API key provided", "invalid_api_key")
    if model == "fail-404-model":
        return _error(404, f"The model `{model}` does not exist", "model_not_found")
    if model == "fail-413":
        return _error(413, "Maximum content size limit exceeded")
    if model == "fail-429-quota":
        return _error(429, "You exceeded your current quota", "insufficient_quota")
    if model == "fail-503":
        return _error(503, "Service unavailable")
    if model == "fail-429-once" and filename not in app.state.fail_once_done:
        app.state.fail_once_done.add(filename)
        return _error(429, "Rate limit reached", "rate_limit_exceeded")
    if filename.endswith(".webm") and data[:4] != b"\x1a\x45\xdf\xa3":
        return _error(400, "Invalid file format")
    if model == "silent":
        return {"text": ""}
    text = f"Transcript of {filename} ({len(data)} bytes)"
    if language:
        text += f" lang={language}"
    return {"text": text}
