"""TradeIntent CRUD: list pending approvals, approve/reject, list recent."""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

import asyncpg
from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field

from app import bus
from app.auth import CurrentAccount
from app.db import acquire

log = logging.getLogger("trademaster.approvals")

router = APIRouter(prefix="/companies/{company_id}", tags=["approvals"])

WRITE_ROLES = {"owner", "admin", "trader"}


# ───────────────────────── schemas ──────────────────────────


class TradeIntent(BaseModel):
    id: UUID
    client_uuid: UUID
    company_id: UUID
    agent_id: UUID
    agent_name: str
    asset: str
    contract_type: str
    direction: str
    stake_usd: float
    multiplier: int | None
    duration_secs: int
    entry_price: float
    stop_loss: float | None
    take_profit: float | None
    source_model: str
    source_asof_ts: datetime
    confidence: float
    expected_payoff_ratio: float | None
    expected_value_usd: float | None
    rationale: str
    status: str
    risk_verdict: dict | None
    user_decision_by: UUID | None
    user_decision_at: datetime | None
    user_decision_reason: str | None
    expires_at: datetime | None
    executed_at: datetime | None
    broker_contract_id: str | None
    buy_price_usd: float | None
    longcode: str | None
    realized_pnl_usd: float | None
    exit_reason: str | None
    closed_at: datetime | None
    execution_error: str | None
    created_at: datetime
    updated_at: datetime


class TradeIntentList(BaseModel):
    intents: list[TradeIntent]


class ApprovalAction(BaseModel):
    reason: str | None = Field(default=None, max_length=200)


# ───────────────────────── helpers ──────────────────────────


async def _ensure_member(conn: asyncpg.Connection, company_id: UUID, account_id: UUID) -> str:
    role = await conn.fetchval(
        "SELECT role FROM company_members WHERE company_id=$1 AND account_id=$2",
        company_id, account_id,
    )
    if role is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "company not found")
    return role


def _row(r: asyncpg.Record) -> TradeIntent:
    import json
    rv = r["risk_verdict"]
    if isinstance(rv, str):
        rv = json.loads(rv)
    return TradeIntent(
        id=r["id"],
        client_uuid=r["client_uuid"],
        company_id=r["company_id"],
        agent_id=r["agent_id"],
        agent_name=r["agent_name"],
        asset=r["asset"],
        contract_type=r["contract_type"],
        direction=r["direction"],
        stake_usd=float(r["stake_usd"]),
        multiplier=r["multiplier"],
        duration_secs=r["duration_secs"],
        entry_price=float(r["entry_price"]),
        stop_loss=float(r["stop_loss"]) if r["stop_loss"] is not None else None,
        take_profit=float(r["take_profit"]) if r["take_profit"] is not None else None,
        source_model=r["source_model"],
        source_asof_ts=r["source_asof_ts"],
        confidence=float(r["confidence"]),
        expected_payoff_ratio=float(r["expected_payoff_ratio"]) if r["expected_payoff_ratio"] is not None else None,
        expected_value_usd=float(r["expected_value_usd"]) if r["expected_value_usd"] is not None else None,
        rationale=r["rationale"],
        status=r["status"],
        risk_verdict=rv,
        user_decision_by=r["user_decision_by"],
        user_decision_at=r["user_decision_at"],
        user_decision_reason=r["user_decision_reason"],
        expires_at=r["expires_at"],
        executed_at=r["executed_at"],
        broker_contract_id=r["broker_contract_id"],
        buy_price_usd=float(r["buy_price_usd"]) if r["buy_price_usd"] is not None else None,
        longcode=r["longcode"],
        realized_pnl_usd=float(r["realized_pnl_usd"]) if r["realized_pnl_usd"] is not None else None,
        exit_reason=r["exit_reason"],
        closed_at=r["closed_at"],
        execution_error=r["execution_error"],
        created_at=r["created_at"],
        updated_at=r["updated_at"],
    )


# ───────────────────────── routes ──────────────────────────


@router.get("/approvals", response_model=TradeIntentList)
async def list_pending_approvals(
    company_id: UUID,
    account_id: CurrentAccount,
):
    """Pending-approval intents only, ordered by expires_at ascending so
    the closest-to-timeout shows up first."""
    async with acquire() as conn:
        await _ensure_member(conn, company_id, account_id)
        # Expire any past-due intents so they drop off the list.
        await conn.execute(
            """
            UPDATE trade_intents
            SET status = 'expired'
            WHERE company_id = $1
              AND status = 'pending_approval'
              AND expires_at IS NOT NULL
              AND expires_at <= now()
            """,
            company_id,
        )
        rows = await conn.fetch(
            """
            SELECT i.*, a.name AS agent_name
            FROM trade_intents i
            JOIN agents a ON a.id = i.agent_id
            WHERE i.company_id = $1
              AND i.status = 'pending_approval'
            ORDER BY i.expires_at ASC NULLS LAST, i.created_at ASC
            """,
            company_id,
        )
    return TradeIntentList(intents=[_row(r) for r in rows])


