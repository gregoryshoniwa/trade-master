"""Symbol catalog + QuestDB-backed tick history."""

import logging
import os
from typing import Annotated

import httpx
from fastapi import APIRouter, HTTPException, Query, status

from app.symbols import BY_CODE, CATALOG

router = APIRouter(prefix="/symbols", tags=["symbols"])
log = logging.getLogger("trademaster.symbols")

QUESTDB_URL = os.getenv("QUESTDB_HTTP_URL", "http://questdb:9000")

# Reuse one client across requests so we get keep-alive.
_questdb_client = httpx.AsyncClient(base_url=QUESTDB_URL, timeout=10.0)


@router.get("")
async def list_symbols():
    """Phase 0 catalog. Public — no auth required."""
    return {"symbols": CATALOG}


@router.get("/{symbol}/history")
async def symbol_history(
    symbol: str,
    minutes: Annotated[int, Query(ge=1, le=24 * 60)] = 30,
    bucket_secs: Annotated[int, Query(ge=1, le=300)] = 1,
):
    """Return bucketed tick history for the chart's initial paint.

    Buckets every `bucket_secs` seconds for the last `minutes`, taking the
    last quote in each bucket (matches what the live tick line is showing —
    so the join is seamless when live ticks start arriving).
    """
    if symbol not in BY_CODE:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "unknown symbol")

    # QuestDB SQL — uses SAMPLE BY for time-bucketing.
    sql = (
        "SELECT timestamp, last(quote) AS value "
        "FROM tick "
        f"WHERE symbol = '{symbol}' "
        f"AND timestamp > dateadd('m', -{minutes}, now()) "
        f"SAMPLE BY {bucket_secs}s ALIGN TO CALENDAR"
    )

    try:
        r = await _questdb_client.get("/exec", params={"query": sql})
        r.raise_for_status()
    except httpx.HTTPError as e:
        log.warning("questdb history fetch failed: %s", e)
        # Don't fail the page; return empty history.
        return {"symbol": symbol, "bucket_secs": bucket_secs, "rows": []}

    body = r.json()
    if "error" in body:
        log.warning("questdb returned error: %s", body)
        return {"symbol": symbol, "bucket_secs": bucket_secs, "rows": []}

    # Result shape: {"columns":[{"name":"timestamp"},{"name":"value"}],
    #                "dataset":[["2026-...","30100.4"], ...]}
    rows = []
    for row in body.get("dataset", []):
        ts_iso, value = row[0], row[1]
        if value is None:
            continue
        # Parse the ISO microsecond timestamp into epoch seconds. QuestDB
        # returns "2026-05-26T22:01:32.458000Z".
        try:
            import datetime as _dt
            dt = _dt.datetime.fromisoformat(ts_iso.replace("Z", "+00:00"))
            epoch = int(dt.timestamp())
        except Exception:
            continue
        rows.append({"t": epoch, "value": float(value)})

    return {"symbol": symbol, "bucket_secs": bucket_secs, "rows": rows}
