# reader-sdks

Official client SDKs for the [Reader API](https://reader.dev) — content extraction for LLM pipelines.

This monorepo holds the JavaScript/TypeScript and Python clients. Both wrap `POST /v1/read`, expose typed errors for all 11 Reader error codes, auto-poll async jobs to completion, and stream job events via SSE.

## Packages

| Package | Language | Install | Version |
|---|---|---|---|
| [`@vakra-dev/reader-js`](./packages/reader-js) | TypeScript / JavaScript | `npm install @vakra-dev/reader-js` | 0.2.0 |
| [`reader-py`](./packages/reader-py) | Python 3.9+ | `pip install reader-py` | 0.2.0 |

Both packages stay at matching major.minor versions so the surface is identical across languages.

## Quick start

### JavaScript / TypeScript

```ts
import { ReaderClient } from "@vakra-dev/reader-js";

const reader = new ReaderClient({ apiKey: process.env.READER_KEY! });

const result = await reader.read({ url: "https://example.com" });
if (result.kind === "scrape") {
  console.log(result.data.markdown);
}
```

### Python

```python
from reader_py import ReaderClient

reader = ReaderClient(api_key="rdr_your_key")
result = reader.read(url="https://example.com")
if result.kind == "scrape":
    print(result.data.markdown)
```

`reader.read(...)` returns a discriminated union — single-URL requests resolve to a `ScrapeReadResult` synchronously, batch and crawl requests resolve to a `JobReadResult` after the SDK polls the job to completion.

## Browser Sessions

Both SDKs support browser sessions — launch a stealthed Chrome and connect Playwright/Puppeteer:

### JavaScript

```ts
const session = await reader.sessions.create();
const browser = await chromium.connectOverCDP(session.wsEndpoint);
// ... use Playwright ...
await reader.sessions.stop(session.sessionId);
```

### Python

```python
session = reader.sessions.create()
browser = playwright.chromium.connect_over_cdp(session.ws_endpoint)
# ... use Playwright ...
reader.sessions.stop(session.session_id)
```

See `reader.sessions.create()`, `.get()`, `.stop()`, `.list()` in both SDKs.

## Features (both SDKs)

- **Discriminated `ReadResult`** — `kind: "scrape" | "job"` narrows `data` to the concrete type for IDE autocomplete and type checkers
- **Typed error classes** for every Reader error code (`InsufficientCreditsError`, `RateLimitedError`, `UrlBlockedError`, `ScrapeTimeoutError`, `ConcurrencyLimitedError`, etc.) — each exposes the relevant detail fields
- **Automatic retries with exponential backoff** for 5xx and 429 responses; honours the `Retry-After` header on rate-limit errors
- **Pagination-aware job collection** — `wait_for_job` / `waitForJob` returns the full result set across all pages
- **SSE streaming** — `reader.stream(jobId)` yields `progress` / `page` / `error` / `done` events as the job runs
- **Request ID tracing** — every error carries the `x-request-id` header on `err.request_id` / `err.requestId` for support tickets

Python adds a parallel `AsyncReaderClient` backed by `httpx.AsyncClient` with the same method surface.

## Development

```bash
# JavaScript SDK
cd packages/reader-js
npm install
npm run build
npm test

# Python SDK
cd packages/reader-py
python -m venv .venv && source .venv/bin/activate
pip install -e .[dev]
pytest
```

## Links

- **API docs:** https://reader.dev/docs
- **SDK reference:** https://reader.dev/docs/sdk/overview
- **API reference (OpenAPI):** https://reader.dev/docs/api-reference/read
- **Dashboard:** https://console.reader.dev

## License

MIT. See [LICENSE](./LICENSE). Copyright © 2026 vakra-dev.
