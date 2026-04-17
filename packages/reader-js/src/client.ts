/**
 * Reader SDK Client
 *
 * @example
 * import { ReaderClient } from "@vakra-dev/reader-js";
 *
 * const client = new ReaderClient({ apiKey: "rdr_your_key" });
 *
 * // Synchronous scrape (single URL)
 * const result = await client.read({ url: "https://example.com" });
 * if (result.kind === "scrape") {
 *   console.log(result.data.markdown);
 * }
 *
 * // Batch (returns a completed Job with all results collected)
 * const batch = await client.read({ urls: ["url1", "url2"] });
 * if (batch.kind === "job") {
 *   for (const page of batch.data.results) {
 *     console.log(page.url, page.markdown?.length);
 *   }
 * }
 */

import type {
  ReaderClientConfig,
  ReadParams,
  ReadResult,
  ScrapeResult,
  Job,
  Credits,
  Page,
  StreamEvent,
  SuccessEnvelope,
  PaginatedEnvelope,
  ErrorEnvelope,
} from "./types.js";
import {
  toReaderApiError,
  ReaderApiError,
  ScrapeTimeoutError,
  RateLimitedError,
} from "./errors.js";

const DEFAULT_BASE_URL = "https://api.reader.dev";
const DEFAULT_TIMEOUT = 60_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_POLL_INTERVAL = 2_000;
const DEFAULT_POLL_TIMEOUT = 300_000; // 5 minutes

interface JobWithPagination {
  data: Job;
  pagination: { total: number; skip: number; limit: number; hasMore: boolean; next?: string };
}

export class ReaderClient {
  private apiKey: string;
  private baseUrl: string;
  private timeout: number;
  private maxRetries: number;

