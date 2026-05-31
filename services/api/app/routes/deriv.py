"""Deriv read-only state — live balance + historical transaction statement."""

from __future__ import annotations

import json
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel

from app import bus
from app import deriv as deriv_cache
from app.auth import CurrentCompanyId

router = APIRouter(prefix="/deriv", tags=["deriv"])


class Balance(BaseModel):
    loginid: str | None = None
    currency: str = "USD"
    balance: float = 0.0
    is_virtual: bool = True
    available: bool = False


class StatementTransaction(BaseModel):
    transaction_id: int
    reference_id: int = 0
    action_type: str
    amount: float
    balance_after: float
    transaction_time: int
    longcode: str | None = None
    contract_id: int = 0
    symbol: str | None = None


class Statement(BaseModel):
    count: int
    transactions: list[StatementTransaction]


@router.get("/balance", response_model=Balance)
async def get_balance(company_id: CurrentCompanyId):
    """Latest broker balance for the caller's active company. Populated
    by `deriv.balance.{company_id}` pushes from the gateway; returns
    `available=false` until the gateway has placed the first poll for
    this company.

    Cold-start: if we have no cached balance, publish a `deriv.warm.{cid}`
    signal so the gateway lazily creates its per-company client and
    starts polling. The next `GET /balance` (5s away on the web poller)
    will find a snapshot. Without this nudge, balance only shows up
    after the company places its first trade or saves credentials —
    bad UX for an existing company on first dashboard load."""
    state = deriv_cache.latest(company_id)
    if state is None:
        nc = bus.nc()
        if nc is not None:
            try:
                await nc.publish(f"deriv.warm.{company_id}", b"")
            except Exception:
                pass
        return Balance(available=False)
    return Balance(
        loginid=state.get("loginid"),
        currency=state.get("currency") or "USD",
        balance=float(state.get("balance") or 0.0),
        is_virtual=bool(state.get("is_virtual")),
        available=True,
    )


@router.get("/statement", response_model=Statement)
async def get_statement(
    company_id: CurrentCompanyId,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    offset: Annotated[int, Query(ge=0, le=10_000)] = 0,
):
    """Authoritative broker-side transaction history for the caller's
    active company. Routed via NATS to the gateway (which holds the
    authorized Deriv session for that company) — request/reply so the
    api doesn't need its own Deriv connection."""
    nc = bus.nc()
    if nc is None:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "nats unavailable")
    req = json.dumps({"limit": limit, "offset": offset}).encode()
    subject = f"deriv.statement.req.{company_id}"
    try:
        resp = await nc.request(subject, req, timeout=25.0)
    except Exception as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"gateway request failed: {e}") from e
    try:
        body = json.loads(resp.data)
    except Exception as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"gateway returned bad json: {e}") from e
    if "error" in body:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"deriv: {body['error']}")
    txs = body.get("transactions") or []
    return Statement(count=int(body.get("count") or len(txs)), transactions=txs)
