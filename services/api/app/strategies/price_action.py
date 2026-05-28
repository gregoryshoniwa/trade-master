"""Price action — PLAN §4.5.

Phase-1 detects two patterns on the last bar:

  Bullish pin bar  → BUY: long lower wick (≥2× body), tiny upper wick,
                     close in the upper third of the bar range.
  Bearish pin bar  → SELL: mirror.

  Bullish engulfing → BUY: previous bar red, current bar green and
                      fully engulfs the previous body.
  Bearish engulfing → SELL: mirror.

Otherwise HOLD. Production version would add inside-bar / three-bar / fakey
and require confluence with S/R or trend.
"""

from __future__ import annotations

import numpy as np


def _open_of(closes: np.ndarray, highs: np.ndarray, lows: np.ndarray, i: int) -> float:
    """We only have OHLC from QuestDB SAMPLE BY; this returns the bar's open
    when we have it. (The current closes/highs/lows arrays are derived from
    the OHLC list in the dispatcher — the dispatcher omits open from the
    arrays it passes; we approximate open as the previous close for the
    purpose of engulfing detection on a single-arg signature.)"""
    return float(closes[i - 1]) if i > 0 else float(closes[i])


def evaluate(*, closes: np.ndarray, highs: np.ndarray, lows: np.ndarray) -> tuple[str, float, str]:
    if closes.size < 3:
        return "HOLD", 0.0, f"need 3 bars, have {closes.size}"

    last_c = float(closes[-1])
    last_h = float(highs[-1])
    last_l = float(lows[-1])
    last_o = _open_of(closes, highs, lows, closes.size - 1)
    prev_c = float(closes[-2])
    prev_o = _open_of(closes, highs, lows, closes.size - 2)

    rng = last_h - last_l
    if rng <= 0:
        return "HOLD", 0.0, "zero-range bar"
    body = abs(last_c - last_o)
    upper_wick = last_h - max(last_c, last_o)
    lower_wick = min(last_c, last_o) - last_l

    # Pin bar — long wick, small body, close in opposite third.
    if body > 0 and lower_wick >= 2 * body and upper_wick < body and last_c > last_l + 0.66 * rng:
        return "BUY", min(1.0, lower_wick / rng), \
               f"bullish pin: wick {lower_wick:.5f} ≥ 2×body {body:.5f}"
    if body > 0 and upper_wick >= 2 * body and lower_wick < body and last_c < last_l + 0.33 * rng:
        return "SELL", min(1.0, upper_wick / rng), \
               f"bearish pin: wick {upper_wick:.5f} ≥ 2×body {body:.5f}"

    # Engulfing — previous red, current green & body engulfs (or mirror).
    prev_body_lo, prev_body_hi = min(prev_o, prev_c), max(prev_o, prev_c)
    if prev_c < prev_o and last_c > last_o and last_o <= prev_body_lo and last_c >= prev_body_hi:
        return "BUY", 0.75, "bullish engulfing"
    if prev_c > prev_o and last_c < last_o and last_o >= prev_body_hi and last_c <= prev_body_lo:
        return "SELL", 0.75, "bearish engulfing"

    return "HOLD", 0.0, "no pin/engulfing pattern"
