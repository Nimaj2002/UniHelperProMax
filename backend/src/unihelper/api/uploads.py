"""Streaming a raw upload into staging (006 research I5, reused by 007 documents).

Checks that need no body happen first (size declared, limit, free space); then the body is
streamed in ≤ 1 MiB writes to `files/.uploads/<token>.part`, counted and hashed. Any failure,
including the client going away, discards the staging file — nothing partial is ever kept.
"""

from __future__ import annotations

import errno
import hashlib
from dataclasses import dataclass
from pathlib import Path

import anyio
from fastapi import Request
from starlette.requests import ClientDisconnect

from unihelper.api.errors import ApiError
from unihelper.storage.storage_service import StorageService

FREE_SPACE_MARGIN = 64 * 1024 * 1024
WRITE_SIZE = 1024 * 1024


@dataclass(frozen=True)
class StagedUpload:
    path: Path
    size: int
    sha256: str


def too_large(max_bytes: int, what: str) -> ApiError:
    return ApiError(
        413,
        "file_too_large",
        f"{what} can be at most {max_bytes // (1024 * 1024)} MB.",
        extra={"maxBytes": max_bytes},
    )


def no_space() -> ApiError:
    return ApiError(507, "insufficient_storage", "There isn't enough space on the server.")


def declared_length(request: Request, max_bytes: int, what: str) -> int:
    raw = request.headers.get("content-length")
    if raw is None or not raw.isdigit():
        raise ApiError(411, "length_required", "The upload must state its size.")
    length = int(raw)
    if length > max_bytes:
        raise too_large(max_bytes, what)
    return length


async def receive_upload(
    request: Request, storage: StorageService, length: int, max_bytes: int, what: str
) -> StagedUpload:
    """Stream the body to a staging file. Raises (after discarding it) on any problem."""
    if await anyio.to_thread.run_sync(storage.free_bytes) < length + FREE_SPACE_MARGIN:
        raise no_space()
    staged, fh = await anyio.to_thread.run_sync(storage.open_upload)
    received = 0
    digest = hashlib.sha256()
    try:
        try:
            buffer = bytearray()
            async for chunk in request.stream():
                received += len(chunk)
                if received > max_bytes:
                    raise too_large(max_bytes, what)
                buffer += chunk
                if len(buffer) >= WRITE_SIZE:
                    digest.update(buffer)
                    await anyio.to_thread.run_sync(fh.write, bytes(buffer))
                    buffer.clear()
            if buffer:
                digest.update(buffer)
                await anyio.to_thread.run_sync(fh.write, bytes(buffer))
        finally:
            await anyio.to_thread.run_sync(fh.close)
        if received != length:
            raise ApiError(
                422, "incomplete_upload", "The upload ended before the whole file arrived."
            )
        return StagedUpload(staged, received, digest.hexdigest())
    except ClientDisconnect:
        await anyio.to_thread.run_sync(storage.discard_upload, staged)
        # the browser cancelled or went away: nobody receives this answer
        raise ApiError(400, "upload_cancelled", "The upload was cancelled.") from None
    except OSError as err:
        await anyio.to_thread.run_sync(storage.discard_upload, staged)
        if err.errno == errno.ENOSPC:
            raise no_space() from err
        raise
    except BaseException:
        await anyio.to_thread.run_sync(storage.discard_upload, staged)
        raise
