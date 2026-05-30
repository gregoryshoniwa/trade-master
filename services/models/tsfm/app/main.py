"""TSFM forecaster service entrypoint.

HTTP exposes /healthz and /backtest. Background task: NATS subscribe →
candle aggregation → TSFM.ai ensemble call → publish the same signal
envelope the existing Kronos/TTM services use, so the api decision
loop matches agents on `forecasting_model = tsfm-ensemble` with zero
new wiring."""

import asyncio
import datetime as dt
import logging
from contextlib import asynccontextmanager
from uuid import UUID

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from app import backtest, persist
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


class BacktestRequest(BaseModel):
    """Same shape the api ships to ttm/kronos so the operator-facing
    backtest UI stays uniform across all three forecasters."""

    # When set, the model service owns the lifecycle: accept the
    # request, return immediately, and write the result directly into
    # `backtest_runs` when finished. Same pattern as Kronos so an api
    # rebuild doesn't kill a TSFM run mid-flight.
    run_id: UUID | None = Field(default=None)
    symbols: list[str] = Field(min_length=1, max_length=20)
    granularity: int = Field(default=60, ge=30, le=86400)
    count: int = Field(default=5000, ge=200, le=5000)
    horizon: int = Field(default=12, ge=1, le=24)
    stride: int = Field(default=3, ge=1, le=50)
    stop_pct: float = Field(default=0.005, gt=0.0, le=0.10)
    payoff: float = Field(default=1.5, ge=1.0, le=10.0)


async def _async_run(client: TsfmClient, req: BacktestRequest) -> None:
    """Run the backtest to completion off the request thread; stamps
    the row when finished. The TSFM client is shared with the live
    publisher — it's thread-safe under httpx's connection pooling."""
    assert req.run_id is not None
    started = dt.datetime.now(tz=dt.timezone.utc)
    await persist.mark_running(req.run_id)
    try:
        result = await backtest.run_for_symbols(
            client=client, symbols=req.symbols,
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
    """Walk-forward backtest of the TSFM ensemble against historical
    Deriv bars. Async fire-and-forget when `run_id` is set (api hands
    off and polls the row); synchronous otherwise (for the CLI)."""
    service: TsfmService | None = getattr(app.state, "service", None)
    if service is None:
        raise HTTPException(503, "tsfm service is disabled (TSFM_API_KEY not set)")

    if req.run_id is not None:
        asyncio.create_task(_async_run(service.client, req))
        return {"accepted": True, "run_id": str(req.run_id)}

    return await backtest.run_for_symbols(
        client=service.client, symbols=req.symbols,
        granularity=req.granularity, count=req.count,
        horizon=req.horizon, stride=req.stride,
        stop_pct=req.stop_pct, payoff=req.payoff,
    )
