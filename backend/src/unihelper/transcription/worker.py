"""In-process background worker for transcription jobs (004 research B4).

SQLite is the queue: the worker claims the oldest `queued` job with an atomic UPDATE, runs it as
an asyncio task (database work in threads, provider HTTP async), and is woken when a job is
created/retried/cancelled, with a 5 s poll as a safety net. Jobs survive restarts (`recover`).
"""

from __future__ import annotations

import asyncio
import contextlib
import functools
import logging
from collections.abc import Awaitable, Callable, Sequence

import httpx
from sqlalchemy.orm import Session, sessionmaker

from unihelper.services import proxy_service
from unihelper.services import transcription_service as svc
from unihelper.storage.storage_service import StorageService
from unihelper.transcription.base import Progress, ProviderError
from unihelper.transcription.config import JobConfig, read_secret
from unihelper.transcription.providers import build

log = logging.getLogger("unihelper.transcription")
POLL_SECONDS = 5.0
PROGRESS_STEP = 0.02


class TranscriptionWorker:
    def __init__(
        self,
        maker: sessionmaker[Session],
        storage: StorageService,
        *,
        concurrency: int = 2,
        transport: httpx.AsyncBaseTransport | None = None,
        retry_delays: Sequence[float] = (2, 8, 30),
    ) -> None:
        self.maker = maker
        self.storage = storage
        self.concurrency = max(1, concurrency)
        self.transport = transport  # tests route provider HTTP to the fake transcriber
        self.retry_delays = tuple(retry_delays)
        self.loop: asyncio.AbstractEventLoop | None = None
        self._event: asyncio.Event | None = None
        self._loop_task: asyncio.Task[None] | None = None
        self._tasks: dict[str, asyncio.Task[None]] = {}
        self._user_cancelled: set[str] = set()
        # 016: accounts whose data is being restored get no new jobs started
        self.paused_users: Callable[[], frozenset[str]] = frozenset

    # ---- lifecycle (FastAPI lifespan) ---------------------------------------------------

    async def start(self) -> None:
        self.loop = asyncio.get_running_loop()
        self._event = asyncio.Event()
        self._loop_task = asyncio.create_task(self._main())

    async def stop(self) -> None:
        if self._loop_task:
            self._loop_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._loop_task
        tasks = list(self._tasks.values())
        for t in tasks:
            t.cancel()  # jobs stay in their stage; `recover` requeues them on the next start
        await asyncio.gather(*tasks, return_exceptions=True)

    def wake(self) -> None:
        """Thread-safe: called after a request committed a new/retried job."""
        if self.loop and self._event:
            self.loop.call_soon_threadsafe(self._event.set)

    def interrupt(self, job_id: str) -> None:
        """Thread-safe: cancel a running job's in-flight work (user pressed Cancel)."""
        if not self.loop:
            return

        def _cancel() -> None:
            task = self._tasks.get(job_id)
            if task and not task.done():
                self._user_cancelled.add(job_id)
                task.cancel()

        self.loop.call_soon_threadsafe(_cancel)

    async def _main(self) -> None:
        await self._recover()
        assert self._event is not None
        while True:
            self._fill()
            try:
                await asyncio.wait_for(self._event.wait(), POLL_SECONDS)
            except TimeoutError:
                pass
            self._event.clear()

    def _fill(self) -> None:
        """Start queued jobs up to the concurrency limit (oldest first)."""
        # a cheap synchronous read: one indexed query on the local SQLite file
        for job_id in svc.queued_ids(self.maker, self.paused_users()):
            if len(self._tasks) >= self.concurrency:
                return
            if job_id in self._tasks:
                continue
            task = asyncio.create_task(self._run(job_id))
            self._tasks[job_id] = task
            task.add_done_callback(functools.partial(self._done, job_id))

    def _done(self, job_id: str, _task: object = None) -> None:
        self._tasks.pop(job_id, None)
        if self._event:
            self._event.set()  # a slot is free

    async def _recover(self) -> None:
        for job_id in await asyncio.to_thread(svc.recover, self.maker):
            try:
                await asyncio.to_thread(svc.append_result, self.maker, self.storage, job_id)
            except Exception:  # pragma: no cover - logged, job stays visible for Retry
                log.exception("recovering job %s failed", job_id)

    # ---- tests: run everything queued, deterministically ------------------------------

    async def run_pending(self) -> None:
        self.loop = asyncio.get_running_loop()
        await self._recover()
        while ids := svc.queued_ids(self.maker):
            task = asyncio.create_task(self._run(ids[0]))
            self._tasks[ids[0]] = task
            try:
                await task
            finally:
                self._tasks.pop(ids[0], None)

    # ---- one job ---------------------------------------------------------------------

    async def _run(self, job_id: str) -> None:
        if not await asyncio.to_thread(svc.claim, self.maker, job_id):
            return
        try:
            proxy = await asyncio.to_thread(svc.proxy_for_job, self.maker, job_id)
            async with proxy_service.client(proxy, self.transport) as http:
                await self._transcribe(job_id, http, proxied=proxy is not None)
            await asyncio.to_thread(svc.append_result, self.maker, self.storage, job_id)
        except ProviderError as err:
            await asyncio.to_thread(svc.fail, self.maker, job_id, err)
        except svc.JobCancelled:
            await asyncio.to_thread(svc.mark_cancelled, self.maker, job_id)
        except asyncio.CancelledError:
            if job_id in self._user_cancelled:
                self._user_cancelled.discard(job_id)
                await asyncio.to_thread(svc.mark_cancelled, self.maker, job_id)
                return
            raise  # shutdown: left in its stage for `recover`
        except Exception:
            log.exception("transcription job %s crashed", job_id)
            await asyncio.to_thread(svc.fail, self.maker, job_id, ProviderError("unknown"))

    async def _transcribe(self, job_id: str, http: httpx.AsyncClient, proxied: bool) -> None:
        plan = await asyncio.to_thread(svc.prepare, self.maker, self.storage, job_id)
        provider = build(plan.provider_id, http, proxied=proxied)
        config = JobConfig(
            plan.values, lambda: read_secret(self.maker, plan.user_id, plan.provider_id)
        )
        count = len(plan.parts)
        language = None if plan.language == "auto" else plan.language
        for index in range(len(plan.done), count):
            await asyncio.to_thread(svc.check_cancel, self.maker, job_id)
            await asyncio.to_thread(
                svc.set_stage, self.maker, job_id, "uploading", index, index / count
            )
            text = await self._with_retries(
                functools.partial(
                    provider.transcribe,
                    plan.parts[index],
                    language,
                    config,
                    self._progress(job_id, index, count),
                )
            )
            await asyncio.to_thread(svc.save_part, self.maker, job_id, index, text, count)
        await asyncio.to_thread(svc.check_cancel, self.maker, job_id)

    def _progress(self, job_id: str, index: int, count: int) -> Progress:
        """Upload progress of one part → overall progress; the stage turns to `transcribing`
        once the part is uploaded (the provider is then working on it)."""
        state = {"last": -1.0, "transcribing": False}

        async def report(fraction: float) -> None:
            overall = (index + 0.5 * fraction) / count
            if fraction >= 1.0 and not state["transcribing"]:
                state["transcribing"] = True
                await asyncio.to_thread(
                    svc.set_stage, self.maker, job_id, "transcribing", index, overall
                )
            elif overall - state["last"] >= PROGRESS_STEP:
                state["last"] = overall
                await asyncio.to_thread(svc.set_progress, self.maker, job_id, overall)

        return report

    async def _with_retries(self, call: Callable[[], Awaitable[str]]) -> str:
        for attempt in range(len(self.retry_delays) + 1):
            try:
                return await call()
            except ProviderError as err:
                if not err.retryable or attempt == len(self.retry_delays):
                    raise
                await asyncio.sleep(self.retry_delays[attempt])
        raise AssertionError("unreachable")  # pragma: no cover
