"""Per-company credentials (broker + LLM provider keys).

GET returns booleans for which keys are configured — never plaintext.
PATCH accepts plaintext values which are immediately encrypted at the
storage layer (`app.credentials`). Owner/admin only.
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Literal
from uuid import UUID

import asyncpg
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from app import bus, credentials
from app.auth import CurrentAccount
from app.db import acquire

log = logging.getLogger("trademaster.credentials_route")

router = APIRouter(prefix="/companies/{company_id}", tags=["credentials"])


class CredentialsStatus(BaseModel):
    deriv_demo_configured: bool
    deriv_real_configured: bool
    deriv_environment: Literal["demo", "real"]
    # True when the active environment has no per-company token but the
    # system DERIV_API_TOKEN is set — runtime is using the fallback.
    deriv_env_fallback: bool = False
    anthropic_configured: bool
    openai_configured: bool
    gemini_configured: bool
    openrouter_configured: bool
    groq_configured: bool
    updated_at: datetime | None


class CredentialsUpdate(BaseModel):
    """All fields are optional. To clear a configured key, send empty
    string. To leave a field untouched, omit it. `deriv_environment`
    toggles which of the demo/real tokens is active."""
    deriv_token_demo: str | None = None
    deriv_token_real: str | None = None
    deriv_environment: Literal["demo", "real"] | None = None
    anthropic_api_key: str | None = None
    openai_api_key: str | None = None
    gemini_api_key: str | None = None
    openrouter_api_key: str | None = None
    groq_api_key: str | None = None


async def _ensure_admin(conn: asyncpg.Connection, company_id: UUID, account_id: UUID) -> None:
    role = await conn.fetchval(
        "SELECT role FROM company_members WHERE company_id=$1 AND account_id=$2",
        company_id, account_id,
    )
    if role is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "company not found")
    if role not in ("owner", "admin"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "owner/admin only")


@router.get("/credentials", response_model=CredentialsStatus)
async def get_credentials(company_id: UUID, account_id: CurrentAccount):
    async with acquire() as conn:
        await _ensure_admin(conn, company_id, account_id)
    s = await credentials.get_credentials_status(company_id)
    return CredentialsStatus(**s)


@router.patch("/credentials", response_model=CredentialsStatus)
async def patch_credentials(
    company_id: UUID, body: CredentialsUpdate, account_id: CurrentAccount,
):
    """Partial update. Empty string clears a key; omitted field is
    left untouched. The plaintext from the request is encrypted at the
    storage layer — nothing is logged or echoed back."""
    async with acquire() as conn:
        await _ensure_admin(conn, company_id, account_id)

    # Translate the Pydantic shape (where None = "not sent") into the
    # storage layer's UNCHANGED sentinel, with empty string meaning
    # "clear". This is the canonical pattern for partial updates on a
    # field that has a real None semantic.
    raw = body.model_dump(exclude_unset=True)
    kwargs: dict = {}
    for k, v in raw.items():
        if k == "deriv_environment":
            kwargs[k] = v
            continue
        # Empty string → clear (encrypt(None) returns NULL).
        kwargs[k] = None if v == "" else v
    await credentials.set_credentials(company_id, **kwargs)

    # If the caller changed anything Deriv-related, ping the gateway to
    # rebuild its client for this company. Fire-and-forget — if NATS is
    # down or the gateway misses it, the next trade will lazy-create.
    if any(k in raw for k in ("deriv_token_demo", "deriv_token_real", "deriv_environment")):
        nc = bus.nc()
        if nc is not None:
            try:
                await nc.publish(f"deriv.warm.{company_id}", b"")
            except Exception:
                log.warning("warm publish failed", exc_info=True)

    s = await credentials.get_credentials_status(company_id)
    return CredentialsStatus(**s)
