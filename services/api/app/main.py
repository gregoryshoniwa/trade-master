"""FastAPI app entrypoint."""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import (
    bus,
    calibration,
    deriv as deriv_state,
    execution,
    manager_review,
    personality,
    reconcile,
    safety,
    sweep,
)
from app.calendar import start_ingestor as start_calendar
from app.calendar import stop_ingestor as stop_calendar
from app.config import settings
from app.db import close_pool, init_pool
from app.decision_loop import start_decision_loop, stop_decision_loop
from app.routes import activity as activity_routes
from app.routes import agents as agents_routes
from app.routes import approvals as approvals_routes
from app.routes import attribution as attribution_routes
from app.routes import backtests as backtests_routes
from app.routes import auth as auth_routes
from app.routes import calendar as calendar_routes
from app.routes import calibration as calibration_routes
from app.routes import chat as chat_routes
from app.routes import companies as companies_routes
from app.routes import deriv as deriv_routes
from app.routes import edge as edge_routes
from app.routes import employee_requests as employee_requests_routes
from app.routes import forecasting as forecasting_routes
from app.routes import llm_models as llm_models_routes
from app.routes import manager_actions as manager_actions_routes
from app.routes import meetings as meetings_routes
from app.routes import meetings_list as meetings_list_routes
from app.routes import notifications as notifications_routes
from app.routes import me as me_routes
from app.routes import members as members_routes
from app.routes import payroll as payroll_routes
from app.routes import postmortems as postmortems_routes
from app.routes import safety as safety_routes
from app.routes import symbols as symbols_routes
from app.routes import passkey as passkey_routes
from app.routes import voice as voice_routes

logging.basicConfig(
    level=logging.INFO,
    format='{"level":"%(levelname)s","logger":"%(name)s","msg":%(message)r}',
)
log = logging.getLogger("trademaster.api")


@asynccontextmanager
async def lifespan(_: FastAPI):
    await init_pool()
    log.info("db pool ready")
    # Shared NATS connection first — decision loop + execution consumer
    # both ride on it. All three start() calls are best-effort; chat must
    # still work even if the trading pipeline is down.
    await bus.connect()
    await start_decision_loop()
    await execution.start()
    await reconcile.start()
    # Backtests running on the previous worker process are dead — mark them
    # failed so the UI doesn't show stuck-forever rows.
    await backtests_routes.reap_orphans()
    await deriv_state.start()
    await start_calendar()
    await safety.start()
    await sweep.start()
    await personality.start()
    await manager_review.start()
    await calibration.start()
    try:
        yield
    finally:
        await calibration.stop()
        await manager_review.stop()
        await personality.stop()
        await sweep.stop()
        await safety.stop()
        await stop_calendar()
        await deriv_state.stop()
        await reconcile.stop()
        await execution.stop()
        await stop_decision_loop()
        await bus.close()
        await close_pool()


app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url=None,
)

origins = [o.strip() for o in settings.cors_origins.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)


@app.get("/healthz")
async def healthz():
    return {"status": "ok"}


# /api/v1 group
app.include_router(auth_routes.router, prefix="/api/v1")
app.include_router(passkey_routes.router, prefix="/api/v1")
app.include_router(me_routes.router, prefix="/api/v1")
app.include_router(companies_routes.router, prefix="/api/v1")
app.include_router(agents_routes.router, prefix="/api/v1")
app.include_router(agents_routes.personality_router, prefix="/api/v1")
app.include_router(symbols_routes.router, prefix="/api/v1")
app.include_router(chat_routes.router, prefix="/api/v1")
app.include_router(members_routes.router, prefix="/api/v1")
app.include_router(llm_models_routes.router, prefix="/api/v1")
app.include_router(forecasting_routes.router, prefix="/api/v1")
app.include_router(payroll_routes.router, prefix="/api/v1")
app.include_router(approvals_routes.router, prefix="/api/v1")
app.include_router(postmortems_routes.router, prefix="/api/v1")
app.include_router(manager_actions_routes.router, prefix="/api/v1")
app.include_router(calibration_routes.router, prefix="/api/v1")
app.include_router(activity_routes.router, prefix="/api/v1")
app.include_router(meetings_routes.router, prefix="/api/v1")
app.include_router(meetings_list_routes.router, prefix="/api/v1")
app.include_router(employee_requests_routes.router, prefix="/api/v1")
app.include_router(notifications_routes.router, prefix="/api/v1")
app.include_router(calendar_routes.router, prefix="/api/v1")
app.include_router(safety_routes.router, prefix="/api/v1")
app.include_router(attribution_routes.router, prefix="/api/v1")
app.include_router(backtests_routes.router, prefix="/api/v1")
app.include_router(deriv_routes.router, prefix="/api/v1")
app.include_router(edge_routes.router, prefix="/api/v1")
app.include_router(voice_routes.router, prefix="/api/v1")
app.include_router(voice_routes.voices_router, prefix="/api/v1")
