"""GET /api/v1/llm/models — the model registry for the agent-config UI."""

from dataclasses import asdict

from fastapi import APIRouter

from app.llm import CATALOG

router = APIRouter(prefix="/llm", tags=["llm"])


@router.get("/models")
async def list_models():
    """Return the full model catalog. Authentication not required —
    listing the menu doesn't expose anything sensitive."""
    return {"models": [asdict(m) for m in CATALOG]}
