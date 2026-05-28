"""Recent OHLC candle fetcher for strategy evaluation.

Strategies in app.strategies need a rolling window of candles to compute
indicators (EMA/ATR/RSI/ADX/BB). We pull from two sources, in order:

  1. QuestDB SAMPLE BY (resampled from the gateway's tick persistence) —
     fast, in-network. If healthy, this is the primary source.
  2. Deriv's public ticks_history endpoint (app_id 1089, no auth) — works
     even when QuestDB is offline; this is the same source kronos uses to
     warm-start its buffer. ~150ms per call from the api container.

Either way, results are cached in-process for 30s so many agents matching
the same forecast on the same asset don't all hammer the source.

Silent failure is the safe mode: if both return [], the strategy gate
returns HOLD and the intent is declined. Better to skip a trade than to
act on stale or missing data.
"""

from __future__ import annotations

import asyncio
import datetime as _dt
import json
import logging
import os
import time

import httpx
import websockets

log = logging.getLogger("trademaster.ohlc")

QUESTDB_URL = os.getenv("QUESTDB_HTTP_URL", "http://questdb:9000")
DERIV_WS = "wss://ws.derivws.com/websockets/v3?app_id=1089"

_questdb_client = httpx.AsyncClient(base_url=QUESTDB_URL, timeout=5.0)

# Cache: (asset, granularity_sec) → (monotonic_ts, bars)
_CACHE_TTL_SECS = 30.0
_cache: dict[tuple[str, int], tuple[float, list[dict]]] = {}
# Per-key lock so concurrent in-flight requests collapse into one.
_locks: dict[tuple[str, int], asyncio.Lock] = {}


async def get_candles(asset: str, granularity_sec: int = 60, count: int = 200) -> list[dict]:
    """Return up to `count` OHLC bars ending now. Each bar is
    {t, open, high, low, close}. Time-ascending. Returns [] on total failure."""
    key = (asset, granularity_sec)
    now = time.monotonic()
    cached = _cache.get(key)
    if cached is not None and (now - cached[0]) < _CACHE_TTL_SECS:
        return cached[1][-count:]

    lock = _locks.setdefault(key, asyncio.Lock())
    async with lock:
        # Recheck after acquiring lock — another coroutine may have just filled it.
        cached = _cache.get(key)
        if cached is not None and (time.monotonic() - cached[0]) < _CACHE_TTL_SECS:
            return cached[1][-count:]

        bars = await _fetch_questdb(asset, granularity_sec, count)
        if not bars:
            bars = await _fetch_deriv(asset, granularity_sec, count)

        _cache[key] = (time.monotonic(), bars)
        return bars[-count:]


async def _fetch_questdb(asset: str, granularity_sec: int, count: int) -> list[dict]:
    """QuestDB resample. Returns [] on any failure."""
    lookback = max(granularity_sec * count * 2, granularity_sec * 60)
    sql = (
        "SELECT timestamp,"
        " first(quote) o, max(quote) h, min(quote) l, last(quote) c "
        "FROM tick "
        f"WHERE symbol = '{asset}' "
        f"AND timestamp > dateadd('s', -{lookback}, now()) "
        f"SAMPLE BY {granularity_sec}s ALIGN TO CALENDAR"
    )
    try:
        r = await _questdb_client.get("/exec", params={"query": sql})
        r.raise_for_status()
        body = r.json()
        if "error" in body:
            return []
    except Exception as e:
        log.debug("questdb ohlc miss for %s: %s", asset, e)
        return []

    rows: list[dict] = []
    for row in body.get("dataset", []):
        ts_iso, o, h, l, c = row
        if o is None or h is None or l is None or c is None:
            continue
        try:
            dt = _dt.datetime.fromisoformat(ts_iso.replace("Z", "+00:00"))
            epoch = int(dt.timestamp())
        except (ValueError, TypeError):
            continue
        rows.append({"t": epoch, "open": float(o), "high": float(h), "low": float(l), "close": float(c)})
    return rows


async def _fetch_deriv(asset: str, granularity_sec: int, count: int) -> list[dict]:
    """One-shot ticks_history WS request against Deriv's public endpoint.
    Reliable fallback when QuestDB is offline or empty."""
    req = {
        "ticks_history": asset, "end": "latest",
        "count": count, "style": "candles", "granularity": granularity_sec,
    }
    try:
        async with websockets.connect(DERIV_WS, max_size=8 * 1024 * 1024) as ws:
            await ws.send(json.dumps(req))
            for _ in range(8):
                msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=5.0))
                if msg.get("msg_type") == "candles":
                    return [
                        {"t": int(c["epoch"]),
                         "open": float(c["open"]), "high": float(c["high"]),
                         "low": float(c["low"]), "close": float(c["close"])}
                        for c in msg["candles"]
                    ]
                if msg.get("error"):
                    log.warning("deriv ohlc error for %s: %s", asset, msg["error"].get("message"))
                    return []
    except Exception as e:
        log.warning("deriv ohlc fetch failed for %s: %s", asset, e)
    return []
