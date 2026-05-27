"""FastAPI app entrypoint."""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.db import close_pool, init_pool
from app.decision_loop import start_decision_loop, stop_decision_loop
from app.routes import agents as agents_routes
from app.routes import approvals as approvals_routes
from app.routes import auth as auth_routes
from app.routes import chat as chat_routes
from app.routes import companies as companies_routes
from app.routes import llm_models as llm_models_routes
from app.routes import me as me_routes
from app.routes import members as members_routes
from app.routes import payroll as payroll_routes
from app.routes import symbols as symbols_routes

logging.basicConfig(
    level=logging.INFO,
    format='{"level":"%(levelname)s","logger":"%(name)s","msg":%(message)r}',
)
log = logging.getLogger("trademaster.api")


@asynccontextmanager
async def lifespan(_: FastAPI):
    await init_pool()
    log.info("db pool ready")
    # Decision loop subscribes to NATS signals.> in the background.
    # Failures inside its start() don't bubble up — chat must still work
    # even if the decision pipeline is down.
    await start_decision_loop()
    try:
        yield
    finally:
        await stop_decision_loop()
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
app.include_router(me_routes.router, prefix="/api/v1")
app.include_router(companies_routes.router, prefix="/api/v1")
app.include_router(agents_routes.router, prefix="/api/v1")
app.include_router(agents_routes.personality_router, prefix="/api/v1")
app.include_router(symbols_routes.router, prefix="/api/v1")
app.include_router(chat_routes.router, prefix="/api/v1")
app.include_router(members_routes.router, prefix="/api/v1")
app.include_router(llm_models_routes.router, prefix="/api/v1")
app.include_router(payroll_routes.router, prefix="/api/v1")
app.include_router(approvals_routes.router, prefix="/api/v1")
