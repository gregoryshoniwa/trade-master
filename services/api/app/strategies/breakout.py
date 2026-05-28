"""Breakout & Retest — PLAN §4.2.

Phase-1 rule:
  - BUY if last close > max(last 50 highs excluding last bar) + 0.5×ATR(14).
  - SELL if last close < min(last 50 lows excluding last bar) − 0.5×ATR(14).
  - otherwise HOLD.

Production (TODO): wait for retest of the broken level + rejection candle;
volume confirmation (Deriv ticks carry no volume, so we proxy with tick
count once the kronos candle aggregator publishes alongside QuestDB).
"""

from __future__ import annotations

import math

import numpy as np

from app.strategies.indicators import atr


def evaluate(*, closes: np.ndarray, highs: np.ndarray, lows: np.ndarray) -> tuple[str, float, str]:
    if closes.size < 51:
        return "HOLD", 0.0, f"need 51 bars, have {closes.size}"
    a = atr(highs, lows, closes, 14)
    if math.isnan(a) or a == 0:
        return "HOLD", 0.0, "ATR nan/zero"
    last = float(closes[-1])
    hi = float(np.max(highs[-51:-1]))
    lo = float(np.min(lows[-51:-1]))
    if last > hi + 0.5 * a:
        excess = (last - hi) / a
        return "BUY", min(1.0, excess), f"close {last:.5f} broke {hi:.5f} +0.5×ATR (excess {excess:.2f}×ATR)"
    if last < lo - 0.5 * a:
        excess = (lo - last) / a
        return "SELL", min(1.0, excess), f"close {last:.5f} broke {lo:.5f} -0.5×ATR (excess {excess:.2f}×ATR)"
    return "HOLD", 0.0, f"close {last:.5f} inside [{lo:.5f}, {hi:.5f}]"