  constructor(config: ReaderClientConfig) {
    if (!config.apiKey) {
      throw new Error("API key is required");
    }
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, "");
    this.timeout = config.timeout || DEFAULT_TIMEOUT;
    this.maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
  }

  /**
   * Read (scrape, batch, or crawl) one or more URLs.
   *
   * - Single URL → sync scrape, returns immediately with `{ kind: "scrape", data }`
   * - Multiple URLs or URL + maxDepth/maxPages → async job; this method polls
   *   until the job terminates and returns `{ kind: "job", data }`.
   */
  async read(params: ReadParams): Promise<ReadResult> {
    const envelope = await this.request<SuccessEnvelope<unknown>>(
      "POST",
      "/v1/read",
      params,
    );

    const data = envelope.data as Record<string, unknown>;

    // Async job response: data.id + data.status present, no markdown/html/metadata
    if (
      data &&
      typeof data === "object" &&
      "status" in data &&
      "mode" in data &&
      !("markdown" in data) &&
      !("metadata" in data)
    ) {
      const jobId = String((data as { id: unknown }).id);
      const job = await this.waitForJob(jobId);
      return { kind: "job", data: job };
    }

    // Synchronous scrape: data has markdown/html/metadata
    return { kind: "scrape", data: data as unknown as ScrapeResult };
  }

  /**
   * Get job status and a single page of results.
   */
  async getJob(
    jobId: string,
    opts?: { skip?: number; limit?: number },
  ): Promise<{ job: Job; hasMore: boolean; next?: string }> {
    const query = new URLSearchParams();
    if (opts?.skip !== undefined) query.set("skip", String(opts.skip));
    if (opts?.limit !== undefined) query.set("limit", String(opts.limit));
    const qs = query.toString();

    const envelope = await this.request<JobWithPagination>(
      "GET",
      `/v1/jobs/${jobId}${qs ? `?${qs}` : ""}`,
    );

    return {
      job: envelope.data,
      hasMore: envelope.pagination.hasMore,
      next: envelope.pagination.next,
    };
  }

  /**
   * Fetch all job result pages by following pagination.
   */
  async getAllJobResults(jobId: string): Promise<Page[]> {
    const pages: Page[] = [];
    let skip = 0;
    const limit = 100;

    while (true) {
      const { job, hasMore } = await this.getJob(jobId, { skip, limit });
      pages.push(...(job.results ?? []));
      if (!hasMore) break;
      skip += limit;
    }

    return pages;
  }

  /**
   * Cancel a job. Throws `ConflictError` if the job is already terminal.
   */
  async cancelJob(jobId: string): Promise<void> {
    await this.request("DELETE", `/v1/jobs/${jobId}`);
  }

  /**
   * Retry the failed URLs in a job. Throws `InvalidRequestError` if no
   * failed URLs exist.
   */
  async retryJob(jobId: string): Promise<{ id: string; status: string; retrying: number }> {
    const envelope = await this.request<
      SuccessEnvelope<{ id: string; status: string; retrying: number }>
    >("POST", `/v1/jobs/${jobId}/retry`);
    return envelope.data;
  }

  /**
   * Poll a job until it completes, fails, or is cancelled. Collects all
   * paginated results when complete.
   */
  async waitForJob(
    jobId: string,
    options?: { pollInterval?: number; timeout?: number },
  ): Promise<Job> {
    const interval = options?.pollInterval ?? DEFAULT_POLL_INTERVAL;
    const timeout = options?.timeout ?? DEFAULT_POLL_TIMEOUT;
    const start = Date.now();

    while (Date.now() - start < timeout) {
      const { job } = await this.getJob(jobId, { limit: 1 });

      if (
        job.status === "completed" ||
        job.status === "failed" ||
        job.status === "cancelled"
      ) {
        if (job.status === "completed") {
          job.results = await this.getAllJobResults(jobId);
        }
        return job;
      }

      await sleep(interval);
    }

    throw new ScrapeTimeoutError(
      {
        code: "scrape_timeout",
        message: `Job ${jobId} polling timed out after ${timeout}ms`,
        details: { timeoutMs: timeout },
      },
      504,
    );
  }

  /**
   * Stream job results as they arrive via polling.
   *
   * @example
   * for await (const event of client.stream(jobId)) {
   *   if (event.type === "page") console.log(event.data.url);
   *   if (event.type === "done") break;
   * }
   */
  async *stream(
    jobId: string,
    options?: { pollInterval?: number; timeout?: number },
  ): AsyncGenerator<StreamEvent> {
    const interval = options?.pollInterval ?? DEFAULT_POLL_INTERVAL;
    const timeout = options?.timeout ?? DEFAULT_POLL_TIMEOUT;
    const start = Date.now();
    let lastCompleted = 0;

    while (Date.now() - start < timeout) {
      const { job } = await this.getJob(jobId, { skip: lastCompleted, limit: 100 });

      yield {
        type: "progress",
        completed: job.completed,
        total: job.total,
        status: job.status,
      };

      for (const page of job.results ?? []) {
        if (page.error) {
          yield { type: "error", url: page.url, error: page.error };
        } else {
          yield { type: "page", data: page };
        }
        lastCompleted += 1;
      }

      if (
        job.status === "completed" ||
        job.status === "failed" ||
        job.status === "cancelled"
      ) {
        yield {
          type: "done",
          completed: job.completed,
          total: job.total,
          status: job.status,
        };
        return;
      }

      await sleep(interval);
    }

    throw new ScrapeTimeoutError(
      {
        code: "scrape_timeout",
        message: `Job ${jobId} stream timed out`,
        details: { timeoutMs: timeout },
      },
      504,
    );
  }

  /**
   * Get the current credit balance for this workspace.
   */
  async getCredits(): Promise<Credits> {
    const envelope = await this.request<SuccessEnvelope<Credits>>("GET", "/v1/usage/credits");
    return envelope.data;
  }

  // --- Internal ---

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = path.startsWith("http") ? path : `${this.baseUrl}${path}`;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);

        const res = await fetch(url, {
          method,
          headers: {
            "Content-Type": "application/json",
            "x-api-key": this.apiKey,
          },
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        const requestId = res.headers.get("x-request-id") ?? undefined;
        const parsed = (await res.json().catch(() => null)) as
          | SuccessEnvelope<unknown>
          | PaginatedEnvelope<unknown>
          | ErrorEnvelope
          | null;

        if (!res.ok) {
          if (parsed && "error" in parsed && parsed.error) {
            const err = toReaderApiError(parsed.error, res.status, requestId);

            // Don't retry client errors except 429
            if (res.status < 500 && res.status !== 429) throw err;

            // Honor Retry-After from the rate-limited response
            if (err instanceof RateLimitedError && err.retryAfterSeconds) {
              await sleep(err.retryAfterSeconds * 1000);
            }

            lastError = err;
          } else {
            const genericErr = new ReaderApiError(
              {
                code: "internal_error",
                message: `Request failed with status ${res.status}`,
              },
              res.status,
              requestId,
            );
            if (res.status < 500) throw genericErr;
            lastError = genericErr;
          }
        } else {
          return parsed as unknown as T;
        }
      } catch (err) {
        if (err instanceof ReaderApiError) {
          if (err.httpStatus < 500 && err.httpStatus !== 429) throw err;
          lastError = err;
        } else if (err instanceof Error) {
          if (err.name === "AbortError") {
            lastError = new ReaderApiError(
              { code: "scrape_timeout", message: "Request timed out" },
              504,
            );
          } else {
            lastError = err;
          }
        }
      }

      // Exponential backoff before retry
      if (attempt < this.maxRetries) {
        await sleep(Math.pow(2, attempt) * 1000);
      }
    }

    throw (
      lastError ??
      new ReaderApiError({ code: "internal_error", message: "Request failed" }, 500)
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