@router.get("/intents", response_model=TradeIntentList)
async def list_intents(
    company_id: UUID,
    account_id: CurrentAccount,
    status_filter: Annotated[Literal[
        "all", "open", "pending_approval", "approved", "auto_approved",
        "rejected_by_risk", "rejected_by_user", "expired",
        "executed", "failed_execution"
    ], Query(alias="status")] = "all",
    limit: Annotated[int, Query(ge=1, le=500)] = 50,
):
    """Recent intents — useful for the audit/feed view.

    `status=open` is a convenience for "executed but not closed yet" — the
    dashboard's agents rail uses it so a position opened yesterday still
    surfaces today, instead of getting buried under the more-recent feed
    of approvals/rejections. The default `all` mirrors what /history wants."""
    async with acquire() as conn:
        await _ensure_member(conn, company_id, account_id)
        if status_filter == "all":
            rows = await conn.fetch(
                """
                SELECT i.*, a.name AS agent_name
                FROM trade_intents i
                JOIN agents a ON a.id = i.agent_id
                WHERE i.company_id = $1
                ORDER BY i.created_at DESC
                LIMIT $2
                """,
                company_id, limit,
            )
        elif status_filter == "open":
            rows = await conn.fetch(
                """
                SELECT i.*, a.name AS agent_name
                FROM trade_intents i
                JOIN agents a ON a.id = i.agent_id
                WHERE i.company_id = $1
                  AND i.status = 'executed'
                  AND i.closed_at IS NULL
                ORDER BY i.executed_at DESC NULLS LAST, i.created_at DESC
                LIMIT $2
                """,
                company_id, limit,
            )
        else:
            rows = await conn.fetch(
                """
                SELECT i.*, a.name AS agent_name
                FROM trade_intents i
                JOIN agents a ON a.id = i.agent_id
                WHERE i.company_id = $1 AND i.status = $2
                ORDER BY i.created_at DESC
                LIMIT $3
                """,
                company_id, status_filter, limit,
            )
    return TradeIntentList(intents=[_row(r) for r in rows])


@router.post("/approvals/{intent_id}/approve", response_model=TradeIntent)
async def approve_intent(
    company_id: UUID, intent_id: UUID,
    body: ApprovalAction, account_id: CurrentAccount,
):
    async with acquire() as conn:
        async with conn.transaction():
            role = await _ensure_member(conn, company_id, account_id)
            if role not in WRITE_ROLES:
                raise HTTPException(status.HTTP_403_FORBIDDEN, "insufficient role")
            updated = await conn.execute(
                """
                UPDATE trade_intents
                SET status = 'approved',
                    user_decision_by = $1,
                    user_decision_at = now(),
                    user_decision_reason = $2
                WHERE id = $3
                  AND company_id = $4
                  AND status = 'pending_approval'
                  AND (expires_at IS NULL OR expires_at > now())
                """,
                account_id, body.reason, intent_id, company_id,
            )
            if updated.endswith(" 0"):
                raise HTTPException(
                    status.HTTP_409_CONFLICT,
                    "intent not pending (already decided or expired)",
                )
            # Hand off to the order router (inside the txn so we only publish
            # if the approve actually took).
            await bus.publish_approved_intent(conn, intent_id)
            full = await conn.fetchrow(
                """
                SELECT i.*, a.name AS agent_name
                FROM trade_intents i
                JOIN agents a ON a.id = i.agent_id
                WHERE i.id = $1
                """,
                intent_id,
            )
    return _row(full)


class CloseResult(BaseModel):
    intent_id: UUID
    contract_id: int
    sold_for_usd: float
    realized_pnl_usd: float
    balance_after_usd: float


