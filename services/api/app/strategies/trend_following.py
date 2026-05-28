"""Trend-following — PLAN §4.1.

Phase-1 rule (deterministic, single-trigger):
  - EMA(50) > EMA(200) AND ADX(14) ≥ 20  → BUY
  - EMA(50) < EMA(200) AND ADX(14) ≥ 20  → SELL
  - otherwise → HOLD (no trend strength)

Production version (TODO): EMA(21) pullback entry + MACD flip confirmation
+ 2×ATR trailing stop. Left as a Phase-2 follow-up.
"""

from __future__ import annotations

import math

import numpy as np

from app.strategies.indicators import adx, ema


def evaluate(*, closes: np.ndarray, highs: np.ndarray, lows: np.ndarray) -> tuple[str, float, str]:
    if closes.size < 200:
        return "HOLD", 0.0, f"need 200 bars, have {closes.size}"
    fast = ema(closes, 50)
    slow = ema(closes, 200)
    adx_v = adx(highs, lows, closes, 14)
    if math.isnan(fast) or math.isnan(slow) or math.isnan(adx_v):
        return "HOLD", 0.0, "indicator nan"
    if adx_v < 20:
        return "HOLD", 0.0, f"ADX {adx_v:.1f} < 20 (no trend)"
    # Score = how far ADX is above the threshold, capped at 1.
    score = max(0.0, min(1.0, (adx_v - 20) / 30))
    if fast > slow:
        return "BUY", score, f"EMA50 {fast:.5f} > EMA200 {slow:.5f}, ADX {adx_v:.1f}"
    if fast < slow:
        return "SELL", score, f"EMA50 {fast:.5f} < EMA200 {slow:.5f}, ADX {adx_v:.1f}"
    return "HOLD", 0.0, "EMA50 == EMA200"
