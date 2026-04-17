# reader-py

Python SDK for the [Reader API](https://reader.dev) — content extraction for LLMs. Wraps `POST /v1/read`, parses responses into Pydantic models, raises typed exceptions, and auto-polls async jobs to completion.

**Version:** 0.2.0 · **Python:** 3.9+

## Install

```bash
pip install reader-py
```

## Quick start (sync)

```python
import os
from reader_py import ReaderClient

client = ReaderClient(api_key=os.environ["READER_KEY"])

result = client.read(url="https://example.com")
if result.kind == "scrape":
    print(result.data.markdown)
```

## Quick start (async)

```python
import asyncio
import os
from reader_py import AsyncReaderClient

async def main():
    async with AsyncReaderClient(api_key=os.environ["READER_KEY"]) as client:
        result = await client.read(url="https://example.com")
        if result.kind == "scrape":
            print(result.data.markdown)

asyncio.run(main())
```

`client.read(...)` returns a discriminated union (Pydantic):

- `ScrapeReadResult(kind="scrape", data=ScrapeResult)` — single-URL requests, returned immediately
- `JobReadResult(kind="job", data=Job)` — batch and crawl requests, auto-polled to completion

## Features

- **Sync and async clients** — `ReaderClient` (blocking, backed by `httpx.Client`) and `AsyncReaderClient` (backed by `httpx.AsyncClient`). Same method surface.
- **Typed errors for all 11 Reader error codes.** `InsufficientCreditsError`, `RateLimitedError`, `UrlBlockedError`, `ScrapeTimeoutError`, and more. Each subclass exposes the relevant fields (e.g. `err.required`, `err.retry_after_seconds`).
- **Automatic retries with exponential backoff** for transient codes. Honors the `Retry-After` header on 429.
- **Pagination-aware job collection.** `wait_for_job()` returns the full job with every page result.
- **SSE streaming.** `for event in client.stream(job_id)` (sync) or `async for` (async) yields `ProgressEvent` / `PageEvent` / `ErrorEvent` / `DoneEvent`.
- **Pydantic models everywhere** — all responses are parsed into typed models with IDE autocomplete.
- **Request ID tracing.** Every error carries the `x-request-id` header value on `err.request_id` for support tickets.

## Errors

```python
from reader_py import (
    ReaderApiError,
    InsufficientCreditsError,
    RateLimitedError,
    UrlBlockedError,
)

try:
    client.read(url=url)
except InsufficientCreditsError as err:
    print(f"Need {err.required}, have {err.available}")
except RateLimitedError as err:
    print(f"Retry after {err.retry_after_seconds}s")
except UrlBlockedError as err:
    print(f"Blocked: {err.reason}")
except ReaderApiError as err:
    print(f"[{err.code}] {err} — see {err.docs_url}")
```

`ReaderError` is re-exported as an alias for `ReaderApiError` so code written against the 0.1 SDK continues to work. New code should use `ReaderApiError`.

Full catalog of error codes: https://reader.dev/docs/home/concepts/errors

## Links

- **Docs:** https://reader.dev/docs
- **SDK reference:** https://reader.dev/docs/sdk/python
- **API reference:** https://reader.dev/docs/api-reference/read
- **Discord:** https://discord.gg/6tjkq7J5WV

## Development

```bash
python -m venv .venv && source .venv/bin/activate
pip install -e .[dev]
pytest
```
