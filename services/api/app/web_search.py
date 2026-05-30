"""Internet search tool, gated by per-company config.

PLAN §14: agents need a way to ground their decisions in fresh
information (rate cuts, ETF approvals, earnings, geopolitics) but the
CEO needs to keep them on a short leash — both for cost reasons and
because most of what's on the open web is noise.

Configuration lives on `companies`:
  - web_search_enabled        master switch
  - web_search_allowed_domains  empty = "any non-blocked domain"
  - web_search_blocked_domains  hard-deny list
  - web_search_daily_quota    company-wide cap across all agents/day

Backend: Tavily if TAVILY_API_KEY is set (best for AI-grounded use),
otherwise DuckDuckGo's HTML endpoint (free, no key needed, fine for
occasional lookups). Both are wrapped so the tool returns the same
shape regardless of backend.

Every call lands in `web_search_log` so the CEO can audit what the
agents are actually searching for."""

from __future__ import annotations

import json
import logging
import os
import re
from dataclasses import dataclass
from html import unescape
from typing import Any
from urllib.parse import quote_plus, urlparse
from uuid import UUID

import httpx

from app.db import acquire

log = logging.getLogger("trademaster.web_search")

TAVILY_API_KEY = os.getenv("TAVILY_API_KEY")
HTTP_TIMEOUT = 8.0


@dataclass
class WebSearchResult:
    title: str
    url: str
    snippet: str
    domain: str


@dataclass
class CompanyWebSearchConfig:
    enabled: bool
    allowed_domains: list[str]
    blocked_domains: list[str]
    daily_quota: int
    backend: str  # 'auto' | 'tavily' | 'duckduckgo'


async def _load_config(conn, company_id: UUID) -> CompanyWebSearchConfig:
    row = await conn.fetchrow(
        """
        SELECT web_search_enabled, web_search_allowed_domains,
               web_search_blocked_domains, web_search_daily_quota,
               web_search_backend
        FROM companies WHERE id = $1
        """,
        company_id,
    )
    if row is None:
        return CompanyWebSearchConfig(False, [], [], 0, "auto")
    return CompanyWebSearchConfig(
        enabled=bool(row["web_search_enabled"]),
        allowed_domains=[d.lower() for d in (row["web_search_allowed_domains"] or [])],
        blocked_domains=[d.lower() for d in (row["web_search_blocked_domains"] or [])],
        daily_quota=int(row["web_search_daily_quota"]),
        backend=row["web_search_backend"] or "auto",
    )


def _backend_order(pref: str) -> list[str]:
    """Returns the ordered list of backends to try.

    'auto' prefers Tavily when its key is set; if it errors we fall
    back to DDG. Explicit choices pin a single backend and surface
    failures rather than silently falling through, so the CEO can
    tell when their preferred backend is misconfigured."""
    if pref == "tavily":
        return ["tavily"]
    if pref == "duckduckgo":
        return ["duckduckgo"]
    # auto: try Tavily first when configured, then DDG
    return ["tavily", "duckduckgo"] if TAVILY_API_KEY else ["duckduckgo"]


async def _today_used(conn, company_id: UUID) -> int:
    return int(await conn.fetchval(
        """
        SELECT count(*) FROM web_search_log
        WHERE company_id = $1
          AND created_at >= date_trunc('day', now())
          AND ok
        """,
        company_id,
    ) or 0)


def _domain_of(url: str) -> str:
    try:
        host = urlparse(url).netloc.lower()
        # Strip leading www. — the CEO's allowlist of "wsj.com" should
        # match "www.wsj.com" too.
        return host[4:] if host.startswith("www.") else host
    except Exception:
        return ""


def _matches_domain(host: str, patterns: list[str]) -> bool:
    """Suffix-match: 'reuters.com' in the list matches 'finance.reuters.com'."""
    for p in patterns:
        if not p:
            continue
        if host == p or host.endswith("." + p):
            return True
    return False


def _filter_results(
    results: list[WebSearchResult], cfg: CompanyWebSearchConfig,
) -> list[WebSearchResult]:
    out: list[WebSearchResult] = []
    for r in results:
        host = r.domain or _domain_of(r.url)
        if cfg.blocked_domains and _matches_domain(host, cfg.blocked_domains):
            continue
        # Empty allowlist means "anything not blocked". A populated
        # allowlist means "only these and their subdomains".
        if cfg.allowed_domains and not _matches_domain(host, cfg.allowed_domains):
            continue
        out.append(r)
    return out


# ─────────────────────────── backends ───────────────────────────


async def _tavily_search(query: str, max_results: int) -> list[WebSearchResult]:
    assert TAVILY_API_KEY  # checked by caller
    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
        resp = await client.post(
            "https://api.tavily.com/search",
            json={
                "api_key": TAVILY_API_KEY,
                "query": query,
                "max_results": max_results,
                "search_depth": "basic",
                "include_answer": False,
            },
        )
        resp.raise_for_status()
        data = resp.json()
    results: list[WebSearchResult] = []
    for r in (data.get("results") or [])[:max_results]:
        url = r.get("url") or ""
        results.append(WebSearchResult(
            title=(r.get("title") or "").strip(),
            url=url,
            snippet=(r.get("content") or "").strip(),
            domain=_domain_of(url),
        ))
    return results


_DDG_RESULT = re.compile(
    r'<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)</a>'
    r'.*?<a[^>]*class="result__snippet"[^>]*>(.*?)</a>',
    re.DOTALL,
)


