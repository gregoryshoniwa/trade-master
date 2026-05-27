"""Kronos forecaster service entrypoint.

HTTP is only for /healthz. The real work runs on background tasks: NATS
subscribe → candle aggregation → Kronos inference → publish forecast.
"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.config import settings
from app.kronos_forecaster import make_default_forecaster
from app.publisher import ForecasterService

logging.basicConfig(
    level=getattr(logging, settings.log_level.upper(), logging.INFO),
    format='{"level":"%(levelname)s","logger":"%(name)s","msg":%(message)r}',
)
log = logging.getLogger("trademaster.kronos")


@asynccontextmanager
async def lifespan(app: FastAPI):
    forecaster = make_default_forecaster()
    forecaster.load()
    service = ForecasterService(forecaster)
    await service.start()
    app.state.service = service
    try:
        yield
    finally:
        await service.stop()


app = FastAPI(title="TradeMaster · Kronos forecaster", lifespan=lifespan)


@app.get("/healthz")
async def healthz():
    service: ForecasterService | None = getattr(app.state, "service", None)
    if service is None:
        return {"status": "starting"}
    return {
        "status": "ok",
        "buffers": {sym: buf.closed_count() for sym, buf in service.buffers.items()},
        "warmed": sorted(service._warmed),
        "context_length": settings.context_length,
        "prediction_length": settings.prediction_length,
    }
