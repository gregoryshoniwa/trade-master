"""Deriv read-only state — currently just the live account balance."""

from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

from app import deriv as deriv_cache
from app.auth import CurrentAccount

router = APIRouter(prefix="/deriv", tags=["deriv"])


class Balance(BaseModel):
    loginid: str | None = None
    currency: str = "USD"
    balance: float = 0.0
    is_virtual: bool = True
    available: bool = False


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
