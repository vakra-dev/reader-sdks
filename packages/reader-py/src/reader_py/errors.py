"""Typed error classes mirroring the reader-api error code catalog.

The API returns a stable ``code`` field on every error response. The SDK
branches on that code and raises a specific subclass so callers can write::

    try:
        client.read(url=url)
    except InsufficientCreditsError as err:
        print(err.required, err.available, err.reset_at)

There is one subclass per code. Unknown codes fall through to the base
:class:`ReaderApiError`.
"""

from __future__ import annotations

from typing import Any, Optional


class ReaderApiError(Exception):
    """Base error for all Reader API responses."""

    def __init__(
        self,
        message: str,
        *,
        code: str = "internal_error",
        http_status: int = 0,
        details: Optional[dict[str, Any]] = None,
        docs_url: Optional[str] = None,
        request_id: Optional[str] = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.http_status = http_status
        self.details = details or {}
        self.docs_url = docs_url
        self.request_id = request_id


class InvalidRequestError(ReaderApiError):
    pass


class UnauthenticatedError(ReaderApiError):
    pass


class InsufficientCreditsError(ReaderApiError):
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self.required: Optional[int] = self.details.get("required")
        self.available: Optional[int] = self.details.get("available")
        self.reset_at: Optional[str] = self.details.get("resetAt")


class UrlBlockedError(ReaderApiError):
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self.url: Optional[str] = self.details.get("url")
        self.reason: Optional[str] = self.details.get("reason")


class NotFoundError(ReaderApiError):
    pass


class ConflictError(ReaderApiError):
    pass


class RateLimitedError(ReaderApiError):
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self.retry_after_seconds: Optional[int] = self.details.get("retryAfterSeconds")
        self.limit: Optional[int] = self.details.get("limit")
        self.window_seconds: Optional[int] = self.details.get("windowSeconds")


class ConcurrencyLimitedError(ReaderApiError):
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self.active: Optional[int] = self.details.get("active")
        self.max: Optional[int] = self.details.get("max")


class InternalServerError(ReaderApiError):
    pass


class UpstreamUnavailableError(ReaderApiError):
    pass


class ScrapeTimeoutError(ReaderApiError):
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self.timeout_ms: Optional[int] = self.details.get("timeoutMs")


_CODE_MAP: dict[str, type[ReaderApiError]] = {
    "invalid_request": InvalidRequestError,
    "unauthenticated": UnauthenticatedError,
    "insufficient_credits": InsufficientCreditsError,
    "url_blocked": UrlBlockedError,
    "not_found": NotFoundError,
    "conflict": ConflictError,
    "rate_limited": RateLimitedError,
    "concurrency_limited": ConcurrencyLimitedError,
    "internal_error": InternalServerError,
    "upstream_unavailable": UpstreamUnavailableError,
    "scrape_timeout": ScrapeTimeoutError,
}


def to_reader_api_error(
    body: dict[str, Any],
    http_status: int,
    request_id: Optional[str] = None,
) -> ReaderApiError:
    """Build the right error subclass from an error envelope body."""
    code = body.get("code", "internal_error")
    cls = _CODE_MAP.get(code, ReaderApiError)
    return cls(
        body.get("message", "Reader API error"),
        code=code,
        http_status=http_status,
        details=body.get("details") or {},
        docs_url=body.get("docsUrl"),
        request_id=request_id,
    )


# Backwards-compat alias for users still catching the old class name.
ReaderError = ReaderApiError
