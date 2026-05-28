"""Technical indicators used by the Phase-1 strategy modules.

Each function returns the latest value (or `nan` if there isn't enough
data). We don't vectorize for plotting — strategies just need the current
read. Pure numpy, no pandas dependency on this hot path.
"""

from __future__ import annotations

import math

import numpy as np


def ema(values: np.ndarray, n: int) -> float:
    """Exponential moving average, latest value."""
    if values.size < n:
        return math.nan
    k = 2.0 / (n + 1)
    e = float(values[0])
    for v in values[1:]:
        e = float(v) * k + e * (1 - k)
    return e


def atr(highs: np.ndarray, lows: np.ndarray, closes: np.ndarray, n: int = 14) -> float:
    """Average true range, Wilder smoothing, latest value."""
    if highs.size < n + 1:
        return math.nan
    tr = np.maximum.reduce([
        highs[1:] - lows[1:],
        np.abs(highs[1:] - closes[:-1]),
        np.abs(lows[1:] - closes[:-1]),
    ])
    a = float(np.mean(tr[:n]))
    for v in tr[n:]:
        a = (a * (n - 1) + float(v)) / n
    return a


def rsi(closes: np.ndarray, n: int = 14) -> float:
    """Relative strength index, Wilder smoothing, latest value (0..100)."""
    if closes.size < n + 1:
        return math.nan
    diff = np.diff(closes)
    gains = np.where(diff > 0, diff, 0.0)
    losses = np.where(diff < 0, -diff, 0.0)
    avg_g = float(np.mean(gains[:n]))
    avg_l = float(np.mean(losses[:n]))
    for g, l in zip(gains[n:], losses[n:], strict=False):
        avg_g = (avg_g * (n - 1) + float(g)) / n
        avg_l = (avg_l * (n - 1) + float(l)) / n
    if avg_l == 0:
        return 100.0
    rs = avg_g / avg_l
    return 100.0 - 100.0 / (1.0 + rs)


def adx(highs: np.ndarray, lows: np.ndarray, closes: np.ndarray, n: int = 14) -> float:
    """Average directional index, latest value. Higher = stronger trend."""
    if highs.size < n * 2 + 1:
        return math.nan
    up = highs[1:] - highs[:-1]
    dn = lows[:-1] - lows[1:]
    plus_dm = np.where((up > dn) & (up > 0), up, 0.0)
    minus_dm = np.where((dn > up) & (dn > 0), dn, 0.0)
    tr = np.maximum.reduce([
        highs[1:] - lows[1:],
        np.abs(highs[1:] - closes[:-1]),
        np.abs(lows[1:] - closes[:-1]),
    ])
    # Wilder smoothing
    def smooth(x: np.ndarray) -> np.ndarray:
        s = np.empty(x.size)
        s[:n] = np.sum(x[:n])
        for i in range(n, x.size):
            s[i] = s[i - 1] - s[i - 1] / n + x[i]
        return s
    tr_s = smooth(tr)
    plus_di = 100.0 * smooth(plus_dm) / np.where(tr_s == 0, 1, tr_s)
    minus_di = 100.0 * smooth(minus_dm) / np.where(tr_s == 0, 1, tr_s)
    denom = plus_di + minus_di
    dx = 100.0 * np.abs(plus_di - minus_di) / np.where(denom == 0, 1, denom)
    if dx.size < n:
        return math.nan
    a = float(np.mean(dx[n - 1 : n * 2 - 1]))
    for v in dx[n * 2 - 1 :]:
        a = (a * (n - 1) + float(v)) / n
    return a


def bb(closes: np.ndarray, n: int = 20, k: float = 2.0) -> tuple[float, float, float]:
    """Bollinger bands — (mid, upper, lower), latest values."""
    if closes.size < n:
        return math.nan, math.nan, math.nan
    window = closes[-n:]
    mid = float(np.mean(window))
    sd = float(np.std(window, ddof=0))
    return mid, mid + k * sd, mid - k * sd
