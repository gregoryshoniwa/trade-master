"""TTM forecaster service entrypoint.

HTTP layer carries /healthz and /backtest. Background task: NATS subscribe
→ tick buffers → TTM inference → publish forecast.
"""

import asyncio
import datetime as dt
import logging
from contextlib import asynccontextmanager
from uuid import UUID

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from app import backtest, persist
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


class BacktestRequest(BaseModel):
    # See kronos/app/main.py for the rationale — when `run_id` is set the
    # model service writes results to backtest_runs directly so the run
    # survives api process restarts.
    run_id: UUID | None = Field(default=None)
    symbols: list[str] = Field(min_length=1, max_length=20)
    granularity: int = Field(default=60, ge=30, le=86400)
    count: int = Field(default=5000, ge=200, le=5000)
    horizon: int = Field(default=60, ge=1, le=240)
    stride: int = Field(default=3, ge=1, le=50)
    stop_pct: float = Field(default=0.005, gt=0.0, le=0.10)
    payoff: float = Field(default=1.5, ge=1.0, le=10.0)


async def _async_run(forecaster, req: BacktestRequest) -> None:
    assert req.run_id is not None
    started = dt.datetime.now(tz=dt.timezone.utc)
    await persist.mark_running(req.run_id)
    try:
        result = await backtest.run_for_symbols(
            forecaster=forecaster, symbols=req.symbols,
            granularity=req.granularity, count=req.count,
            horizon=req.horizon, stride=req.stride,
            stop_pct=req.stop_pct, payoff=req.payoff,
        )
    except Exception as e:
        log.exception("backtest %s failed", req.run_id)
        await persist.mark_failed(req.run_id, f"{type(e).__name__}: {e}")
        return
    await persist.mark_done(req.run_id, started, result)
    log.info(
        "backtest %s done — n=%s hit=%s",
        req.run_id,
        (result.get("summary") or {}).get("n_forecasts"),
        (result.get("summary") or {}).get("overall_hit_rate"),
    )


@app.post("/backtest")
async def run_backtest(req: BacktestRequest):
    """Walk-forward backtest. With `run_id`: fire-and-forget, the result
    lands in backtest_runs when finished. Without: synchronous (CLI)."""
    service: ForecasterService | None = getattr(app.state, "service", None)
    if service is None or service.forecaster is None:
        raise HTTPException(503, "forecaster not loaded yet")

    if req.run_id is not None:
        asyncio.create_task(_async_run(service.forecaster, req))
        return {"accepted": True, "run_id": str(req.run_id)}

    return await backtest.run_for_symbols(
        forecaster=service.forecaster, symbols=req.symbols,
        granularity=req.granularity, count=req.count,
        horizon=req.horizon, stride=req.stride,
        stop_pct=req.stop_pct, payoff=req.payoff,
    )
