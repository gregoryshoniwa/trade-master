"""Warm-start: fetch recent OHLCV candles from Deriv's public history API.

Lets Kronos forecast immediately on startup instead of waiting hours to
accumulate `context_length` live bars. Uses the unauthenticated public
app_id — historical candles need no token.
"""

from __future__ import annotations

import json

import websockets

DERIV_WS = "wss://ws.derivws.com/websockets/v3?app_id=1089"


async def fetch_candles(symbol: str, granularity: int, count: int) -> list[dict]:
    """Return up to `count` closed OHLCV bars (time-ascending) as dicts shaped
    like CandleBuffer's: {t, open, high, low, close, volume}. Deriv candles
    carry no volume, so we use a constant proxy (1.0)."""
    req = {
        "ticks_history": symbol,
        "end": "latest",
        "count": count,
        "style": "candles",
        "granularity": granularity,
    }
    async with websockets.connect(DERIV_WS, max_size=8 * 1024 * 1024) as ws:
        await ws.send(json.dumps(req))
        while True:
            msg = json.loads(await ws.recv())
            if msg.get("msg_type") == "candles":
                return [
                    {
                        "t": int(c["epoch"]),
                        "open": float(c["open"]),
                        "high": float(c["high"]),
                        "low": float(c["low"]),
                        "close": float(c["close"]),
                        "volume": 1.0,
                    }
                    for c in msg["candles"]
                ]
            if msg.get("error"):
                raise RuntimeError(f"{symbol}: {msg['error']['message']}")
