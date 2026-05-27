"""NATS subscribe to ticks.> → publish forecasts to signals.ttm.{symbol}."""

import asyncio
import json
import logging
import time

import nats
from nats.aio.msg import Msg

from app.config import settings
from app.tick_buffer import TickBuffer
from app.ttm_forecaster import TTMForecaster

log = logging.getLogger("trademaster.ttm.pub")


class ForecasterService:
    def __init__(self, forecaster: TTMForecaster):
        self.forecaster = forecaster
        self.buffers: dict[str, TickBuffer] = {}
        self._nc: nats.NATS | None = None
        self._sub = None
        self._stop = asyncio.Event()
        self._last_forecast_at: dict[str, float] = {}

    async def start(self) -> None:
        self._nc = await nats.connect(
            settings.nats_url,
            name="trademaster-ttm",
            reconnect_time_wait=2,
            max_reconnect_attempts=-1,
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
            buf = TickBuffer(maxlen=settings.context_length * 2)
            self.buffers[symbol] = buf
        buf.append(int(epoch), float(quote))

    async def _forecast_loop(self) -> None:
        """Periodically forecast each symbol whose buffer is warm enough."""
        while not self._stop.is_set():
            await asyncio.sleep(settings.forecast_every_secs)
            for symbol, buf in list(self.buffers.items()):
                try:
                    await self._maybe_forecast(symbol, buf)
                except Exception:
                    log.exception("forecast failed symbol=%s", symbol)

    async def _maybe_forecast(self, symbol: str, buf: TickBuffer) -> None:
        if len(buf) < settings.context_length:
            return

        now = time.monotonic()
        last = self._last_forecast_at.get(symbol, 0.0)
        if now - last < settings.min_secs_between_forecasts:
            return
        self._last_forecast_at[symbol] = now

        times, quotes = buf.snapshot()
        asof_ts = int(times[-1])
        last_price = float(quotes[-1])

        # Run inference in a worker thread — torch on CPU is blocking.
        result = await asyncio.to_thread(self.forecaster.forecast, quotes)

        # Synthesize one-second-ahead future timestamps. Phase 0 assumes
        # 1Hz tick cadence; later we'll derive cadence from observed inter-
        # tick deltas.
        horizon = len(result["p50"])
        future_ts = [asof_ts + i + 1 for i in range(horizon)]
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
            "frequency": "1s",
            "asof_ts": asof_ts,
            "last_price": last_price,
            "horizon_steps": horizon,
            "forecast": forecast_rows,
            "point_direction": result["direction"],
            "confidence_score": result["confidence"],
            "latency_ms": result["latency_ms"],
            "features_used": ["close"],
        }

        subject = f"signals.{settings.model_label}.{symbol}"
        assert self._nc is not None
        await self._nc.publish(subject, json.dumps(envelope).encode())
        log.info(
            "forecast %s asof=%d p50_h=%g dir=%s conf=%.2f latency=%.0fms",
            symbol, asof_ts, forecast_rows[-1]["p50"], result["direction"],
            result["confidence"], result["latency_ms"],
        )
