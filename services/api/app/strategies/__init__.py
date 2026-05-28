"""Phase-1 strategy modules + dispatcher.

PLAN §4 specifies five strategies. Each module here implements a single,
deterministic entry rule for the strategy (Phase-1 — production rules want
multi-confirmation + ATR-aware exits; left as a follow-up). The dispatcher
runs every strategy the agent has subscribed to and aggregates the verdicts.

A Verdict is one of:
  "BUY"  — long entry suggested
  "SELL" — short entry suggested
  "HOLD" — strategy declines (insufficient data or rule not met)

The decision loop accepts a signal only if at least one of the agent's
strategies returns a verdict whose direction matches the forecast.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

import numpy as np

from app.strategies import (
    breakout,
    mean_reversion,
    price_action,
    support_resistance,
    trend_following,
)


@dataclass(frozen=True)
class StrategyVerdict:
    name: str
    verdict: str          # "BUY" | "SELL" | "HOLD"
    score: float          # 0..1 confidence in the verdict
    reason: str


# Public strategy keys must match the values stored in agents.strategies[].
_REGISTRY: dict[str, Callable[..., tuple[str, float, str]]] = {
    "trend_following":    trend_following.evaluate,
    "breakout":           breakout.evaluate,
    "support_resistance": support_resistance.evaluate,
    "mean_reversion":     mean_reversion.evaluate,
    "price_action":       price_action.evaluate,
}


@dataclass(frozen=True)
class StrategyOutcome:
    accepted: bool
    verdicts: list[StrategyVerdict]
    triggering: StrategyVerdict | None
    reason: str


def evaluate(
    strategies: list[str],
    candles: list[dict],
    forecast_direction: str,
) -> StrategyOutcome:
    """Run every strategy the agent has enabled. Return an outcome that
    captures the joint decision: accepted=True iff at least one strategy's
    verdict points the same way as the forecast.

    `candles` is the OHLC list from app.ohlc (time-ascending). If empty or
    too short for the longest indicator, every strategy returns HOLD and the
    outcome is rejected — the safe failure mode.
    """
    if not candles:
        return StrategyOutcome(
            accepted=False, verdicts=[], triggering=None,
            reason="no OHLC history available",
        )
    closes = np.array([c["close"] for c in candles], dtype=np.float64)
    highs = np.array([c["high"] for c in candles], dtype=np.float64)
    lows = np.array([c["low"] for c in candles], dtype=np.float64)

    want = "BUY" if forecast_direction == "up" else "SELL" if forecast_direction == "down" else "HOLD"
    verdicts: list[StrategyVerdict] = []
    triggering: StrategyVerdict | None = None

    for name in strategies:
        fn = _REGISTRY.get(name)
        if fn is None:
            continue
        try:
            v, score, reason = fn(closes=closes, highs=highs, lows=lows)
        except Exception as e:
            v, score, reason = "HOLD", 0.0, f"strategy error: {e!r}"
        sv = StrategyVerdict(name=name, verdict=v, score=score, reason=reason)
        verdicts.append(sv)
        if triggering is None and v == want and v != "HOLD":
            triggering = sv

    if triggering is not None:
        return StrategyOutcome(
            accepted=True, verdicts=verdicts, triggering=triggering,
            reason=f"{triggering.name} aligned with forecast ({forecast_direction}): {triggering.reason}",
        )
    return StrategyOutcome(
        accepted=False, verdicts=verdicts, triggering=None,
        reason=f"no enabled strategy returned {want}",
    )