async def _ddg_search(query: str, max_results: int) -> list[WebSearchResult]:
    """DuckDuckGo HTML endpoint — no API key required.

    Fragile to upstream HTML changes but adequate for "occasional
    research lookup" volumes. If this breaks, the operator should
    configure TAVILY_API_KEY."""
    url = f"https://html.duckduckgo.com/html/?q={quote_plus(query)}"
    headers = {
        "User-Agent": "Mozilla/5.0 TradeMasterResearch/1.0",
    }
    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT, headers=headers) as client:
        resp = await client.get(url)
        resp.raise_for_status()
        html = resp.text
    results: list[WebSearchResult] = []
    for m in _DDG_RESULT.finditer(html):
        raw_url, title_html, snippet_html = m.groups()
        # DDG wraps URLs in /l/?uddg=… — decode to the actual target.
        u = raw_url
        if u.startswith("/l/?") or u.startswith("//"):
            from urllib.parse import parse_qs, urlparse as _u
            qs = parse_qs(_u(u if u.startswith("//") else f"https:{u}" if u.startswith("//") else u).query)
            target = qs.get("uddg", [None])[0]
            if target:
                u = target
        title = unescape(re.sub(r"<[^>]+>", "", title_html)).strip()
        snippet = unescape(re.sub(r"<[^>]+>", "", snippet_html)).strip()
        results.append(WebSearchResult(
            title=title, url=u, snippet=snippet, domain=_domain_of(u),
        ))
        if len(results) >= max_results:
            break
    return results


# ─────────────────────────── entry point ──────────────────────────


@dataclass
class WebSearchOutcome:
    ok: bool
    results: list[WebSearchResult]
    reason: str | None = None
    quota_used_today: int = 0
    quota_total: int = 0


async def search(
    *, company_id: UUID, agent_id: UUID, query: str, max_results: int = 5,
    backend_hint: str | None = None,
) -> WebSearchOutcome:
    """Run a search subject to per-company config and quota.

    `backend_hint` lets a single tool call override the company-level
    backend preference for THIS call only. Useful when the LLM knows
    a query is financial/news (force `tavily`) vs general (`duckduckgo`
    is fine and saves a Tavily credit)."""
    query = (query or "").strip()
    if not query:
        return WebSearchOutcome(False, [], "empty query")
    max_results = max(1, min(int(max_results), 10))

    async with acquire() as conn:
        cfg = await _load_config(conn, company_id)
        # Per-call override wins over the persisted company setting.
        # We re-pack the config struct so the rest of the function
        # doesn't need to know about the hint.
        if backend_hint in ("auto", "tavily", "duckduckgo"):
            cfg = CompanyWebSearchConfig(
                enabled=cfg.enabled,
                allowed_domains=cfg.allowed_domains,
                blocked_domains=cfg.blocked_domains,
                daily_quota=cfg.daily_quota,
                backend=backend_hint,
            )
        if not cfg.enabled:
            await _audit(conn, company_id, agent_id, query, 0, False, "web search disabled for this company")
            return WebSearchOutcome(False, [], "web search is disabled for this company; ask the CEO to enable it")

        used = await _today_used(conn, company_id)
        if used >= cfg.daily_quota:
            await _audit(conn, company_id, agent_id, query, 0, False, f"daily quota reached ({used}/{cfg.daily_quota})")
            return WebSearchOutcome(False, [], f"daily quota reached ({used}/{cfg.daily_quota})",
                                    quota_used_today=used, quota_total=cfg.daily_quota)

    # Hit the backend OUTSIDE the connection so a slow upstream doesn't
    # pin a Postgres connection from the pool. Try each backend in
    # preference order; a transient error on the first only matters if
    # it's the only one configured.
    raw: list[WebSearchResult] = []
    last_error: Exception | None = None
    for backend in _backend_order(cfg.backend):
        try:
            if backend == "tavily":
                if not TAVILY_API_KEY:
                    # Pinned-to-Tavily case with no key configured is a
                    # user-visible misconfiguration — don't silently
                    # fall back, surface it instead.
                    raise RuntimeError("Tavily selected but TAVILY_API_KEY is not set on the api server")
                raw = await _tavily_search(query, max_results * 2)
            else:
                raw = await _ddg_search(query, max_results * 2)
            last_error = None
            break
        except Exception as e:
            log.warning("web search backend %s failed: %s", backend, e)
            last_error = e
            continue
    if last_error is not None and not raw:
        async with acquire() as conn:
            await _audit(conn, company_id, agent_id, query, 0, False, f"upstream error: {last_error!s}")
        return WebSearchOutcome(False, [], f"search engine unavailable: {last_error!s}")

    filtered = _filter_results(raw, cfg)[:max_results]
    async with acquire() as conn:
        await _audit(conn, company_id, agent_id, query, len(filtered), True, None)
        used = await _today_used(conn, company_id)
    return WebSearchOutcome(True, filtered,
                            quota_used_today=used, quota_total=cfg.daily_quota)


async def _audit(
    conn, company_id: UUID, agent_id: UUID, query: str,
    n_results: int, ok: bool, error_reason: str | None,
) -> None:
    await conn.execute(
        """
        INSERT INTO web_search_log
            (company_id, agent_id, query, n_results, ok, error_reason)
        VALUES ($1, $2, $3, $4, $5, $6)
        """,
        company_id, agent_id, query[:500], n_results, ok, error_reason,
    )
