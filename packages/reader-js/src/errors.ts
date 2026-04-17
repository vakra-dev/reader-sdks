/**
 * Typed error classes mirroring the reader-api error code catalog.
 *
 * The API returns a stable `code` field on every error response. The SDK
 * branches on that code and throws a specific subclass, so callers can
 * write:
 *
 *   try {
 *     await client.read({ url });
 *   } catch (err) {
 *     if (err instanceof InsufficientCreditsError) {
 *       // err.required, err.available, err.resetAt
 *     }
 *   }
 *
 * There is one subclass per code in the catalog. Unknown codes fall through
 * to the base `ReaderApiError`.
 */

export type ReaderErrorCode =
  | "invalid_request"
  | "unauthenticated"
  | "insufficient_credits"
  | "url_blocked"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "concurrency_limited"
  | "internal_error"
  | "upstream_unavailable"
  | "scrape_timeout";

export interface ApiErrorBody {
  code: ReaderErrorCode | string;
  message: string;
  details?: Record<string, unknown>;
  docsUrl?: string;
}

export class ReaderApiError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  readonly details?: Record<string, unknown>;
  readonly docsUrl?: string;
  readonly requestId?: string;

  constructor(body: ApiErrorBody, httpStatus: number, requestId?: string) {
    super(body.message);
    this.name = "ReaderApiError";
    this.code = body.code;
    this.httpStatus = httpStatus;
    this.details = body.details;
    this.docsUrl = body.docsUrl;
    this.requestId = requestId;
  }
}

export class InvalidRequestError extends ReaderApiError {
  constructor(body: ApiErrorBody, status: number, requestId?: string) {
    super(body, status, requestId);
    this.name = "InvalidRequestError";
  }
}

export class UnauthenticatedError extends ReaderApiError {
  constructor(body: ApiErrorBody, status: number, requestId?: string) {
    super(body, status, requestId);
    this.name = "UnauthenticatedError";
  }
}

export class InsufficientCreditsError extends ReaderApiError {
  readonly required?: number;
  readonly available?: number;
  readonly resetAt?: string;

  constructor(body: ApiErrorBody, status: number, requestId?: string) {
    super(body, status, requestId);
    this.name = "InsufficientCreditsError";
    this.required = body.details?.required as number | undefined;
    this.available = body.details?.available as number | undefined;
    this.resetAt = body.details?.resetAt as string | undefined;
  }
}

export class UrlBlockedError extends ReaderApiError {
  readonly url?: string;
  readonly reason?: string;

  constructor(body: ApiErrorBody, status: number, requestId?: string) {
    super(body, status, requestId);
    this.name = "UrlBlockedError";
    this.url = body.details?.url as string | undefined;
    this.reason = body.details?.reason as string | undefined;
  }
}

export class NotFoundError extends ReaderApiError {
  constructor(body: ApiErrorBody, status: number, requestId?: string) {
    super(body, status, requestId);
    this.name = "NotFoundError";
  }
}

export class ConflictError extends ReaderApiError {
  constructor(body: ApiErrorBody, status: number, requestId?: string) {
    super(body, status, requestId);
    this.name = "ConflictError";
  }
}

export class RateLimitedError extends ReaderApiError {
  readonly retryAfterSeconds?: number;
  readonly limit?: number;
  readonly windowSeconds?: number;

  constructor(body: ApiErrorBody, status: number, requestId?: string) {
    super(body, status, requestId);
    this.name = "RateLimitedError";
    this.retryAfterSeconds = body.details?.retryAfterSeconds as number | undefined;
    this.limit = body.details?.limit as number | undefined;
    this.windowSeconds = body.details?.windowSeconds as number | undefined;
  }
}

export class ConcurrencyLimitedError extends ReaderApiError {
  readonly active?: number;
  readonly max?: number;

  constructor(body: ApiErrorBody, status: number, requestId?: string) {
    super(body, status, requestId);
    this.name = "ConcurrencyLimitedError";
    this.active = body.details?.active as number | undefined;
    this.max = body.details?.max as number | undefined;
  }
}

export class InternalServerError extends ReaderApiError {
  constructor(body: ApiErrorBody, status: number, requestId?: string) {
    super(body, status, requestId);
    this.name = "InternalServerError";
  }
}

export class UpstreamUnavailableError extends ReaderApiError {
  constructor(body: ApiErrorBody, status: number, requestId?: string) {
    super(body, status, requestId);
    this.name = "UpstreamUnavailableError";
  }
}

export class ScrapeTimeoutError extends ReaderApiError {
  readonly timeoutMs?: number;

  constructor(body: ApiErrorBody, status: number, requestId?: string) {
    super(body, status, requestId);
    this.name = "ScrapeTimeoutError";
    this.timeoutMs = body.details?.timeoutMs as number | undefined;
  }
}

/**
 * Construct the right error subclass from an error response body.
 * Unknown codes fall through to the base class.
 */
export function toReaderApiError(
  body: ApiErrorBody,
  httpStatus: number,
  requestId?: string,
): ReaderApiError {
  switch (body.code) {
    case "invalid_request":
      return new InvalidRequestError(body, httpStatus, requestId);
    case "unauthenticated":
      return new UnauthenticatedError(body, httpStatus, requestId);
    case "insufficient_credits":
      return new InsufficientCreditsError(body, httpStatus, requestId);
    case "url_blocked":
      return new UrlBlockedError(body, httpStatus, requestId);
    case "not_found":
      return new NotFoundError(body, httpStatus, requestId);
    case "conflict":
      return new ConflictError(body, httpStatus, requestId);
    case "rate_limited":
      return new RateLimitedError(body, httpStatus, requestId);
    case "concurrency_limited":
      return new ConcurrencyLimitedError(body, httpStatus, requestId);
    case "internal_error":
      return new InternalServerError(body, httpStatus, requestId);
    case "upstream_unavailable":
      return new UpstreamUnavailableError(body, httpStatus, requestId);
    case "scrape_timeout":
      return new ScrapeTimeoutError(body, httpStatus, requestId);
    default:
      return new ReaderApiError(body, httpStatus, requestId);
  }
}