@router.post("/intents/{intent_id}/close", response_model=CloseResult)
async def close_intent(
    company_id: UUID, intent_id: UUID, account_id: CurrentAccount,
):
    """Manual close of an open position. RPCs the gateway's `deriv.sell.req`,
    writes the close back into trade_intents the same way the broker-push
    path does, and returns the broker's settlement numbers.

    Idempotent: a second call on a closed intent returns 409 (the
    closed_at IS NULL guard in execution._on_closed also prevents
    double-stamping if a broker push races us)."""
    async with acquire() as conn:
        role = await _ensure_member(conn, company_id, account_id)
        if role not in WRITE_ROLES:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "insufficient role")
        row = await conn.fetchrow(
            """
            SELECT id, broker_contract_id, buy_price_usd, closed_at, status
            FROM trade_intents
            WHERE id = $1 AND company_id = $2
            """,
            intent_id, company_id,
        )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "intent not found")
    if row["closed_at"] is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "intent already closed")
    if row["status"] != "executed":
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"intent status is {row['status']}; only executed intents can be closed",
        )
    if not row["broker_contract_id"]:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "no broker_contract_id on intent (was it actually executed?)",
        )

    try:
        contract_id = int(row["broker_contract_id"])
    except (TypeError, ValueError):
        raise HTTPException(
            status.HTTP_409_CONFLICT, "broker_contract_id is not numeric",
        )

    nc = bus.nc()
    if nc is None:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "trade bus not connected",
        )

    payload = json.dumps({"contract_id": contract_id, "price": 0}).encode()
    try:
        reply = await nc.request("deriv.sell.req", payload, timeout=25)
    except asyncio.TimeoutError:
        raise HTTPException(status.HTTP_504_GATEWAY_TIMEOUT, "sell timed out")
    try:
        result = json.loads(reply.data)
    except Exception:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "malformed sell reply")
    if "error" in result:
        # Surface Deriv's reason verbatim — e.g. "ContractAlreadySold" tells
        # the user the broker already settled while they were clicking.
        raise HTTPException(status.HTTP_409_CONFLICT, f"deriv: {result['error']}")

    sold_for = float(result.get("sold_for") or 0.0)
    balance_after = float(result.get("balance_after") or 0.0)
    realized = round(sold_for - float(row["buy_price_usd"] or 0.0), 2)

    # Apply the close in this request so the row disappears on the very
    # next dashboard poll. The `closed_at IS NULL` guard makes this
    # idempotent: if the broker's own push raced ahead, our UPDATE is a
    # 0-row no-op and we skip the postmortem trigger (the consumer will
    # have fired it). If we win, we trigger it ourselves.
    from app import postmortem  # local import — avoids a cycle on startup
    async with acquire() as conn:
        upd = await conn.execute(
            """
            UPDATE trade_intents
            SET realized_pnl_usd = $2,
                exit_reason = 'user_close',
                closed_at = now()
            WHERE id = $1 AND closed_at IS NULL
            """,
            intent_id, realized,
        )
    we_closed = not upd.endswith(" 0")
    if we_closed:
        asyncio.create_task(postmortem.generate(intent_id))
    # Still publish — other listeners (safety monitor, etc.) subscribe to
    # trades.closed.>; they'd otherwise miss user closes entirely.
    close_ev = {
        "intent_id": str(intent_id),
        "company_id": str(company_id),
        "contract_id": contract_id,
        "realized_pnl_usd": realized,
        "exit_reason": "user_close",
        "status": "sold",
    }
    try:
        await nc.publish(
            f"trades.closed.{company_id}", json.dumps(close_ev).encode(),
        )
    except Exception:
        log.exception("publish manual-close event failed")

    return CloseResult(
        intent_id=intent_id,
        contract_id=contract_id,
        sold_for_usd=sold_for,
        realized_pnl_usd=realized,
        balance_after_usd=balance_after,
    )


@router.post("/approvals/{intent_id}/reject", response_model=TradeIntent)
async def reject_intent(
    company_id: UUID, intent_id: UUID,
    body: ApprovalAction, account_id: CurrentAccount,
):
    async with acquire() as conn:
        async with conn.transaction():
            role = await _ensure_member(conn, company_id, account_id)
            if role not in WRITE_ROLES:
                raise HTTPException(status.HTTP_403_FORBIDDEN, "insufficient role")
            updated = await conn.execute(
                """
                UPDATE trade_intents
                SET status = 'rejected_by_user',
                    user_decision_by = $1,
                    user_decision_at = now(),
                    user_decision_reason = $2
                WHERE id = $3
                  AND company_id = $4
                  AND status = 'pending_approval'
                """,
                account_id, body.reason, intent_id, company_id,
            )
            if updated.endswith(" 0"):
                raise HTTPException(
                    status.HTTP_409_CONFLICT,
                    "intent not pending (already decided or expired)",
                )
            full = await conn.fetchrow(
                """
                SELECT i.*, a.name AS agent_name
                FROM trade_intents i
                JOIN agents a ON a.id = i.agent_id
                WHERE i.id = $1
                """,
                intent_id,
            )
    return _row(full)
