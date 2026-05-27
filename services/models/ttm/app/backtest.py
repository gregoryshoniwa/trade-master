"""Walk-forward backtest for the TTM forecaster.

The single most important question this answers: **does TTM actually have
directional edge on a given instrument, before we risk money on it?**

It pulls historical candles from Deriv (no auth — public `ticks_history`),
slides the model across them, and for every forecast compares the predicted
direction H steps ahead against what the price actually did. It reports:

  - directional hit-rate (overall + per confidence bucket + at trade floors)
  - Brier score (is the confidence honest, or just noise?)
  - a spread-free P&L simulation using the live stop/target logic

Run it (model weights are already cached in the ttm image):

  docker compose run --rm ttm python -m app.backtest \
      --symbols frxEURUSD,frxXAUUSD,cryBTCUSD \
      --granularity 60 --count 5000 --horizon 60 --stride 3

A hit-rate near 50% means no edge (a coin flip) — expected for random-walk
synthetics. We want to see hit-rate climbing as the confidence floor rises;
that's the signature of a model that knows when it knows.
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
from app.ttm_forecaster import make_default_forecaster

logging.basicConfig(level=logging.WARNING, format="%(message)s")
log = logging.getLogger("trademaster.backtest")

# Deriv's public demo app_id — fine for unauthenticated historical data.
DERIV_WS = "wss://ws.derivws.com/websockets/v3?app_id=1089"

# Live trading params we're simulating against (mirror decision_loop.py).
DEFAULT_STOP_PCT = 0.005   # 0.5%
DEFAULT_PAYOFF = 1.5       # target = stop_pct * payoff


async def fetch_candles(symbol: str, granularity: int, count: int) -> np.ndarray:
    """Fetch `count` candles at `granularity` seconds; return close prices."""
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
                candles = msg["candles"]
                return np.array([float(c["close"]) for c in candles], dtype=np.float64)
            if msg.get("error"):
                raise RuntimeError(f"{symbol}: {msg['error']['message']}")


def evaluate(
    forecaster,
    closes: np.ndarray,
    *,
    horizon: int,
    stride: int,
    stop_pct: float,
    payoff: float,
) -> dict:
    """Walk-forward over `closes`. At each decision point t we feed the model
    closes[..t], read its direction/confidence at `horizon` steps ahead, and
    score it against the realised path closes[t+1 .. t+horizon]."""
    ctx = forecaster.context_length
    n = len(closes)
    horizon = min(horizon, forecaster.prediction_length)

    rows: list[dict] = []
    for t in range(ctx - 1, n - horizon, stride):
        window = closes[t - ctx + 1 : t + 1]
        entry = float(closes[t])
        res = forecaster.forecast(window)
        p50 = np.asarray(res["p50"], dtype=np.float64)
        # Direction at our chosen horizon (model gives the full p50 path).
        pred_delta = float(p50[horizon - 1] - entry)
        pred_dir = "flat" if abs(pred_delta) < 1e-12 else ("up" if pred_delta > 0 else "down")
        conf = float(res["confidence"])

        future = closes[t + 1 : t + 1 + horizon]
        actual_delta = float(future[-1] - entry)
        actual_dir = "flat" if abs(actual_delta) < 1e-12 else ("up" if actual_delta > 0 else "down")

        # P&L: enter in predicted direction, exit on stop/target if touched
        # within the horizon window, else mark out at the horizon close.
        # Returns are in fraction-of-price (spread/fees excluded — this is an
        # upper bound on a real strategy, deliberately optimistic).
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
    # No touch — mark to the final close as a signed return.
    ret = (float(future[-1]) - entry) / entry
    return ret if long else -ret


def _summarize(rows: list[dict], stop_pct: float, payoff: float) -> dict:
    directional = [r for r in rows if r["pred"] != "flat"]
    n = len(directional)
    if n == 0:
        return {"n": 0}

    hit = sum(r["correct"] for r in directional) / n
    # Brier: confidence as P(correct). outcome 1/0.
    brier = float(np.mean([(r["conf"] - (1.0 if r["correct"] else 0.0)) ** 2 for r in directional]))

    # Hit-rate at rising confidence floors — the key diagnostic.
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


async def run(args: argparse.Namespace) -> None:
    symbols = [s.strip() for s in args.symbols.split(",") if s.strip()]
    print(f"Loading TTM ({settings.model_repo}) …", file=sys.stderr)
    fc = make_default_forecaster()
    fc.load()

    print("\n" + "=" * 64)
    print(f"  TTM walk-forward backtest  ·  stop {args.stop_pct*100:.2f}% / payoff {args.payoff}×")
    print(f"  (P&L excludes spread+fees — optimistic upper bound)")
    print("=" * 64)

    overall = []
    for sym in symbols:
        try:
            closes = await fetch_candles(sym, args.granularity, args.count)
        except Exception as e:
            print(f"\n  {sym}: fetch failed — {e}")
            continue
        if len(closes) < fc.context_length + args.horizon:
            print(f"\n  {sym}: only {len(closes)} candles, need "
                  f"{fc.context_length + args.horizon}")
            continue
        m = await asyncio.to_thread(
            evaluate, fc, closes,
            horizon=args.horizon, stride=args.stride,
            stop_pct=args.stop_pct, payoff=args.payoff,
        )
        _print_report(sym, args.granularity, args.horizon, m)
        if m.get("n"):
            overall.append((sym, m["hit"], m["total_pnl_pct"]))

    print("\n" + "=" * 64)
    if overall:
        print("  SUMMARY (hit-rate · sim P&L):")
        for sym, hit, pnl in sorted(overall, key=lambda x: -x[1]):
            print(f"    {sym:12s}  {hit*100:5.1f}%   {pnl:+.2f}%")
    print("  A hit-rate near 50% = no edge. Want it rising with the conf floor.")
    print("=" * 64 + "\n")


def main() -> None:
    p = argparse.ArgumentParser(description="TTM walk-forward backtest")
    p.add_argument("--symbols", default="frxEURUSD,frxXAUUSD,cryBTCUSD",
                   help="comma-separated Deriv symbols")
    p.add_argument("--granularity", type=int, default=60, help="candle seconds")
    p.add_argument("--count", type=int, default=5000, help="candles to fetch (≤5000)")
    p.add_argument("--horizon", type=int, default=60,
                   help="steps ahead to score (≤ model prediction_length)")
    p.add_argument("--stride", type=int, default=3,
                   help="evaluate every Nth window (speed vs coverage)")
    p.add_argument("--stop-pct", type=float, default=DEFAULT_STOP_PCT, dest="stop_pct")
    p.add_argument("--payoff", type=float, default=DEFAULT_PAYOFF)
    args = p.parse_args()
    asyncio.run(run(args))


if __name__ == "__main__":
    main()
