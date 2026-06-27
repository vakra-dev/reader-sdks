import { describe, it, expect, vi, afterEach } from "vitest";
import { ReaderClient } from "../src/client.js";
import {
  ReaderApiError,
  InsufficientCreditsError,
  InvalidRequestError,
  RateLimitedError,
  UnauthenticatedError,
  UpstreamUnavailableError,
  toReaderApiError,
} from "../src/errors.js";

/**
 * Mock response helper — builds a Response-like object with a given status
 * and JSON body, and an optional x-request-id header.
 */
function mockJson(
  body: unknown,
  { status = 200, requestId }: { status?: number; requestId?: string } = {},
) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === "x-request-id" ? requestId ?? null : null,
    },
    json: () => Promise.resolve(body),
  } as Response;
}

describe("ReaderClient", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // ────────────────────────────────────────────────────────────────
  describe("constructor", () => {
    it("throws when apiKey is empty", () => {
      expect(() => new ReaderClient({ apiKey: "" })).toThrow();
    });

    it("accepts a valid apiKey", () => {
      const client = new ReaderClient({ apiKey: "rdr_test123" });
      expect(client).toBeDefined();
    });

    it("accepts a custom baseUrl", () => {
      const client = new ReaderClient({
        apiKey: "rdr_test",
        baseUrl: "http://localhost:3001",
      });
      expect(client).toBeDefined();
    });

    it("strips trailing slashes from baseUrl", () => {
      const client = new ReaderClient({
        apiKey: "rdr_test",
        baseUrl: "https://api.reader.dev/",
      });
      expect(client).toBeDefined();
    });
  });

  // ────────────────────────────────────────────────────────────────
  describe("read() — sync scrape", () => {
    it("returns a discriminated scrape result", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        mockJson({
          success: true,
          data: {
            url: "https://example.com",
            markdown: "# Hello",
            metadata: {
              title: "Example",
              duration: 123,
              cached: false,
              proxyMode: "standard",
              scrapedAt: "2026-04-04T12:00:00Z",
            },
          },
        }),
      );

      const client = new ReaderClient({ apiKey: "rdr_test" });
      const result = await client.read({ url: "https://example.com" });

      expect(result.kind).toBe("scrape");
      if (result.kind !== "scrape") throw new Error("expected scrape");
      expect(result.data.markdown).toBe("# Hello");
      expect(result.data.metadata.proxyMode).toBe("standard");
      expect(result.data.metadata.cached).toBe(false);
    });

    it("exposes cache hits through metadata.cached", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        mockJson({
          success: true,
          data: {
            url: "https://example.com",
            markdown: "# Cached",
            metadata: {
              title: "Example",
              duration: 12,
              cached: true,
              scrapedAt: "2026-04-03T00:00:00Z",
            },
          },
        }),
      );

      const client = new ReaderClient({ apiKey: "rdr_test" });
      const result = await client.read({ url: "https://example.com" });

      if (result.kind !== "scrape") throw new Error("expected scrape");
      expect(result.data.metadata.cached).toBe(true);
    });
  });

  // ────────────────────────────────────────────────────────────────
  describe("read() — async batch job", () => {
    it("auto-polls until the job reaches a terminal state and collects all results", async () => {
      let pollCount = 0;

      global.fetch = vi.fn().mockImplementation((url: string) => {
        // POST /v1/read — returns queued job in data
        if (url.endsWith("/v1/read")) {
          return Promise.resolve(
            mockJson({
              success: true,
              data: {
                id: "j_1",
                status: "queued",
                mode: "batch",
                total: 2,
                completed: 0,
                creditsUsed: 0,
                createdAt: "2026-04-04T12:00:00Z",
              },
            }),
          );
        }

        const parsed = new URL(url);
        const limit = parsed.searchParams.get("limit");

        // Polling call from waitForJob — uses limit=1
        if (limit === "1") {
          pollCount++;
          const terminal = pollCount >= 2;
          return Promise.resolve(
            mockJson({
              success: true,
              data: {
                id: "j_1",
                status: terminal ? "completed" : "processing",
                mode: "batch",
                completed: terminal ? 2 : 1,
                total: 2,
                creditsUsed: terminal ? 2 : 1,
                error: null,
                results: [],
                startedAt: "2026-04-04T12:00:01Z",
                completedAt: terminal ? "2026-04-04T12:00:05Z" : null,
                createdAt: "2026-04-04T12:00:00Z",
              },
              pagination: { total: 2, skip: 0, limit: 1, hasMore: true },
            }),
          );
        }

        // Results collection call from getAllJobResults — uses limit=100
        if (limit === "100") {
          return Promise.resolve(
            mockJson({
              success: true,
              data: {
                id: "j_1",
                status: "completed",
                mode: "batch",
                completed: 2,
                total: 2,
                creditsUsed: 2,
                error: null,
                results: [
                  { url: "https://a.com", markdown: "# A", proxyMode: "standard", credits: 1 },
                  { url: "https://b.com", markdown: "# B", proxyMode: "standard", credits: 1 },
                ],
                startedAt: "2026-04-04T12:00:01Z",
                completedAt: "2026-04-04T12:00:05Z",
                createdAt: "2026-04-04T12:00:00Z",
              },
              pagination: { total: 2, skip: 0, limit: 100, hasMore: false },
            }),
          );
        }

        throw new Error(`unexpected url: ${url}`);
      });

      // Short poll interval to keep the test fast
      const client = new ReaderClient({ apiKey: "rdr_test" });
      const result = await client.waitForJob("j_1", { pollInterval: 10, timeout: 5000 });

      expect(result.status).toBe("completed");
      expect(result.results).toHaveLength(2);
      expect(result.results[0].url).toBe("https://a.com");
      expect(result.results[1].markdown).toBe("# B");
    }, 10000);
  });

  // ────────────────────────────────────────────────────────────────
  describe("getCredits()", () => {
    it("unwraps the envelope and returns the credits data", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        mockJson({
          success: true,
          data: {
            balance: 950,
            limit: 1000,
            used: 50,
            tier: "free",
            resetAt: "2026-05-01T00:00:00Z",
          },
        }),
      );

      const client = new ReaderClient({ apiKey: "rdr_test" });
      const credits = await client.getCredits();

      expect(credits.balance).toBe(950);
      expect(credits.tier).toBe("free");
      expect(credits.resetAt).toBe("2026-05-01T00:00:00Z");
    });
  });

  // ────────────────────────────────────────────────────────────────
  describe("error handling", () => {
    it("throws UnauthenticatedError on 401 with unauthenticated code", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        mockJson(
          {
            success: false,
            error: {
              code: "unauthenticated",
              message: "Missing or invalid API key",
              docsUrl: "https://reader.dev/docs/home/concepts/errors#unauthenticated",
            },
          },
          { status: 401, requestId: "req_abc" },
        ),
      );

      const client = new ReaderClient({ apiKey: "rdr_bad" });
      await expect(
        client.read({ url: "https://example.com" }),
      ).rejects.toBeInstanceOf(UnauthenticatedError);
    });

    it("throws InsufficientCreditsError on 402 and surfaces details", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        mockJson(
          {
            success: false,
            error: {
              code: "insufficient_credits",
              message: "Need 50, have 10",
              details: { required: 50, available: 10, resetAt: "2026-05-01T00:00:00Z" },
              docsUrl: "https://reader.dev/docs/home/concepts/errors#insufficient-credits",
            },
          },
          { status: 402 },
        ),
      );

      const client = new ReaderClient({ apiKey: "rdr_test" });

      try {
        await client.read({ url: "https://example.com" });
        throw new Error("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(InsufficientCreditsError);
        if (err instanceof InsufficientCreditsError) {
          expect(err.required).toBe(50);
          expect(err.available).toBe(10);
          expect(err.resetAt).toBe("2026-05-01T00:00:00Z");
          expect(err.code).toBe("insufficient_credits");
        }
      }
    });

    it("does not retry on 4xx client errors (except 429)", async () => {
      let calls = 0;
      global.fetch = vi.fn().mockImplementation(() => {
        calls++;
        return Promise.resolve(
          mockJson(
            {
              success: false,
              error: {
                code: "invalid_request",
                message: "Bad URL",
                docsUrl: "https://reader.dev/docs/home/concepts/errors#invalid-request",
              },
            },
            { status: 400 },
          ),
        );
      });

      const client = new ReaderClient({ apiKey: "rdr_test" });
      await expect(client.read({ url: "bad" })).rejects.toBeInstanceOf(
        InvalidRequestError,
      );
      expect(calls).toBe(1);
    });

    it("surfaces request ID from the x-request-id header on errors", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        mockJson(
          {
            success: false,
            error: {
              code: "internal_error",
              message: "boom",
              docsUrl: "https://reader.dev/docs/home/concepts/errors#internal-error",
            },
          },
          { status: 500, requestId: "req_trace_xyz" },
        ),
      );

      const client = new ReaderClient({ apiKey: "rdr_test" });
      try {
        await client.read({ url: "https://example.com" });
        throw new Error("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(ReaderApiError);
        if (err instanceof ReaderApiError) {
          expect(err.requestId).toBe("req_trace_xyz");
        }
      }
    });
  });

  // ────────────────────────────────────────────────────────────────
  describe("toReaderApiError dispatch", () => {
    it("builds the right subclass from the error code", () => {
      const rate = toReaderApiError(
        {
          code: "rate_limited",
          message: "slow down",
          details: { limit: 60, windowSeconds: 60, retryAfterSeconds: 12 },
        },
        429,
      );
      expect(rate).toBeInstanceOf(RateLimitedError);
      if (rate instanceof RateLimitedError) {
        expect(rate.retryAfterSeconds).toBe(12);
        expect(rate.limit).toBe(60);
      }

      const upstream = toReaderApiError(
        { code: "upstream_unavailable", message: "down" },
        502,
      );
      expect(upstream).toBeInstanceOf(UpstreamUnavailableError);

      const unknown = toReaderApiError(
        { code: "some_new_code", message: "future" },
        500,
      );
      expect(unknown).toBeInstanceOf(ReaderApiError);
      expect(unknown.code).toBe("some_new_code");
    });
  });
});
