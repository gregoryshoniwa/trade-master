"""Walk-forward backtest for the Kronos forecaster.

Same question the TTM backtest answers, asked of the OHLCV K-line model:
**does Kronos actually have directional edge on a given instrument, before
we risk money on it?**

We pull historical OHLCV candles from Deriv's public `ticks_history`, slide
the model across them, and for every forecast compare the predicted
direction H steps ahead against what the price actually did. Output:

  - directional hit-rate (overall + per confidence bucket)
  - Brier score (is the confidence honest, or just noise?)
  - sim P&L using the live stop/target logic (no spread/fees — optimistic)

Run it (model weights are cached in the kronos image):

  docker compose run --rm kronos python -m app.backtest \\
      --symbols frxEURUSD,frxXAUUSD,cryBTCUSD \\
      --granularity 60 --count 5000 --horizon 12 --stride 3

A hit-rate near 50% means no edge (a coin flip). We want it climbing as the
confidence floor rises — that's the signature of a model that knows when
it knows.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import sys

import numpy as np
import websockets

from app.config import settings
from app.kronos_forecaster import make_default_forecaster

logging.basicConfig(level=logging.WARNING, format="%(message)s")
log = logging.getLogger("trademaster.kronos.backtest")

# Deriv's public demo app_id — fine for unauthenticated historical data.
DERIV_WS = "wss://ws.derivws.com/websockets/v3?app_id=1089"

# Live trading params we're simulating against (mirror decision_loop.py).
DEFAULT_STOP_PCT = 0.005   # 0.5%
DEFAULT_PAYOFF = 1.5       # target = stop_pct * payoff


async def fetch_ohlcv(symbol: str, granularity: int, count: int) -> list[dict]:
    """Fetch `count` OHLCV bars at `granularity` seconds. Each row is the
    dict shape Kronos consumes (t/open/high/low/close/volume)."""
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
                # Deriv's candles don't carry volume on FX/synthetics, so we
                # fall back to 1.0 — Kronos still encodes the row, the
                # tokenizer just sees a flat volume series.
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


def evaluate(
    forecaster,
    bars: list[dict],
    *,
    horizon: int,
    stride: int,
    stop_pct: float,
    payoff: float,
) -> dict:
    """Walk-forward over `bars`. At each decision point t we feed the model
    bars[..t], read its direction/confidence at `horizon` steps ahead, and
    score it against the realised path of closes from bars[t+1..t+horizon]."""
    ctx = forecaster.context_length
    n = len(bars)
    horizon = min(horizon, forecaster.prediction_length)

    closes = np.array([b["close"] for b in bars], dtype=np.float64)

    rows: list[dict] = []
    for t in range(ctx - 1, n - horizon, stride):
        window = bars[t - ctx + 1 : t + 1]
        entry = float(closes[t])
        try:
            res = forecaster.forecast(window)
        except Exception as e:
            log.warning("forecast failed at t=%d: %s", t, e)
            continue
        p50 = np.asarray(res["p50"], dtype=np.float64)
        pred_delta = float(p50[horizon - 1] - entry)
        pred_dir = "flat" if abs(pred_delta) < 1e-12 else ("up" if pred_delta > 0 else "down")
        conf = float(res["confidence"])

        future = closes[t + 1 : t + 1 + horizon]
        actual_delta = float(future[-1] - entry)
        actual_dir = "flat" if abs(actual_delta) < 1e-12 else ("up" if actual_delta > 0 else "down")

        pnl = _simulate(pred_dir, entry, future, stop_pct, payoff) if pred_dir != "flat" else 0.0

        rows.append({
            "conf": conf,
            "pred": pred_dir,
            "actual": actual_dir,
            "correct": pred_dir != "flat" and pred_dir == actual_dir,
            "pnl": pnl,
        })

    return _summarize(rows, stop_pct, payoff)


def _simulate(direction: str, entry: float, future: np.ndarray, stop_pct: float, payoff: float) -> float:
    """First-touch P&L: ride a position from `entry` until stop or target is
    crossed, else mark to the final close. Returns fraction-of-price (signed)."""
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
                "floor": f,
                "n": len(sub),
                "hit": sum(r["correct"] for r in sub) / len(sub),
                "pnl": sum(r["pnl"] for r in sub),
            })

    pnls = [r["pnl"] for r in directional]
    wins = [p for p in pnls if p > 0]
    losses = [p for p in pnls if p < 0]
    profit_factor = (sum(wins) / abs(sum(losses))) if losses else float("inf")

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


def _print_report(symbol: str, granularity: int, horizon: int, m: dict) -> None:
    if m.get("n", 0) == 0:
        print(f"\n  {symbol}: no usable windows (not enough data)\n")
        return
    print(f"\n  ── {symbol}  ({granularity}s candles, horizon {horizon} steps) ─────────────")
    print(f"     forecasts: {m['n']}   (flat skipped: {m['flat']})")
    edge = (m["hit"] - 0.5) * 100
    verdict = "EDGE" if edge > 2 else ("noise" if abs(edge) <= 2 else "INVERSE")
    print(f"     hit-rate:  {m['hit']*100:5.1f}%   ({edge:+.1f}pp vs coin-flip → {verdict})")
    print(f"     brier:     {m['brier']:.4f}   (lower = better-calibrated confidence)")
    print(f"     sim P&L:   {m['total_pnl_pct']:+.2f}%  ·  avg {m['avg_pnl_bps']:+.1f} bps/trade  "
          f"·  win {m['win_rate']*100:.0f}%  ·  PF {m['profit_factor']:.2f}")
    print("     hit-rate by confidence floor:")
    for b in m["by_floor"]:
        print(f"       conf ≥ {b['floor']:.1f}:  {b['hit']*100:5.1f}%  "
              f"on {b['n']:4d} signals   (sim P&L {b['pnl']*100:+.2f}%)")


async def run_for_symbols(
    *,
    forecaster,
    symbols: list[str],
    granularity: int,
    count: int,
    horizon: int,
    stride: int,
    stop_pct: float,
    payoff: float,
) -> dict:
    """Programmatic entry — same evaluation as the CLI, returns a structured
    dict. The api's backtests route hits this via /backtest HTTP, the CLI
    wraps it with `run()` for print output."""
    per_symbol: list[dict] = []
    for sym in symbols:
        try:
            bars = await fetch_ohlcv(sym, granularity, count)
        except Exception as e:
            per_symbol.append({"symbol": sym, "error": str(e)})
            continue
        if len(bars) < forecaster.context_length + horizon:
            per_symbol.append({
                "symbol": sym,
                "error": f"only {len(bars)} candles, need {forecaster.context_length + horizon}",
            })
            continue
        m = await asyncio.to_thread(
            evaluate, forecaster, bars,
            horizon=horizon, stride=stride,
            stop_pct=stop_pct, payoff=payoff,
        )
        m["symbol"] = sym
        per_symbol.append(m)

    return _aggregate(per_symbol, symbols, granularity, count, horizon, stride, stop_pct, payoff,
                       model_key=settings.model_label)


def _aggregate(per_symbol, symbols, granularity, count, horizon, stride, stop_pct, payoff, *, model_key):
    """Aggregate per-symbol metrics. Same shape and rules as the TTM
    backtest — keeps the api's apply-recommendation logic model-agnostic."""
    ok = [s for s in per_symbol if s.get("n", 0) > 0]
    n_total = sum(s["n"] for s in ok)
    if n_total == 0:
        summary = {
            "n_forecasts": 0,
            "overall_hit_rate": None,
            "overall_brier": None,
            "overall_pnl_pct": None,
            "best_floor": None,
            "weak_symbols": [],
        }
    else:
        wavg = lambda field: sum(s[field] * s["n"] for s in ok) / n_total
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


