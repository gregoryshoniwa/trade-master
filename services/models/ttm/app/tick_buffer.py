"""Per-symbol ring buffer of recent tick quotes.

We collect ticks asynchronously from NATS and the inference loop reads
snapshots when it's time to forecast.
"""

import threading
from collections import deque
from collections.abc import Iterable

import numpy as np


class TickBuffer:
    """Bounded ring buffer of (epoch_sec, quote) pairs per symbol.

    Thread-safe via a Lock; we only have one writer (NATS callback) and one
    reader (forecast loop) but locking is cheap on CPython for our rate.
    """

    def __init__(self, maxlen: int):
        self.maxlen = maxlen
        self._buf: deque[tuple[int, float]] = deque(maxlen=maxlen)
        self._lock = threading.Lock()
        self._last_epoch: int | None = None

    def append(self, epoch_sec: int, quote: float) -> bool:
        """Append a tick. Returns True if accepted, False if it's an out-of-
        order duplicate (same or older epoch than the last one stored)."""
        with self._lock:
            if self._last_epoch is not None and epoch_sec <= self._last_epoch:
                return False
            self._buf.append((epoch_sec, quote))
            self._last_epoch = epoch_sec
            return True

    def __len__(self) -> int:
        with self._lock:
            return len(self._buf)

    def snapshot(self) -> tuple[np.ndarray, np.ndarray]:
        """Return (times, quotes) arrays in order. Copy under lock."""
        with self._lock:
            data: Iterable[tuple[int, float]] = list(self._buf)
        if not data:
            return np.empty(0, dtype=np.int64), np.empty(0, dtype=np.float64)
        times = np.fromiter((t for t, _ in data), dtype=np.int64, count=len(data))
        quotes = np.fromiter((q for _, q in data), dtype=np.float64, count=len(data))
        return times, quotes

    def latest(self) -> tuple[int, float] | None:
        with self._lock:
            return self._buf[-1] if self._buf else None
