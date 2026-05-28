"""Mean reversion — PLAN §4.4.

Phase-1 rule:
  - BUY if last close < BB lower(20,2) AND RSI(14) < 30 (oversold).
  - SELL if last close > BB upper(20,2) AND RSI(14) > 70 (overbought).
  - otherwise HOLD.

Production (TODO): require Hurst exponent <0.45 (mean-reverting regime),
OU half-life filter, and exit at the mid-band.
"""

from __future__ import annotations

import math

import numpy as np

from app.strategies.indicators import bb, rsi


def evaluate(*, closes: np.ndarray, highs: np.ndarray, lows: np.ndarray) -> tuple[str, float, str]:
    _ = highs, lows  # unused; signature consistency
    if closes.size < 20:
        return "HOLD", 0.0, f"need 20 bars, have {closes.size}"
    mid, upper, lower = bb(closes, 20, 2.0)
    rsi_v = rsi(closes, 14)
    if math.isnan(mid) or math.isnan(rsi_v):
        return "HOLD", 0.0, "indicator nan"
    last = float(closes[-1])
    if last < lower and rsi_v < 30:
        dist = (lower - last) / max(upper - lower, 1e-9)
        return "BUY", min(1.0, dist * 4 + (30 - rsi_v) / 30 * 0.3), \
               f"close {last:.5f} < BB-lower {lower:.5f}, RSI {rsi_v:.1f}<30"
    if last > upper and rsi_v > 70:
        dist = (last - upper) / max(upper - lower, 1e-9)
        return "SELL", min(1.0, dist * 4 + (rsi_v - 70) / 30 * 0.3), \
               f"close {last:.5f} > BB-upper {upper:.5f}, RSI {rsi_v:.1f}>70"
    return "HOLD", 0.0, f"close {last:.5f} inside BB [{lower:.5f}, {upper:.5f}], RSI {rsi_v:.1f}"
