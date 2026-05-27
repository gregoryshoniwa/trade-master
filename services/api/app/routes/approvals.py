"""TradeIntent CRUD: list pending approvals, approve/reject, list recent."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

import asyncpg
from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field

from app import bus
from app.auth import CurrentAccount
from app.db import acquire

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
        "all", "pending_approval", "approved", "auto_approved",
        "rejected_by_risk", "rejected_by_user", "expired",
        "executed", "failed_execution"
    ], Query(alias="status")] = "all",
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
):
    """Recent intents — useful for the audit/feed view."""
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
