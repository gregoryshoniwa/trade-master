"""NATS subscribe ticks.> → aggregate candles → publish signals.kronos-base.{symbol}.

Mirrors the TTM publisher's envelope exactly so the api decision loop consumes
both models unchanged. Two Kronos-specific behaviours: candle aggregation
(CandleBuffer) and a lazy per-symbol warm-start that seeds history from Deriv
the first time a symbol is short of context.
"""

import asyncio
import json
import logging
import time

import nats
from nats.aio.msg import Msg

from app.candle_buffer import CandleBuffer
from app.config import settings
from app.kronos_forecaster import KronosForecaster
from app.warmup import fetch_candles

log = logging.getLogger("trademaster.kronos.pub")


class ForecasterService:
    def __init__(self, forecaster: KronosForecaster):
        self.forecaster = forecaster
        self.buffers: dict[str, CandleBuffer] = {}
        self._nc: nats.NATS | None = None
        self._sub = None
        self._stop = asyncio.Event()
        self._last_forecast_at: dict[str, float] = {}
        self._last_forecast_window: dict[str, int] = {}
        self._warmed: set[str] = set()
        self._warming: set[str] = set()

    async def start(self) -> None:
        self._nc = await nats.connect(
            settings.nats_url, name="trademaster-kronos",
            reconnect_time_wait=2, max_reconnect_attempts=-1,
        )
        log.info("nats connected url=%s", settings.nats_url)
        self._sub = await self._nc.subscribe("ticks.>", cb=self._on_tick)
        log.info("subscribed to ticks.>")
        asyncio.create_task(self._forecast_loop())

    async def stop(self) -> None:
        self._stop.set()
        if self._sub is not None:
            await self._sub.unsubscribe()
        if self._nc is not None:
            await self._nc.drain()

    async def _on_tick(self, msg: Msg) -> None:
        try:
            data = json.loads(msg.data)
        except json.JSONDecodeError:
            return
        symbol = data.get("symbol")
        epoch = data.get("epoch")
        quote = data.get("quote")
        if not symbol or epoch is None or quote is None:
            return
        buf = self.buffers.get(symbol)
        if buf is None:
            buf = CandleBuffer(
                granularity=settings.granularity,
                maxlen=settings.context_length + settings.prediction_length + 32,
            )
            self.buffers[symbol] = buf
        buf.add_tick(int(epoch), float(quote))

    async def _forecast_loop(self) -> None:
        while not self._stop.is_set():
            await asyncio.sleep(settings.forecast_every_secs)
            for symbol, buf in list(self.buffers.items()):
                try:
                    await self._maybe_forecast(symbol, buf)
                except Exception:
                    log.exception("forecast failed symbol=%s", symbol)

    async def _warm(self, symbol: str, buf: CandleBuffer) -> None:
        """Seed a symbol from Deriv history once. Guarded against concurrent
        double-fetch; never raises (retries next cycle on failure)."""
        if symbol in self._warmed or symbol in self._warming:
            return
        self._warming.add(symbol)
        try:
            bars = await fetch_candles(symbol, settings.granularity, settings.warmup_count)
            buf.seed(bars)
            self._warmed.add(symbol)
            log.info("warm-start %s seeded %d bars (now %d closed)",
                     symbol, len(bars), buf.closed_count())
        except Exception as e:
            log.warning("warm-start %s failed (will retry): %s", symbol, e)
        finally:
            self._warming.discard(symbol)

    async def _maybe_forecast(self, symbol: str, buf: CandleBuffer) -> None:
        if buf.closed_count() < settings.context_length:
            await self._warm(symbol, buf)
            if buf.closed_count() < settings.context_length:
                return

        # Don't re-forecast the same bar, and respect a minimum cadence.
        now = time.monotonic()
        if now - self._last_forecast_at.get(symbol, 0.0) < settings.min_secs_between_forecasts:
            return
        last_window = buf.last_closed_window()
        if last_window is not None and self._last_forecast_window.get(symbol) == last_window:
            return

        bars = buf.snapshot_bars()
        asof_ts = int(bars[-1]["t"])
        last_price = float(bars[-1]["close"])

        # Kronos inference (sample_count forward passes) is CPU-blocking — run
        # it off the event loop like the TTM service does.
        result = await asyncio.to_thread(self.forecaster.forecast, bars)

        self._last_forecast_at[symbol] = now
        self._last_forecast_window[symbol] = asof_ts

        horizon = len(result["p50"])
        future_ts = [asof_ts + (i + 1) * settings.granularity for i in range(horizon)]
        forecast_rows = [
            {
                "t": future_ts[i],
                "p10": float(result["p10"][i]),
                "p50": float(result["p50"][i]),
                "p90": float(result["p90"][i]),
            }
            for i in range(horizon)
        ]

        envelope = {
            "model": settings.model_label,
            "model_version": settings.model_repo,
            "weights_hash": self.forecaster.weights_hash,
            "asset": symbol,
            "frequency": f"{settings.granularity}s",
            "asof_ts": asof_ts,
            "last_price": last_price,
            "horizon_steps": horizon,
            "forecast": forecast_rows,
            "point_direction": result["direction"],
            "confidence_score": result["confidence"],
            "latency_ms": result["latency_ms"],
            "features_used": ["open", "high", "low", "close", "volume"],
        }
        subject = f"signals.{settings.model_label}.{symbol}"
        assert self._nc is not None
        await self._nc.publish(subject, json.dumps(envelope).encode())
        log.info(
            "forecast %s asof=%d p50_h=%g dir=%s conf=%.2f latency=%.0fms",
            symbol, asof_ts, forecast_rows[-1]["p50"], result["direction"],
            result["confidence"], result["latency_ms"],
        )
