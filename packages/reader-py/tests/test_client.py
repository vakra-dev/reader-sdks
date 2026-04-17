"""Tests for the Reader Python SDK."""

import pytest

from reader_py.client import _to_camel_case, _to_snake_case
from reader_py.errors import (
    InsufficientCreditsError,
    InvalidRequestError,
    RateLimitedError,
    ReaderApiError,
    ReaderError,
    ScrapeTimeoutError,
    UnauthenticatedError,
    UpstreamUnavailableError,
    to_reader_api_error,
)
from reader_py.types import (
    Credits,
    Job,
    JobReadResult,
    Page,
    ReadParams,
    ScrapeMetadata,
    ScrapeReadResult,
    ScrapeResult,
)


# ────────────────────────────────────────────────────────────────
# Case conversion helpers
# ────────────────────────────────────────────────────────────────


class TestCaseConversion:
    def test_to_camel_case_basic(self):
        assert _to_camel_case({"only_main_content": True, "timeout_ms": 30000}) == {
            "onlyMainContent": True,
            "timeoutMs": 30000,
        }

    def test_to_camel_single_word(self):
        assert _to_camel_case({"url": "https://example.com"}) == {
            "url": "https://example.com"
        }

    def test_to_camel_preserves_non_string_values(self):
        assert _to_camel_case({"max_pages": 100, "cache": True}) == {
            "maxPages": 100,
            "cache": True,
        }

    def test_to_snake_case_basic(self):
        assert _to_snake_case({"onlyMainContent": True, "timeoutMs": 30000}) == {
            "only_main_content": True,
            "timeout_ms": 30000,
        }

    def test_to_snake_case_nested(self):
        assert _to_snake_case(
            {"data": {"baseUrl": "https://example.com", "statusCode": 200}}
        ) == {"data": {"base_url": "https://example.com", "status_code": 200}}

    def test_to_snake_case_with_list(self):
        assert _to_snake_case({"data": [{"baseUrl": "a"}, {"baseUrl": "b"}]}) == {
            "data": [{"base_url": "a"}, {"base_url": "b"}]
        }

    def test_to_snake_case_passthrough_primitives(self):
        assert _to_snake_case("a string") == "a string"
        assert _to_snake_case(42) == 42
        assert _to_snake_case(None) is None


# ────────────────────────────────────────────────────────────────
# ReadParams Pydantic model
# ────────────────────────────────────────────────────────────────


class TestReadParams:
    def test_defaults(self):
        params = ReadParams(url="https://example.com")
        assert params.formats == ["markdown"]
        assert params.only_main_content is True
        assert params.timeout_ms == 30000
        assert params.cache is True
        assert params.proxy_mode is None

    def test_batch_urls(self):
        params = ReadParams(urls=["https://a.com", "https://b.com"])
        assert len(params.urls) == 2

    def test_proxy_mode_accepts_all_three(self):
        for mode in ("standard", "stealth", "auto"):
            params = ReadParams(url="https://example.com", proxy_mode=mode)
            assert params.proxy_mode == mode


# ────────────────────────────────────────────────────────────────
# Scrape / Job / Page types
# ────────────────────────────────────────────────────────────────


class TestScrapeResult:
    def test_basic_scrape(self):
        metadata = ScrapeMetadata(
            title="Example",
            duration=123,
            cached=False,
            scraped_at="2026-04-04T12:00:00Z",
            proxy_mode="standard",
            proxy_escalated=False,
        )
        result = ScrapeResult(
            url="https://example.com",
            markdown="# Hello",
            metadata=metadata,
        )
        assert result.url == "https://example.com"
        assert result.markdown == "# Hello"
        assert result.metadata.proxy_mode == "standard"
        assert result.metadata.cached is False


class TestPage:
    def test_page_with_content(self):
        page = Page(
            url="https://example.com",
            markdown="# Hello",
            proxy_mode="standard",
            credits=1,
        )
        assert page.url == "https://example.com"
        assert page.markdown == "# Hello"
        assert page.proxy_mode == "standard"
        assert page.credits == 1
        assert page.error is None

    def test_page_with_error(self):
        page = Page(url="https://example.com", error="Timeout")
        assert page.error == "Timeout"
        assert page.markdown is None


class TestJob:
    def test_job_shape(self):
        job = Job(
            id="j_1",
            status="completed",
            mode="batch",
            completed=2,
            total=2,
            credits_used=2,
            results=[
                Page(url="https://a.com", markdown="# A", credits=1),
                Page(url="https://b.com", markdown="# B", credits=1),
            ],
        )
        assert job.id == "j_1"
        assert job.status == "completed"
        assert len(job.results) == 2
        assert job.results[0].markdown == "# A"


