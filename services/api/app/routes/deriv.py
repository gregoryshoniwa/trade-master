"""Deriv read-only state — live balance + historical transaction statement."""

from __future__ import annotations

import json
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel

from app import bus
from app import deriv as deriv_cache
from app.auth import CurrentAccount

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
async def get_balance(account_id: CurrentAccount):
    _ = account_id  # auth gate — balance is global Phase-1 state
    state = deriv_cache.latest()
    if state is None:
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
    account_id: CurrentAccount,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    offset: Annotated[int, Query(ge=0, le=10_000)] = 0,
):
    """Authoritative broker-side transaction history. Routed via NATS to the
    gateway (which holds the authorized Deriv session) — request/reply so the
    api doesn't need its own Deriv connection."""
    _ = account_id
    nc = bus.nc()
    if nc is None:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "nats unavailable")
    req = json.dumps({"limit": limit, "offset": offset}).encode()
    try:
        resp = await nc.request("deriv.statement.req", req, timeout=25.0)
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
