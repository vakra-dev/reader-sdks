"""Async Reader SDK client."""

from __future__ import annotations

import asyncio
import json
import time
from typing import Any, AsyncIterator, Optional

import httpx

from .client import (
    DEFAULT_BASE_URL,
    DEFAULT_MAX_RETRIES,
    DEFAULT_POLL_INTERVAL,
    DEFAULT_POLL_TIMEOUT,
    DEFAULT_STREAM_TIMEOUT,
    DEFAULT_TIMEOUT,
    _parse_sse_event,
    _to_camel_case,
    _to_snake_case,
)
from .errors import (
    RateLimitedError,
    ReaderApiError,
    ScrapeTimeoutError,
    to_reader_api_error,
)
from .types import (
    Credits,
    DoneEvent,
    Job,
    JobReadResult,
    Page,
    ReadParams,
    ReadResult,
    ScrapeReadResult,
    ScrapeResult,
    SessionInfo,
    StopSessionResult,
    StreamEvent,
)


class AsyncReaderClient:
    """Async Reader API client.

    Example::

        async with AsyncReaderClient(api_key="rdr_your_key") as client:
            result = await client.read(url="https://example.com")
            if result.kind == "scrape":
                print(result.data.markdown)
    """

    def __init__(
        self,
        api_key: str,
        base_url: str = DEFAULT_BASE_URL,
        timeout: int = DEFAULT_TIMEOUT,
        max_retries: int = DEFAULT_MAX_RETRIES,
    ):
        if not api_key:
            raise ReaderApiError(
                "API key is required",
                code="unauthenticated",
                http_status=401,
            )

        self._api_key = api_key
        self._base_url = base_url.rstrip("/")
        self._max_retries = max_retries

        self._client = httpx.AsyncClient(
            base_url=self._base_url,
            headers={
                "x-api-key": api_key,
                "Content-Type": "application/json",
            },
            timeout=timeout,
        )

        self.sessions = AsyncSessionsAPI(self._request)

    async def read(self, **kwargs: Any) -> ReadResult:
        """Read (scrape, batch, or crawl) URLs."""
        params = ReadParams(**kwargs)
        body = params.model_dump(exclude_none=True)
        api_body = _to_camel_case(body)

        envelope = await self._request("POST", "/v1/read", json=api_body)
        data = envelope.get("data") or {}

        if "status" in data and "mode" in data and "metadata" not in data:
            job = await self.wait_for_job(str(data["id"]))
            return JobReadResult(kind="job", data=job)

        scrape = ScrapeResult(**_to_snake_case(data))
        return ScrapeReadResult(kind="scrape", data=scrape)

    async def get_job(
        self,
        job_id: str,
        skip: Optional[int] = None,
        limit: Optional[int] = None,
    ) -> tuple[Job, bool]:
        params: dict[str, Any] = {}
        if skip is not None:
            params["skip"] = skip
        if limit is not None:
            params["limit"] = limit

        envelope = await self._request("GET", f"/v1/jobs/{job_id}", params=params or None)
        job = Job(**_to_snake_case(envelope["data"]))
        pagination = envelope.get("pagination") or {}
        return job, bool(pagination.get("hasMore"))

    async def get_all_job_results(self, job_id: str) -> list[Page]:
        pages: list[Page] = []
        skip = 0
        limit = 100
        while True:
            job, has_more = await self.get_job(job_id, skip=skip, limit=limit)
            pages.extend(job.results)
            if not has_more:
                break
            skip += limit
        return pages

    async def cancel_job(self, job_id: str) -> None:
        await self._request("DELETE", f"/v1/jobs/{job_id}")

    async def retry_job(self, job_id: str) -> dict[str, Any]:
        envelope = await self._request("POST", f"/v1/jobs/{job_id}/retry")
        return envelope["data"]

    async def get_credits(self) -> Credits:
        envelope = await self._request("GET", "/v1/usage/credits")
        return Credits(**_to_snake_case(envelope["data"]))

    async def wait_for_job(
        self,
        job_id: str,
        poll_interval: int = DEFAULT_POLL_INTERVAL,
        timeout: int = DEFAULT_POLL_TIMEOUT,
    ) -> Job:
        start = time.time()
        while time.time() - start < timeout:
            job, _ = await self.get_job(job_id, limit=1)
            if job.status in ("completed", "failed", "cancelled"):
                if job.status == "completed":
                    job.results = await self.get_all_job_results(job_id)
                return job
            await asyncio.sleep(poll_interval)

        raise ScrapeTimeoutError(
            f"Job {job_id} polling timed out after {timeout}s",
            code="scrape_timeout",
            http_status=504,
            details={"timeoutMs": timeout * 1000},
        )

    async def stream(
        self,
        job_id: str,
        timeout: int = DEFAULT_STREAM_TIMEOUT,
    ) -> AsyncIterator[StreamEvent]:
        """Stream real-time events for a running job via Server-Sent Events.

        Yields parsed :class:`StreamEvent` instances as the job makes progress.
        The stream closes automatically when the job reaches a terminal state.

        Example::

            async for event in client.stream(job_id):
                if event.type == "page":
                    print("page:", event.data.url)
                elif event.type == "done":
                    break
        """
        url = f"{self._base_url}/v1/jobs/{job_id}/stream"
        headers = {"x-api-key": self._api_key, "Accept": "text/event-stream"}

        try:
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(None, connect=10.0),
            ) as sse_client:
                async with sse_client.stream("GET", url, headers=headers) as response:
                    if response.status_code >= 400:
                        body_bytes = b""
                        async for chunk in response.aiter_bytes():
                            body_bytes += chunk
                        try:
                            body = json.loads(body_bytes.decode("utf-8"))
                        except (ValueError, UnicodeDecodeError):
                            body = None
                        request_id = response.headers.get("x-request-id")
                        if (
                            isinstance(body, dict)
                            and "error" in body
                            and isinstance(body["error"], dict)
                        ):
                            raise to_reader_api_error(
                                body["error"], response.status_code, request_id
                            )
                        raise ReaderApiError(
                            f"Stream failed with status {response.status_code}",
                            code="internal_error",
                            http_status=response.status_code,
                            request_id=request_id,
                        )

                    async for event in _parse_async_sse_stream(
                        response.aiter_lines(),
                        timeout,
                    ):
                        yield event
        except httpx.TimeoutException as exc:
            raise ScrapeTimeoutError(
                f"Job {job_id} stream timed out",
                code="scrape_timeout",
                http_status=504,
            ) from exc

    async def close(self) -> None:
        await self._client.aclose()

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        await self.close()

    async def _request(self, method: str, path: str, **kwargs: Any) -> dict[str, Any]:
        """Send a request with retries on transient failures.

        Retries on 5xx and 429 with exponential backoff (1s, 2s, 4s...).
        For 429 the ``Retry-After`` header (seconds) overrides the backoff.
        Client errors (4xx other than 429) are raised immediately.
        """
        last_error: Optional[Exception] = None

        for attempt in range(self._max_retries + 1):
            try:
                res = await self._client.request(method, path, **kwargs)
            except httpx.TimeoutException as exc:
                last_error = ScrapeTimeoutError(
                    "Request timed out",
                    code="scrape_timeout",
                    http_status=504,
                )
                last_error.__cause__ = exc
            except httpx.ConnectError as exc:
                last_error = ReaderApiError(
                    "Connection failed",
                    code="upstream_unavailable",
                    http_status=502,
                )
                last_error.__cause__ = exc
            else:
                request_id = res.headers.get("x-request-id")
                try:
                    data = res.json()
                except Exception:
                    data = None

                if res.status_code < 400:
                    if not isinstance(data, dict):
                        raise ReaderApiError(
                            "Invalid response from Reader API",
                            code="internal_error",
                            http_status=res.status_code,
                            request_id=request_id,
                        )
                    return data

                if isinstance(data, dict) and isinstance(data.get("error"), dict):
                    err: ReaderApiError = to_reader_api_error(
                        data["error"], res.status_code, request_id
                    )
                else:
                    err = ReaderApiError(
                        f"Request failed with status {res.status_code}",
                        code="internal_error",
                        http_status=res.status_code,
                        request_id=request_id,
                    )

                if res.status_code < 500 and res.status_code != 429:
                    raise err

                if isinstance(err, RateLimitedError) and err.retry_after_seconds:
                    if attempt < self._max_retries:
                        await asyncio.sleep(err.retry_after_seconds)
                        last_error = err
                        continue

                last_error = err

            if attempt < self._max_retries:
                await asyncio.sleep(2 ** attempt)

        assert last_error is not None
        raise last_error


