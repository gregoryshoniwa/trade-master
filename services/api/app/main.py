"""FastAPI app entrypoint."""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.db import close_pool, init_pool
from app.routes import agents as agents_routes
from app.routes import auth as auth_routes
from app.routes import companies as companies_routes
from app.routes import me as me_routes
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
    try:
        yield
    finally:
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
