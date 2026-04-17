"""Synchronous Reader SDK client."""

from __future__ import annotations

import json
import time
from typing import Any, Iterator, Optional

import httpx

from .errors import (
    RateLimitedError,
    ReaderApiError,
    ScrapeTimeoutError,
    to_reader_api_error,
)
from .types import (
    Credits,
    DoneEvent,
    ErrorEvent,
    Job,
    JobReadResult,
    Page,
    PageEvent,
    ProgressEvent,
    ReadParams,
    ReadResult,
    ScrapeReadResult,
    ScrapeResult,
    StreamEvent,
)

DEFAULT_BASE_URL = "https://api.reader.dev"
DEFAULT_TIMEOUT = 60
DEFAULT_MAX_RETRIES = 2
DEFAULT_POLL_INTERVAL = 2
DEFAULT_POLL_TIMEOUT = 300
DEFAULT_STREAM_TIMEOUT = 600  # per-job stream can run longer than a poll


class ReaderClient:
    """Synchronous Reader API client.

    Example::

        client = ReaderClient(api_key="rdr_your_key")
        result = client.read(url="https://example.com")
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
        self._timeout = timeout
        self._max_retries = max_retries

        self._client = httpx.Client(
            base_url=self._base_url,
            headers={
                "x-api-key": api_key,
                "Content-Type": "application/json",
            },
            timeout=timeout,
        )

    def read(self, **kwargs: Any) -> ReadResult:
        """Read (scrape, batch, or crawl) URLs.

        Single URL → sync scrape, returned immediately.
        Multiple URLs or ``max_depth``/``max_pages`` → async job, polled to
        completion.
        """
        params = ReadParams(**kwargs)
        body = params.model_dump(exclude_none=True)
        api_body = _to_camel_case(body)

        envelope = self._request("POST", "/v1/read", json=api_body)
        data = envelope.get("data") or {}

        # Async job: data has status + mode, no markdown/metadata
        if "status" in data and "mode" in data and "metadata" not in data:
            job = self.wait_for_job(str(data["id"]))
            return JobReadResult(kind="job", data=job)

        # Sync scrape
        scrape = ScrapeResult(**_to_snake_case(data))
        return ScrapeReadResult(kind="scrape", data=scrape)

    def get_job(
        self,
        job_id: str,
        skip: Optional[int] = None,
        limit: Optional[int] = None,
    ) -> tuple[Job, bool]:
        """Get a single page of job results. Returns ``(job, has_more)``."""
        params: dict[str, Any] = {}
        if skip is not None:
            params["skip"] = skip
        if limit is not None:
            params["limit"] = limit

        envelope = self._request("GET", f"/v1/jobs/{job_id}", params=params or None)
        job = Job(**_to_snake_case(envelope["data"]))
        pagination = envelope.get("pagination") or {}
        return job, bool(pagination.get("hasMore"))

    def get_all_job_results(self, job_id: str) -> list[Page]:
        """Fetch every page result by following pagination."""
        pages: list[Page] = []
        skip = 0
        limit = 100
        while True:
            job, has_more = self.get_job(job_id, skip=skip, limit=limit)
            pages.extend(job.results)
            if not has_more:
                break
            skip += limit
        return pages

    def cancel_job(self, job_id: str) -> None:
        """Cancel a running job. Raises :class:`ConflictError` if terminal."""
        self._request("DELETE", f"/v1/jobs/{job_id}")

    def retry_job(self, job_id: str) -> dict[str, Any]:
        """Retry the failed URLs in a job."""
        envelope = self._request("POST", f"/v1/jobs/{job_id}/retry")
        return envelope["data"]

    def get_credits(self) -> Credits:
        """Get the current credit balance for this workspace."""
        envelope = self._request("GET", "/v1/usage/credits")
        return Credits(**_to_snake_case(envelope["data"]))

    def wait_for_job(
        self,
        job_id: str,
        poll_interval: int = DEFAULT_POLL_INTERVAL,
        timeout: int = DEFAULT_POLL_TIMEOUT,
    ) -> Job:
        """Poll a job until it terminates. Collects all results when done."""
        start = time.time()
        while time.time() - start < timeout:
            job, _ = self.get_job(job_id, limit=1)
            if job.status in ("completed", "failed", "cancelled"):
                if job.status == "completed":
                    job.results = self.get_all_job_results(job_id)
                return job
            time.sleep(poll_interval)

        raise ScrapeTimeoutError(
            f"Job {job_id} polling timed out after {timeout}s",
            code="scrape_timeout",
            http_status=504,
            details={"timeoutMs": timeout * 1000},
        )

    def stream(
        self,
        job_id: str,
        timeout: int = DEFAULT_STREAM_TIMEOUT,
    ) -> Iterator[StreamEvent]:
        """Stream real-time events for a running job via Server-Sent Events.

        Yields parsed :class:`StreamEvent` instances as the job makes progress.
        The stream closes automatically when the job reaches a terminal state.

        Example::

            for event in client.stream(job_id):
                if event.type == "page":
                    print("page:", event.data.url)
                elif event.type == "done":
                    print("finished:", event.status)
                    break
        """
        # SSE uses a long-lived connection; disconnect the default httpx
        # read-timeout (otherwise idle keep-alives trigger a timeout).
        url = f"{self._base_url}/v1/jobs/{job_id}/stream"
        headers = {"x-api-key": self._api_key, "Accept": "text/event-stream"}

        try:
            with httpx.Client(timeout=httpx.Timeout(None, connect=10.0)) as sse_client:
                with sse_client.stream("GET", url, headers=headers) as response:
                    if response.status_code >= 400:
                        # Drain the body so we can parse an error envelope
                        body_bytes = b"".join(response.iter_bytes())
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

                    yield from _parse_sse_stream(response.iter_lines(), timeout)
        except httpx.TimeoutException as exc:
            raise ScrapeTimeoutError(
                f"Job {job_id} stream timed out",
                code="scrape_timeout",
                http_status=504,
            ) from exc

    def close(self) -> None:
        self._client.close()

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()

    # ── Internal ─────────────────────────────────────────────────────

    def _request(self, method: str, path: str, **kwargs: Any) -> dict[str, Any]:
        """Send a request with retries on transient failures.

        Retries on 5xx and 429 with exponential backoff (1s, 2s, 4s...).
        For 429 the ``Retry-After`` header (seconds) overrides the backoff.
        Client errors (4xx other than 429) are raised immediately.
        """
        last_error: Optional[Exception] = None

        for attempt in range(self._max_retries + 1):
            try:
                res = self._client.request(method, path, **kwargs)
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

                # Error response — build typed exception
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

                # Never retry 4xx except 429
                if res.status_code < 500 and res.status_code != 429:
                    raise err

                # Honor Retry-After header on 429
                if isinstance(err, RateLimitedError) and err.retry_after_seconds:
                    if attempt < self._max_retries:
                        time.sleep(err.retry_after_seconds)
                        last_error = err
                        continue

                last_error = err

            # Exponential backoff before next attempt
            if attempt < self._max_retries:
                time.sleep(2 ** attempt)

        assert last_error is not None
        raise last_error


def _to_camel_case(data: dict[str, Any]) -> dict[str, Any]:
    """Convert snake_case dict keys to camelCase (top-level only)."""
    result: dict[str, Any] = {}
    for key, value in data.items():
        parts = key.split("_")
        camel = parts[0] + "".join(p.capitalize() for p in parts[1:])
        result[camel] = value
    return result


def _to_snake_case(data: Any) -> Any:
    """Recursively convert camelCase dict keys to snake_case."""
    import re

    if isinstance(data, dict):
        result: dict[str, Any] = {}
        for key, value in data.items():
            snake = re.sub(r"(?<!^)(?=[A-Z])", "_", key).lower()
            result[snake] = _to_snake_case(value)
        return result
    if isinstance(data, list):
        return [_to_snake_case(v) for v in data]
    return data


def _parse_sse_event(event_name: str, raw_data: str) -> Optional[StreamEvent]:
    """Parse a single SSE frame into a typed StreamEvent, or None if unknown."""
    try:
        payload = json.loads(raw_data)
    except json.JSONDecodeError:
        return None

    snake = _to_snake_case(payload)

    if event_name == "progress":
        return ProgressEvent(**snake)
    if event_name == "page":
        return PageEvent(data=Page(**snake))
    if event_name == "error":
        return ErrorEvent(**snake)
    if event_name == "done":
        return DoneEvent(**snake)
    return None


def _parse_sse_stream(lines: Iterator[str], timeout: int) -> Iterator[StreamEvent]:
    """Accumulate SSE lines into frames and yield parsed StreamEvents.

    SSE frames are separated by blank lines. Each frame has `event: <name>`
    and `data: <json>` lines. Comment lines (starting with `:`) are keep-alive
    pings and skipped. The generator completes when it yields a ``done`` event
    or the stream closes.
    """
    start = time.time()
    current_event = ""
    current_data: list[str] = []

    for line in lines:
        if time.time() - start > timeout:
            raise ScrapeTimeoutError(
                "Stream read timed out",
                code="scrape_timeout",
                http_status=504,
            )

        # Blank line = frame boundary
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

        # Comment / keep-alive
        if line.startswith(":"):
            continue

        if line.startswith("event:"):
            current_event = line[len("event:") :].strip()
        elif line.startswith("data:"):
            current_data.append(line[len("data:") :].strip())
