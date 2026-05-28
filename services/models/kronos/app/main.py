"""Kronos forecaster service entrypoint.

HTTP carries /healthz and /backtest. Background task: NATS subscribe →
candle aggregation → Kronos inference → publish forecast.
"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from app import backtest
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


class BacktestRequest(BaseModel):
    symbols: list[str] = Field(min_length=1, max_length=20)
    granularity: int = Field(default=60, ge=30, le=86400)
    count: int = Field(default=5000, ge=200, le=5000)
    horizon: int = Field(default=12, ge=1, le=24)
    stride: int = Field(default=3, ge=1, le=50)
    stop_pct: float = Field(default=0.005, gt=0.0, le=0.10)
    payoff: float = Field(default=1.5, ge=1.0, le=10.0)


@app.post("/backtest")
async def run_backtest(req: BacktestRequest):
    """Run a walk-forward backtest using the in-memory forecaster. Slow on
    CPU (sample_count=8 forward passes per window) — the api caller should
    expect minutes, not seconds. The api runs us as a fire-and-forget task."""
    service: ForecasterService | None = getattr(app.state, "service", None)
    if service is None or service.forecaster is None:
        raise HTTPException(503, "forecaster not loaded yet")
    return await backtest.run_for_symbols(
        forecaster=service.forecaster, symbols=req.symbols,
        granularity=req.granularity, count=req.count,
        horizon=req.horizon, stride=req.stride,
        stop_pct=req.stop_pct, payoff=req.payoff,
    )
