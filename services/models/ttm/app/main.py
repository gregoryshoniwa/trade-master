"""TTM forecaster service entrypoint.

The HTTP layer is only here for /healthz. Real work happens on background
tasks: NATS subscribe → tick buffers → TTM inference → publish forecast.
"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.config import settings
from app.publisher import ForecasterService
from app.ttm_forecaster import make_default_forecaster

logging.basicConfig(
    level=getattr(logging, settings.log_level.upper(), logging.INFO),
    format='{"level":"%(levelname)s","logger":"%(name)s","msg":%(message)r}',
)
log = logging.getLogger("trademaster.ttm")


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


app = FastAPI(title="TradeMaster · TTM forecaster", lifespan=lifespan)


@app.get("/healthz")
async def healthz():
    service: ForecasterService | None = getattr(app.state, "service", None)
    if service is None:
        return {"status": "starting"}
    return {
        "status": "ok",
        "buffers": {sym: len(buf) for sym, buf in service.buffers.items()},
        "context_length": settings.context_length,
        "prediction_length": settings.prediction_length,
    }
