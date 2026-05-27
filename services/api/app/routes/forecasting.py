"""GET /api/v1/forecasting/models — the TSFM registry for the agent-config UI."""

from dataclasses import asdict

from fastapi import APIRouter

from app.forecasting import CATALOG

router = APIRouter(prefix="/forecasting", tags=["forecasting"])


@router.get("/models")
async def list_forecasting_models():
    """Return the full forecasting-model catalog. Auth not required — the menu
    exposes nothing sensitive."""
    return {"models": [asdict(m) for m in CATALOG]}
