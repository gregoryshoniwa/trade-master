"""TSFM forecaster service entrypoint.

HTTP exposes /healthz for the compose healthcheck. Background task:
NATS subscribe → candle aggregation → TSFM.ai ensemble call → publish
the same signal envelope the existing Kronos/TTM services use, so the
api decision loop matches agents on `forecasting_model = tsfm-ensemble`
with zero new wiring."""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.config import settings
from app.publisher import TsfmService
from app.tsfm_client import TsfmClient

logging.basicConfig(
    level=getattr(logging, settings.log_level.upper(), logging.INFO),
    format='{"level":"%(levelname)s","logger":"%(name)s","msg":%(message)r}',
)
log = logging.getLogger("trademaster.tsfm")


@asynccontextmanager
async def lifespan(app: FastAPI):
    if not settings.tsfm_api_key:
        # We still let the process boot so the healthcheck returns a
        # human-readable "disabled" rather than crashlooping; this lets
        # the rest of the stack stay up while the operator sets the key.
        log.warning(
            "TSFM_API_KEY is unset — service is idle. Set it in .env "
            "and recreate the container."
        )
        app.state.service = None
        yield
        return
    client = TsfmClient()
    service = TsfmService(client)
    await service.start()
    app.state.service = service
    log.info(
        "tsfm service ready; ensemble=%s cadence=%ss per-symbol",
        settings.ensemble_models, settings.min_secs_between_forecasts,
    )
    try:
        yield
    finally:
        await service.stop()


app = FastAPI(title="TradeMaster · TSFM ensemble forecaster", lifespan=lifespan)


@app.get("/healthz")
async def healthz():
    service: TsfmService | None = getattr(app.state, "service", None)
    if service is None:
        return {"status": "disabled", "reason": "TSFM_API_KEY not set"}
    return {
        "status": "ok",
        "buffers": {sym: buf.closed_count() for sym, buf in service.buffers.items()},
        "warmed": sorted(service._warmed),
        "ensemble_models": settings.ensemble_models,
        "calls_total": service.calls_total,
        "calls_failed": service.calls_failed,
    }
