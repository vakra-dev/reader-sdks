"""Reader SDK types — mirror the reader-api envelope contract."""

from __future__ import annotations

from typing import Annotated, Any, Literal, Optional, Union

from pydantic import BaseModel, Field


ProxyMode = Literal["standard", "premium"]
ResolvedProxyMode = Literal["standard", "premium"]
JobStatus = Literal["queued", "processing", "completed", "failed", "cancelled"]
JobMode = Literal["scrape", "batch", "crawl"]


class WebhookConfig(BaseModel):
    """Per-request webhook configuration for async job notifications."""

    url: str
    events: Optional[list[str]] = None
    secret: Optional[str] = None


class ReadParams(BaseModel):
    url: Optional[str] = None
    urls: Optional[list[str]] = None
    formats: list[str] = ["markdown"]
    only_main_content: bool = True
    include_tags: Optional[list[str]] = None
    exclude_tags: Optional[list[str]] = None
    wait_for_selector: Optional[str] = None
    timeout_ms: int = 30000
    proxy_mode: Optional[ProxyMode] = None
    max_depth: Optional[int] = None
    max_pages: Optional[int] = None
    cache: bool = True
    webhook: Optional[WebhookConfig] = None
    batch_concurrency: Optional[int] = None


class ScrapeMetadata(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    status_code: Optional[int] = None
    duration: int
    cached: bool
    proxy_mode: Optional[ResolvedProxyMode] = None
    scraped_at: str


class ScrapeResult(BaseModel):
    """Result of a synchronous single-URL scrape."""

    kind: Literal["scrape"] = "scrape"
    url: str
    final_url: Optional[str] = None  # Present if URL redirected
    markdown: Optional[str] = None
    html: Optional[str] = None
    metadata: ScrapeMetadata


class Page(BaseModel):
    """An individual result inside a job's `results` array."""

    url: str
    markdown: Optional[str] = None
    html: Optional[str] = None
    status_code: Optional[int] = None
    proxy_mode: Optional[ResolvedProxyMode] = None
    credits: Optional[int] = None
    metadata: Optional[dict[str, Any]] = None
    error: Optional[str] = None


class Job(BaseModel):
    """Job as returned by GET /v1/jobs/:id (the `data` portion of the envelope)."""

    kind: Literal["job"] = "job"
    id: str
    status: JobStatus
    mode: JobMode
    completed: int = 0
    total: int = 0
    credits_used: int = 0
    error: Optional[str] = None
    results: list[Page] = Field(default_factory=list)
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    created_at: Optional[str] = None


class Pagination(BaseModel):
    total: int
    skip: int
    limit: int
    has_more: bool
    next: Optional[str] = None


class Credits(BaseModel):
    balance: int
    limit: int
    used: int
    tier: str
    reset_at: str


class UsageEntry(BaseModel):
    id: str
    url: str
    duration: int
    status: Literal["success", "error"]
    cached: bool
    proxy_mode: Optional[ResolvedProxyMode] = None
    credits: int
    error: Optional[str] = None
    created_at: str


# Backwards-compat aliases — older code used these names.
JobInfo = Job
CreditInfo = Credits


class ScrapeReadResult(BaseModel):
    """ReadResult variant returned by single-URL scrapes."""

    kind: Literal["scrape"]
    data: ScrapeResult


class JobReadResult(BaseModel):
    """ReadResult variant returned by async batch and crawl jobs."""

    kind: Literal["job"]
    data: Job


# Discriminated union: the `kind` field selects the variant. The explicit
# Field(discriminator="kind") annotation tells Pydantic v2 to dispatch on
# `kind` at validation time (faster and gives better error messages than
# structural matching) and enables IDE / mypy narrowing on `result.data`
# once the caller has branched on `result.kind`.
ReadResult = Annotated[
    Union[ScrapeReadResult, JobReadResult],
    Field(discriminator="kind"),
]


# ──────────────────────────────────────────────────────────────
# Streaming events (yielded by client.stream / AsyncReaderClient.stream)
# ──────────────────────────────────────────────────────────────


class ProgressEvent(BaseModel):
    type: Literal["progress"] = "progress"
    status: JobStatus
    completed: int
    total: int


class PageEvent(BaseModel):
    type: Literal["page"] = "page"
    data: Page


class ErrorEvent(BaseModel):
    type: Literal["error"] = "error"
    url: str
    error: str


class DoneEvent(BaseModel):
    type: Literal["done"] = "done"
    status: JobStatus
    completed: int
    total: int


StreamEvent = Union[ProgressEvent, PageEvent, ErrorEvent, DoneEvent]


# ─── Browser Sessions ────────────────────────────────────────────────

SessionStatus = Literal["active", "stopped", "expired"]


class SessionInfo(BaseModel):
    """Active browser session with a CDP WebSocket endpoint."""

    session_id: str
    ws_endpoint: str
    token: str
    status: SessionStatus
    created_at: str
    expires_at: str


class CreateSessionParams(BaseModel):
    """Options for creating a browser session."""

    max_duration_ms: Optional[int] = None


class StopSessionResult(BaseModel):
    """Result from stopping a browser session."""

    session_id: str
    status: Literal["stopped"]
    duration_ms: int
    credits_charged: int
