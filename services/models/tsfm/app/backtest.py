"""Walk-forward backtest for the TSFM ensemble.

Same question we ask of TTM and Kronos: *does the model have directional
edge on this instrument, before we risk money on it?* — but with the
forecast served over HTTP by TSFM.ai instead of local inference.

Two consequences of the API path:
  - **Cost.** Every window costs one ensemble call. A 5000-bar run at
    stride 3 is ~1600 windows × N symbols. We cap concurrency and warn
    the api side via the form's "estimate" copy.
  - **Latency.** A cold ensemble call is ~30s; warm is ~5-6s. We
    parallelize bounded by `TSFM_BACKTEST_CONCURRENCY` so a real run
    on a single symbol finishes in tens of minutes, not hours.

Everything below mirrors the Kronos backtest's evaluation + summary
shape exactly so the existing `routes/backtests.py` `BacktestResult`
model and the web UI render unchanged."""

from __future__ import annotations

import asyncio
import json
import logging
import os

import numpy as np
import websockets

from app.config import settings
from app.tsfm_client import TsfmClient

log = logging.getLogger("trademaster.tsfm.backtest")

DERIV_WS = "wss://ws.derivws.com/websockets/v3?app_id=1089"
DEFAULT_STOP_PCT = 0.005
DEFAULT_PAYOFF = 1.5

# Cap parallel ensemble calls. Too high and we'll either throttle on
# TSFM.ai or rack up burst spend; too low and a 1600-window run takes
# hours. 6 is a reasonable starting point given warm calls land in ~5s.
BACKTEST_CONCURRENCY = int(os.environ.get("TSFM_BACKTEST_CONCURRENCY", "6"))


async def fetch_ohlcv(symbol: str, granularity: int, count: int) -> list[dict]:
    """Fetch up to `count` OHLCV bars from Deriv's public history (same
    shape Kronos uses)."""
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
                        "volume": float(c.get("volume") or 1.0),
                    }
                    for c in msg["candles"]
                ]
            if msg.get("error"):
                raise RuntimeError(f"{symbol}: {msg['error']['message']}")


async def _evaluate_window(
    client: TsfmClient,
    *,
    symbol: str,
    window_bars: list[dict],
    closes: np.ndarray,
    t: int,
    horizon: int,
    stop_pct: float,
    payoff: float,
    sem: asyncio.Semaphore,
) -> dict | None:
    """One ensemble call at index `t`. Returns a row dict or None on error.

    Held inside `sem` so we cap concurrent TSFM calls across the
    walk-forward sweep — both for cost and for upstream rate limits."""
    async with sem:
        entry = float(closes[t])
        series = [float(b["close"]) for b in window_bars]
        try:
            res = await client.forecast_ensemble(
                symbol=symbol,
                series=series,
                last_price=entry,
                horizon=horizon,
                bar_epochs=[int(b["t"]) for b in window_bars],
            )
        except Exception as e:
            log.warning("forecast failed at t=%d: %s", t, e)
            return None

        p50 = np.asarray(res.p50, dtype=np.float64)
        if len(p50) < horizon:
            return None
        pred_delta = float(p50[horizon - 1] - entry)
        pred_dir = (
            "flat" if abs(pred_delta) < 1e-12
            else ("up" if pred_delta > 0 else "down")
        )
        conf = float(res.confidence)

        future = closes[t + 1 : t + 1 + horizon]
        actual_delta = float(future[-1] - entry)
        actual_dir = (
            "flat" if abs(actual_delta) < 1e-12
            else ("up" if actual_delta > 0 else "down")
        )
        pnl = _simulate(pred_dir, entry, future, stop_pct, payoff) if pred_dir != "flat" else 0.0
        return {
            "conf": conf,
            "pred": pred_dir,
            "actual": actual_dir,
            "correct": pred_dir != "flat" and pred_dir == actual_dir,
            "pnl": pnl,
        }


def _simulate(direction: str, entry: float, future: np.ndarray, stop_pct: float, payoff: float) -> float:
    """First-touch P&L — identical to Kronos's helper."""
    long = direction == "up"
    if long:
        stop, target = entry * (1 - stop_pct), entry * (1 + stop_pct * payoff)
    else:
        stop, target = entry * (1 + stop_pct), entry * (1 - stop_pct * payoff)
    for px in future:
        if long:
            if px <= stop:
                return -stop_pct
            if px >= target:
                return stop_pct * payoff
        else:
            if px >= stop:
                return -stop_pct
            if px <= target:
                return stop_pct * payoff
    ret = (float(future[-1]) - entry) / entry
    return ret if long else -ret


async def evaluate(
    client: TsfmClient,
    bars: list[dict],
    *,
    symbol: str,
    horizon: int,
    stride: int,
    stop_pct: float,
    payoff: float,
) -> dict:
    """Walk-forward over `bars`, calling TSFM.ai's ensemble at each
    decision point. Concurrency is bounded by `BACKTEST_CONCURRENCY`."""
    ctx = settings.context_length
    horizon = min(horizon, settings.prediction_length)
    n = len(bars)
    closes = np.array([b["close"] for b in bars], dtype=np.float64)

    sem = asyncio.Semaphore(BACKTEST_CONCURRENCY)
    tasks: list[asyncio.Task[dict | None]] = []
    for t in range(ctx - 1, n - horizon, stride):
        window_bars = bars[t - ctx + 1 : t + 1]
        tasks.append(asyncio.create_task(_evaluate_window(
            client, symbol=symbol, window_bars=window_bars,
            closes=closes, t=t, horizon=horizon,
            stop_pct=stop_pct, payoff=payoff, sem=sem,
        )))
    results = await asyncio.gather(*tasks)
    rows = [r for r in results if r is not None]
    return _summarize(rows, stop_pct, payoff)


