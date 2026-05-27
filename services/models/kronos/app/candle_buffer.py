"""Per-symbol OHLCV candle aggregator + ring buffer.

Kronos eats candlesticks, not raw ticks. We bin incoming ticks into fixed
`granularity`-second bars: volume is the tick count (Deriv ticks carry no
volume), which is a fine activity proxy. The in-progress bar is held aside;
only CLOSED bars are exposed to the forecaster so we never feed a partial bar.

We do NOT forward-fill gaps. During active trading bars are regularly spaced;
the occasional missing minute (sparse forex) or weekend gap is represented
honestly by real epochs in the timestamp series rather than fabricated flat
bars that would pollute the model's context.
"""

import threading
from collections import deque


class CandleBuffer:
    def __init__(self, granularity: int, maxlen: int):
        self.granularity = granularity
        self._bars: deque[dict] = deque(maxlen=maxlen)   # closed bars, ascending
        self._cur: dict | None = None                    # in-progress bar
        self._cur_window: int | None = None
        self._lock = threading.Lock()

    def _window(self, epoch_sec: int) -> int:
        return (epoch_sec // self.granularity) * self.granularity

    def add_tick(self, epoch_sec: int, quote: float) -> None:
        win = self._window(epoch_sec)
        with self._lock:
            if self._cur_window is None:
                self._open(win, quote)
                return
            if win < self._cur_window:
                return  # out-of-order tick from a past bar; ignore
            if win > self._cur_window:
                # current bar is complete — close it and start the new one
                self._bars.append(self._cur)
                self._open(win, quote)
                return
            # same window → update OHLC
            self._cur["high"] = max(self._cur["high"], quote)
            self._cur["low"] = min(self._cur["low"], quote)
            self._cur["close"] = quote
            self._cur["volume"] += 1.0

    def _open(self, window: int, quote: float) -> None:
        self._cur_window = window
        self._cur = {
            "t": window, "open": quote, "high": quote,
            "low": quote, "close": quote, "volume": 1.0,
        }

    def seed(self, bars: list[dict]) -> None:
        """Prepend historical closed bars (time-ascending, older than live).
        Dedup by window so the warm-start seam doesn't double a bar."""
        with self._lock:
            existing = {b["t"] for b in self._bars}
            if self._cur is not None:
                existing.add(self._cur_window)
            merged = [b for b in bars if b["t"] not in existing] + list(self._bars)
            merged.sort(key=lambda b: b["t"])
            self._bars = deque(merged, maxlen=self._bars.maxlen)

    def closed_count(self) -> int:
        with self._lock:
            return len(self._bars)

    def snapshot_bars(self) -> list[dict]:
        """Closed bars only, time-ascending (copy under lock)."""
        with self._lock:
            return list(self._bars)

    def last_closed_window(self) -> int | None:
        with self._lock:
            return self._bars[-1]["t"] if self._bars else None