async def _parse_async_sse_stream(
    lines: AsyncIterator[str],
    timeout: int,
) -> AsyncIterator[StreamEvent]:
    """Async variant of client._parse_sse_stream — accumulates SSE lines
    into frames and yields parsed StreamEvents. Uses the same frame parser
    helper (_parse_sse_event) as the sync client.
    """
    start = time.time()
    current_event = ""
    current_data: list[str] = []

    async for line in lines:
        if time.time() - start > timeout:
            raise ScrapeTimeoutError(
                "Stream read timed out",
                code="scrape_timeout",
                http_status=504,
            )

        if line == "":
            if current_event and current_data:
                parsed = _parse_sse_event(current_event, "\n".join(current_data))
                if parsed is not None:
                    yield parsed
                    if isinstance(parsed, DoneEvent):
                        return
            current_event = ""
            current_data = []
            continue

        if line.startswith(":"):
            continue

        if line.startswith("event:"):
            current_event = line[len("event:") :].strip()
        elif line.startswith("data:"):
            current_data.append(line[len("data:") :].strip())


class AsyncSessionsAPI:
    """Browser sessions API (async)."""

    def __init__(self, request_fn: Any):
        self._request = request_fn

    async def create(self, **kwargs: Any) -> SessionInfo:
        """Create a browser session. Returns a CDP WebSocket URL."""
        body = _to_camel_case(kwargs) if kwargs else {}
        envelope = await self._request("POST", "/v1/sessions", json=body)
        return SessionInfo(**_to_snake_case(envelope["data"]))

    async def get(self, session_id: str) -> SessionInfo:
        """Get session status."""
        envelope = await self._request("GET", f"/v1/sessions/{session_id}")
        return SessionInfo(**_to_snake_case(envelope["data"]))

    async def stop(self, session_id: str) -> StopSessionResult:
        """Stop a browser session."""
        envelope = await self._request("DELETE", f"/v1/sessions/{session_id}")
        return StopSessionResult(**_to_snake_case(envelope["data"]))

    async def list(self) -> list[SessionInfo]:
        """List active sessions."""
        envelope = await self._request("GET", "/v1/sessions")
        data = envelope["data"]
        return [SessionInfo(**_to_snake_case(s)) for s in data]
