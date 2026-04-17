/**
 * Reader SDK types. Shapes mirror the reader-api envelope contract.
 */

export interface ReaderClientConfig {
  /** API key (required) */
  apiKey: string;
  /** API base URL (default: https://api.reader.dev) */
  baseUrl?: string;
  /** Request timeout in ms (default: 60000) */
  timeout?: number;
  /** Max retries on transient failures (default: 2) */
  maxRetries?: number;
}

/** Public proxy mode. `auto` picks standard first and escalates to stealth on block. */
export type ProxyMode = "standard" | "stealth" | "auto";

export interface ReadParams {
  /** Single URL to scrape */
  url?: string;
  /** Multiple URLs for batch scraping */
  urls?: string[];
  /** Output formats (default: ["markdown"]) */
  formats?: Array<"markdown" | "html">;
  /** Extract main content only (default: true) */
  onlyMainContent?: boolean;
  /** CSS selectors to include */
  includeTags?: string[];
  /** CSS selectors to exclude */
  excludeTags?: string[];
  /** Wait for CSS selector before scraping */
  waitForSelector?: string;
  /** Per-URL timeout in ms (default: 30000) */
  timeoutMs?: number;
  /** Proxy mode: standard, stealth, or auto (default: auto) */
  proxyMode?: ProxyMode;
  /** Max crawl depth (triggers crawl mode) */
  maxDepth?: number;
  /** Max pages to crawl (triggers crawl mode) */
  maxPages?: number;
  /** Use cache (default: true) */
  cache?: boolean;
  /** Webhook for async job notifications */
  webhook?: { url: string; events?: string[]; secret?: string };
  /** Batch concurrency override */
  batchConcurrency?: number;
}

export interface ScrapeMetadata {
  title?: string | null;
  description?: string | null;
  statusCode?: number;
  duration: number;
  cached: boolean;
  /** Resolved proxy mode — `"standard"` or `"stealth"`. Omitted on cache hits. */
  proxyMode?: "standard" | "stealth";
  /** True if `auto` escalated from standard to stealth for this page. */
  proxyEscalated?: boolean;
  scrapedAt: string;
}

export interface Page {
  url: string;
  markdown?: string;
  html?: string;
  statusCode?: number;
  proxyMode?: "standard" | "stealth";
  proxyEscalated?: boolean;
  credits?: number;
  metadata?: ScrapeMetadata | Record<string, unknown>;
  error?: string;
}

/** Result of a synchronous scrape — single URL, returned immediately. */
export interface ScrapeResult {
  url: string;
  markdown?: string;
  html?: string;
  metadata: ScrapeMetadata;
}

export type JobStatus = "queued" | "processing" | "completed" | "failed" | "cancelled";
export type JobMode = "scrape" | "batch" | "crawl";

/** Job as returned from GET /v1/jobs/:id (data portion of envelope). */
export interface Job {
  id: string;
  status: JobStatus;
  mode: JobMode;
  completed: number;
  total: number;
  creditsUsed: number;
  error: string | null;
  /** Paginated page results. `waitForJob` auto-collects all pages across pages. */
  results: Page[];
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface Pagination {
  total: number;
  skip: number;
  limit: number;
  hasMore: boolean;
  next?: string;
}

/** Return type of `client.read(...)`. Discriminated by `kind`. */
export type ReadResult =
  | { kind: "scrape"; data: ScrapeResult }
  | { kind: "job"; data: Job };

export interface Credits {
  balance: number;
  limit: number;
  used: number;
  tier: "free" | "pro" | "business" | "enterprise" | string;
  resetAt: string;
}

export interface UsageEntry {
  id: string;
  url: string;
  duration: number;
  status: "success" | "error";
  cached: boolean;
  proxyMode: "standard" | "stealth" | null;
  credits: number;
  error: string | null;
  createdAt: string;
}

export type StreamEvent =
  | { type: "progress"; completed: number; total: number; status: JobStatus }
  | { type: "page"; data: Page }
  | { type: "error"; url: string; error: string }
  | { type: "done"; completed: number; total: number; status: JobStatus };

// ──────────────────────────────────────────────────────────────
// Envelope shapes (internal — used by the client to parse responses)
// ──────────────────────────────────────────────────────────────

export interface SuccessEnvelope<T> {
  success: true;
  data: T;
}

export interface PaginatedEnvelope<T> {
  success: true;
  data: T[];
  pagination: Pagination;
}

export interface ErrorEnvelope {
  success: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
    docsUrl?: string;
  };
}

export type ApiEnvelope<T> = SuccessEnvelope<T> | ErrorEnvelope;
