# @vakra-dev/reader-js

TypeScript/JavaScript SDK for the [Reader API](https://reader.dev) — content extraction for LLMs. Wraps `POST /v1/read`, parses the standard envelope, throws typed errors, and auto-polls async jobs to completion.

**Version:** 0.2.0 · **Runtime:** Node 18+, Deno, Bun, Cloudflare Workers, modern browsers

## Install

```bash
npm install @vakra-dev/reader-js
```

## Quick start

```ts
import { ReaderClient } from "@vakra-dev/reader-js";

const client = new ReaderClient({ apiKey: process.env.READER_KEY! });

const result = await client.read({ url: "https://example.com" });
if (result.kind === "scrape") {
  console.log(result.data.markdown);
}
```

`client.read(...)` returns a discriminated union:

- `{ kind: "scrape", data: ScrapeResult }` — single-URL requests, returned immediately
- `{ kind: "job", data: Job }` — batch and crawl requests, auto-polled to completion

## Features

- **One method for every read operation.** `client.read({ url })` for sync scrape, `{ urls: [...] }` for batch, `{ url, maxPages }` for crawl.
- **Typed errors for all 11 Reader error codes.** `InsufficientCreditsError`, `RateLimitedError`, `UrlBlockedError`, `ScrapeTimeoutError`, and more. Each subclass surfaces the relevant fields (e.g. `err.required`, `err.retryAfterSeconds`).
- **Automatic retries with exponential backoff** for transient codes (`rate_limited`, `upstream_unavailable`, `scrape_timeout`, …). Honors the `Retry-After` header on 429.
- **Pagination-aware job collection.** `waitForJob()` returns the full job with every page result collected across pagination boundaries.
- **SSE streaming.** `for await (const event of client.stream(jobId))` yields real-time `progress` / `page` / `error` / `done` events.
- **Request ID tracing.** Every error carries the `x-request-id` header value on `err.requestId` for support tickets.

## Browser Sessions

Launch a stealthed Chrome and connect Playwright or Puppeteer:

```ts
import { chromium } from "playwright-core";

const session = await client.sessions.create();
const browser = await chromium.connectOverCDP(session.wsEndpoint);
const page = await (await browser.newContext()).newPage();

await page.goto("https://example.com");
console.log(await page.title());

await browser.close();
await client.sessions.stop(session.sessionId);
```

Methods: `client.sessions.create()`, `.get(id)`, `.stop(id)`, `.list()`

## Browser usage

The SDK works in modern browsers via native `fetch`, but **do not ship your API key in browser code** — anyone can read and reuse it. Proxy requests through your own backend.

## Errors

```ts
import {
  ReaderApiError,
  InsufficientCreditsError,
  RateLimitedError,
  UrlBlockedError,
} from "@vakra-dev/reader-js";

try {
  await client.read({ url });
} catch (err) {
  if (err instanceof InsufficientCreditsError) {
    console.error(`Need ${err.required}, have ${err.available}`);
  } else if (err instanceof RateLimitedError) {
    console.error(`Retry after ${err.retryAfterSeconds}s`);
  } else if (err instanceof UrlBlockedError) {
    console.error(`Blocked: ${err.reason}`);
  } else if (err instanceof ReaderApiError) {
    console.error(`[${err.code}] ${err.message} — see ${err.docsUrl}`);
  } else {
    throw err;
  }
}
```

Full catalog of error codes: https://reader.dev/docs/home/concepts/errors

## Links

- **Docs:** https://reader.dev/docs
- **SDK reference:** https://reader.dev/docs/sdk/javascript
- **API reference:** https://reader.dev/docs/api-reference/read
- **Discord:** https://discord.gg/6tjkq7J5WV

## Development

```bash
npm install
npm run typecheck
npm run build    # builds to dist/
npm test         # vitest
```