async def run(args: argparse.Namespace) -> None:
    """CLI entry — prints a human-readable report."""
    symbols = [s.strip() for s in args.symbols.split(",") if s.strip()]
    print(f"Loading Kronos ({settings.model_repo}) …", file=sys.stderr)
    fc = make_default_forecaster()
    fc.load()

    print("\n" + "=" * 64)
    print(f"  Kronos walk-forward backtest  ·  stop {args.stop_pct*100:.2f}% / payoff {args.payoff}×")
    print(f"  model={settings.model_label}  ctx={fc.context_length}  horizon={args.horizon}/{fc.prediction_length}")
    print(f"  (P&L excludes spread+fees — optimistic upper bound)")
    print("=" * 64)

    result = await run_for_symbols(
        forecaster=fc, symbols=symbols, granularity=args.granularity,
        count=args.count, horizon=args.horizon, stride=args.stride,
        stop_pct=args.stop_pct, payoff=args.payoff,
    )
    for s in result["per_symbol"]:
        if "error" in s:
            print(f"\n  {s['symbol']}: {s['error']}")
            continue
        _print_report(s["symbol"], args.granularity, args.horizon, s)
    print("\n" + "=" * 64)
    ok = [s for s in result["per_symbol"] if s.get("n", 0) > 0]
    if ok:
        print("  SUMMARY (hit-rate · sim P&L):")
        for s in sorted(ok, key=lambda x: -x["hit"]):
            print(f"    {s['symbol']:12s}  {s['hit']*100:5.1f}%   {s['total_pnl_pct']:+.2f}%")
        bf = result["summary"].get("best_floor")
        if bf:
            print(f"  Recommended min_confidence_threshold ≥ {bf['floor']:.2f}  "
                  f"({bf['hit']*100:.1f}% on {bf['n']} signals)")
    print("  A hit-rate near 50% = no edge. Want it rising with the conf floor.")
    print("=" * 64 + "\n")


def main() -> None:
    p = argparse.ArgumentParser(description="Kronos walk-forward backtest")
    p.add_argument("--symbols", default="frxEURUSD,frxXAUUSD,cryBTCUSD",
                   help="comma-separated Deriv symbols")
    p.add_argument("--granularity", type=int, default=60, help="candle seconds")
    p.add_argument("--count", type=int, default=5000, help="candles to fetch (≤5000)")
    p.add_argument("--horizon", type=int, default=12,
                   help="steps ahead to score (≤ model prediction_length)")
    p.add_argument("--stride", type=int, default=3,
                   help="evaluate every Nth window (speed vs coverage)")
    p.add_argument("--stop-pct", type=float, default=DEFAULT_STOP_PCT, dest="stop_pct")
    p.add_argument("--payoff", type=float, default=DEFAULT_PAYOFF)
    args = p.parse_args()
    asyncio.run(run(args))


if __name__ == "__main__":
    main()