def _summarize(rows: list[dict], stop_pct: float, payoff: float) -> dict:
    directional = [r for r in rows if r["pred"] != "flat"]
    n = len(directional)
    if n == 0:
        return {"n": 0}
    hit = sum(r["correct"] for r in directional) / n
    brier = float(np.mean([(r["conf"] - (1.0 if r["correct"] else 0.0)) ** 2 for r in directional]))
    floors = [0.0, 0.2, 0.3, 0.4, 0.5]
    by_floor = []
    for f in floors:
        sub = [r for r in directional if r["conf"] >= f]
        if sub:
            by_floor.append({
                "floor": f, "n": len(sub),
                "hit": sum(r["correct"] for r in sub) / len(sub),
                "pnl": sum(r["pnl"] for r in sub),
            })
    pnls = [r["pnl"] for r in directional]
    wins = [p for p in pnls if p > 0]
    losses = [p for p in pnls if p < 0]
    # Profit factor is undefined when nobody lost. JSON can't carry inf,
    # so we surface `None` and let the UI show "—"; the existing
    # BacktestPerSymbol pydantic model already accepts None.
    profit_factor = (sum(wins) / abs(sum(losses))) if losses else None
    return {
        "n": n,
        "flat": len(rows) - n,
        "hit": hit,
        "brier": brier,
        "total_pnl_pct": sum(pnls) * 100,
        "avg_pnl_bps": float(np.mean(pnls)) * 1e4,
        "win_rate": (len(wins) / n),
        "profit_factor": profit_factor,
        "by_floor": by_floor,
    }


def _aggregate(per_symbol, symbols, granularity, count, horizon, stride, stop_pct, payoff, *, model_key):
    ok = [s for s in per_symbol if s.get("n", 0) > 0]
    n_total = sum(s["n"] for s in ok)
    if n_total == 0:
        summary = {
            "n_forecasts": 0, "overall_hit_rate": None, "overall_brier": None,
            "overall_pnl_pct": None, "best_floor": None, "weak_symbols": [],
        }
    else:
        wavg = lambda field: sum(s[field] * s["n"] for s in ok) / n_total  # noqa: E731
        floor_pool: dict[float, dict] = {}
        for s in ok:
            for b in s.get("by_floor", []):
                f = b["floor"]
                fp = floor_pool.setdefault(f, {"floor": f, "n": 0, "hits": 0.0, "pnl": 0.0})
                fp["n"] += b["n"]
                fp["hits"] += b["hit"] * b["n"]
                fp["pnl"] += b["pnl"]
        merged_floors = []
        for f, fp in sorted(floor_pool.items()):
            if fp["n"] == 0:
                continue
            merged_floors.append({
                "floor": f, "n": fp["n"],
                "hit": fp["hits"] / fp["n"], "pnl": fp["pnl"],
            })
        candidates = [b for b in merged_floors if b["hit"] >= 0.53 and b["n"] >= 100]
        best_floor = max(candidates, key=lambda b: b["hit"]) if candidates else None
        weak_symbols = [
            s["symbol"] for s in ok
            if s.get("hit") is not None and s["hit"] < 0.48 and s["n"] >= 50
        ]
        summary = {
            "n_forecasts": n_total,
            "overall_hit_rate": wavg("hit"),
            "overall_brier": wavg("brier"),
            "overall_pnl_pct": sum(s["total_pnl_pct"] for s in ok) / len(ok),
            "by_floor": merged_floors,
            "best_floor": best_floor,
            "weak_symbols": weak_symbols,
        }
    return {
        "model_key": model_key,
        "params": {
            "symbols": symbols, "granularity": granularity, "count": count,
            "horizon": horizon, "stride": stride,
            "stop_pct": stop_pct, "payoff": payoff,
        },
        "per_symbol": per_symbol,
        "summary": summary,
    }


async def run_for_symbols(
    *,
    client: TsfmClient,
    symbols: list[str],
    granularity: int,
    count: int,
    horizon: int,
    stride: int,
    stop_pct: float,
    payoff: float,
) -> dict:
    """Programmatic entry — same evaluation as the CLI form, returns a
    structured dict the api can persist as `backtest_runs.result_json`."""
    per_symbol: list[dict] = []
    for sym in symbols:
        try:
            bars = await fetch_ohlcv(sym, granularity, count)
        except Exception as e:
            per_symbol.append({"symbol": sym, "error": str(e)})
            continue
        if len(bars) < settings.context_length + horizon:
            per_symbol.append({
                "symbol": sym,
                "error": f"only {len(bars)} candles, need {settings.context_length + horizon}",
            })
            continue
        m = await evaluate(
            client, bars, symbol=sym,
            horizon=horizon, stride=stride,
            stop_pct=stop_pct, payoff=payoff,
        )
        m["symbol"] = sym
        per_symbol.append(m)

    return _aggregate(
        per_symbol, symbols, granularity, count, horizon, stride,
        stop_pct, payoff, model_key=settings.model_label,
    )
