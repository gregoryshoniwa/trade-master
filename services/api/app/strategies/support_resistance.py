"""Support / Resistance — PLAN §4.3.

Phase-1 rule: find clusters of swing highs and lows in the last 200 bars,
then BUY if the latest close is within 0.5×ATR of a support cluster,
SELL if within 0.5×ATR of a resistance cluster. A "swing" is a local
high/low spanning ±3 bars.

Production (TODO): require ADX < 20 (range regime), require approach
momentum slowing (RSI flattening), and exit on opposite swing.
"""

from __future__ import annotations

import math

import numpy as np

from app.strategies.indicators import atr


def _swings(values: np.ndarray, span: int, kind: str) -> np.ndarray:
    """Indices of local extrema with `span` bars on each side."""
    if values.size < 2 * span + 1:
        return np.empty(0, dtype=int)
    out = []
    for i in range(span, values.size - span):
        window = values[i - span : i + span + 1]
        if kind == "high" and values[i] == float(np.max(window)):
            out.append(i)
        elif kind == "low" and values[i] == float(np.min(window)):
            out.append(i)
    return np.asarray(out, dtype=int)


def _cluster(prices: np.ndarray, tol: float) -> list[float]:
    """Greedy 1-D clustering: groups within `tol` collapse to their mean."""
    if prices.size == 0:
        return []
    order = np.sort(prices)
    clusters: list[list[float]] = [[float(order[0])]]
    for p in order[1:]:
        if abs(p - clusters[-1][-1]) <= tol:
            clusters[-1].append(float(p))
        else:
            clusters.append([float(p)])
    return [float(np.mean(c)) for c in clusters]


def evaluate(*, closes: np.ndarray, highs: np.ndarray, lows: np.ndarray) -> tuple[str, float, str]:
    if closes.size < 200:
        return "HOLD", 0.0, f"need 200 bars, have {closes.size}"
    a = atr(highs, lows, closes, 14)
    if math.isnan(a) or a == 0:
        return "HOLD", 0.0, "ATR nan/zero"
    tol = 0.3 * a

    hi_idx = _swings(highs, 3, "high")
    lo_idx = _swings(lows, 3, "low")
    resistance = _cluster(highs[hi_idx], tol) if hi_idx.size else []
    support = _cluster(lows[lo_idx], tol) if lo_idx.size else []

    last = float(closes[-1])
    near = 0.5 * a

    for s in support:
        if abs(last - s) <= near and last > s:
            return "BUY", min(1.0, near / (abs(last - s) + 1e-9) / 4), \
                   f"close {last:.5f} near support {s:.5f} (±0.5×ATR={near:.5f})"
    for r in resistance:
        if abs(last - r) <= near and last < r:
            return "SELL", min(1.0, near / (abs(last - r) + 1e-9) / 4), \
                   f"close {last:.5f} near resistance {r:.5f} (±0.5×ATR={near:.5f})"
    return "HOLD", 0.0, "no nearby S/R cluster"
