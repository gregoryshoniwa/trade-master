"""Economic calendar ingestor (PLAN §9).

Pulls Forex Factory's weekly JSON via the community mirror at
fairmoney/faireconomy. No API key needed; if it 404s we keep going with an
empty events table (no blackouts, no false rejections).

Schedule: one fetch at startup + every 4 hours. Idempotent — upserts on
event_id so repeated fetches don't duplicate rows.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
from datetime import datetime, timezone

import httpx

from app.db import acquire

log = logging.getLogger("trademaster.calendar")

SOURCE = "forex_factory"
FEED_URL = "https://nfs.faireconomy.media/ff_calendar_thisweek.json"
REFRESH_SECS = 4 * 60 * 60  # 4 hours

# Map an event's country/currency to the Deriv symbols it likely moves.
# Conservative: we'd rather skip a trade than fire during a moving market.
# Synthetics (R_*, 1HZ*) are RNG-only and never appear here on purpose.
CURRENCY_TO_ASSETS: dict[str, list[str]] = {
    "USD": ["frxEURUSD", "frxXAUUSD", "cryBTCUSD"],
    "EUR": ["frxEURUSD"],
    "GBP": ["frxGBPUSD"],
    "JPY": ["frxUSDJPY"],
    "CHF": ["frxUSDCHF"],
    "AUD": ["frxAUDUSD"],
    "NZD": ["frxNZDUSD"],
    "CAD": ["frxUSDCAD"],
}

_task: asyncio.Task | None = None
_stop = asyncio.Event()


async def fetch_once() -> int:
    """Fetch + upsert. Returns the number of upserted rows (best-effort).
    Never raises — logs and returns 0 on any failure."""
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(FEED_URL, headers={"User-Agent": "trademaster/1.0"})
            if resp.status_code != 200:
                log.warning("calendar feed status=%s; skipping", resp.status_code)
                return 0
            payload = resp.json()
    except Exception:
        log.exception("calendar fetch failed; will retry")
        return 0

    if not isinstance(payload, list):
        log.warning("calendar feed unexpected shape: %s", type(payload).__name__)
        return 0

    rows = []
    for item in payload:
        try:
            row = _normalize(item)
            if row is not None:
                rows.append(row)
        except Exception:
            log.debug("skip malformed event: %s", item)

    if not rows:
        return 0

    async with acquire() as conn:
        async with conn.transaction():
            for r in rows:
                await conn.execute(
                    """
                    INSERT INTO economic_events
                        (event_id, ts, country, name, impact, category,
                         previous, forecast, actual,
                         affected_currencies, affected_assets,
                         source, fetched_at)
                    VALUES ($1, $2, $3, $4, $5, $6,
                            $7, $8, $9,
                            $10, $11,
                            $12, now())
                    ON CONFLICT (event_id) DO UPDATE SET
                        ts = EXCLUDED.ts,
                        impact = EXCLUDED.impact,
                        previous = EXCLUDED.previous,
                        forecast = EXCLUDED.forecast,
                        actual = EXCLUDED.actual,
                        affected_currencies = EXCLUDED.affected_currencies,
                        affected_assets = EXCLUDED.affected_assets,
                        fetched_at = now()
                    """,
                    *r,
                )
    log.info("calendar ingest: %d events", len(rows))
    return len(rows)


def _normalize(item: dict) -> tuple | None:
    title = (item.get("title") or "").strip()
    country = (item.get("country") or "").strip().upper()
    date_str = item.get("date")
    impact = (item.get("impact") or "").strip().lower()
    if not title or not country or not date_str:
        return None
    try:
        # Feed dates are ISO-ish (e.g. "2026-05-28T08:30:00-04:00")
        ts = datetime.fromisoformat(date_str.replace("Z", "+00:00"))
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
    except ValueError:
        return None

    if impact not in {"high", "medium", "low"}:
        impact = "low"

    currencies = [country] if country else []
    assets = CURRENCY_TO_ASSETS.get(country, [])

    # Stable id: SHA-1 of (country, title, ts iso) — survives upstream id changes.
    h = hashlib.sha1(f"{country}|{title}|{ts.isoformat()}".encode()).hexdigest()
    event_id = f"ff_{h[:24]}"

    return (
        event_id,
        ts,
        country,
        title,
        impact,
        item.get("category") or None,
        str(item.get("previous") or "") or None,
        str(item.get("forecast") or "") or None,
        str(item.get("actual") or "") or None,
        currencies,
        assets,
        SOURCE,
    )


async def _loop() -> None:
    while not _stop.is_set():
        await fetch_once()
        try:
            await asyncio.wait_for(_stop.wait(), timeout=REFRESH_SECS)
        except asyncio.TimeoutError:
            pass


async def start() -> None:
    global _task
    if _task is not None:
        return
    _stop.clear()
    _task = asyncio.create_task(_loop())
    log.info("calendar ingestor started (every %ds, %s)", REFRESH_SECS, FEED_URL)


async def stop() -> None:
    global _task
    if _task is None:
        return
    _stop.set()
    try:
        await asyncio.wait_for(_task, timeout=5.0)
    except asyncio.TimeoutError:
        _task.cancel()
    _task = None