class TestCredits:
    def test_credits_shape(self):
        credits = Credits(
            balance=950,
            limit=1000,
            used=50,
            tier="free",
            reset_at="2026-05-01T00:00:00Z",
        )
        assert credits.balance == 950
        assert credits.tier == "free"


# ────────────────────────────────────────────────────────────────
# Discriminated ReadResult
# ────────────────────────────────────────────────────────────────


class TestReadResult:
    def test_scrape_result(self):
        metadata = ScrapeMetadata(
            duration=123,
            cached=False,
            scraped_at="2026-04-04T12:00:00Z",
        )
        scrape = ScrapeResult(
            url="https://example.com",
            markdown="# Hello",
            metadata=metadata,
        )
        result = ScrapeReadResult(kind="scrape", data=scrape)
        assert result.kind == "scrape"
        # Discriminated union: type narrowing means result.data is ScrapeResult
        assert result.data.markdown == "# Hello"

    def test_job_result(self):
        job = Job(id="j_1", status="queued", mode="batch", total=2)
        result = JobReadResult(kind="job", data=job)
        assert result.kind == "job"
        assert result.data.id == "j_1"


# ────────────────────────────────────────────────────────────────
# Typed errors
# ────────────────────────────────────────────────────────────────


class TestErrors:
    def test_base_reader_api_error(self):
        err = ReaderApiError(
            "boom",
            code="internal_error",
            http_status=500,
            docs_url="https://reader.dev/docs/errors#internal-error",
            request_id="req_123",
        )
        assert str(err) == "boom"
        assert err.code == "internal_error"
        assert err.http_status == 500
        assert err.request_id == "req_123"
        assert isinstance(err, Exception)

    def test_reader_error_is_alias(self):
        # Backwards-compat alias — same class.
        assert ReaderError is ReaderApiError

    def test_to_reader_api_error_dispatches_insufficient_credits(self):
        err = to_reader_api_error(
            {
                "code": "insufficient_credits",
                "message": "Need 50 have 10",
                "details": {
                    "required": 50,
                    "available": 10,
                    "resetAt": "2026-05-01T00:00:00Z",
                },
                "docsUrl": "https://reader.dev/docs/errors#insufficient-credits",
            },
            402,
            "req_abc",
        )
        assert isinstance(err, InsufficientCreditsError)
        assert err.required == 50
        assert err.available == 10
        assert err.reset_at == "2026-05-01T00:00:00Z"
        assert err.request_id == "req_abc"

    def test_to_reader_api_error_dispatches_rate_limited(self):
        err = to_reader_api_error(
            {
                "code": "rate_limited",
                "message": "slow down",
                "details": {
                    "limit": 60,
                    "windowSeconds": 60,
                    "retryAfterSeconds": 12,
                },
            },
            429,
        )
        assert isinstance(err, RateLimitedError)
        assert err.retry_after_seconds == 12
        assert err.limit == 60
        assert err.window_seconds == 60

    def test_to_reader_api_error_dispatches_scrape_timeout(self):
        err = to_reader_api_error(
            {
                "code": "scrape_timeout",
                "message": "took too long",
                "details": {"timeoutMs": 30000},
            },
            504,
        )
        assert isinstance(err, ScrapeTimeoutError)
        assert err.timeout_ms == 30000

    def test_to_reader_api_error_dispatches_all_known_codes(self):
        code_to_class = {
            "invalid_request": InvalidRequestError,
            "unauthenticated": UnauthenticatedError,
            "insufficient_credits": InsufficientCreditsError,
            "rate_limited": RateLimitedError,
            "upstream_unavailable": UpstreamUnavailableError,
            "scrape_timeout": ScrapeTimeoutError,
        }
        for code, cls in code_to_class.items():
            err = to_reader_api_error({"code": code, "message": "x"}, 500)
            assert isinstance(err, cls), f"code {code} should be {cls.__name__}"

    def test_to_reader_api_error_falls_through_for_unknown_code(self):
        err = to_reader_api_error(
            {"code": "some_new_future_code", "message": "future"}, 500
        )
        assert isinstance(err, ReaderApiError)
        # Should NOT be a specific subclass
        assert type(err) is ReaderApiError
        assert err.code == "some_new_future_code"

    def test_error_can_be_raised_and_caught(self):
        with pytest.raises(UnauthenticatedError) as exc_info:
            raise UnauthenticatedError(
                "bad key", code="unauthenticated", http_status=401
            )
        assert exc_info.value.code == "unauthenticated"
        assert exc_info.value.http_status == 401

    def test_subclass_caught_by_base(self):
        # InsufficientCreditsError should be catchable as ReaderApiError
        with pytest.raises(ReaderApiError):
            raise InsufficientCreditsError(
                "need more", code="insufficient_credits", http_status=402
            )
