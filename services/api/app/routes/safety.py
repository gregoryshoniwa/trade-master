"""Kill switch + safety state per company (PLAN §22).

Owner/admin can flip the kill switch by hand here; the same column is also
written by the circuit-breaker background task in app.safety. Reads are
open to any company member.
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

import asyncpg
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from app.auth import CurrentAccount
from app.db import acquire

router = APIRouter(prefix="/companies/{company_id}", tags=["safety"])


class SweepRecord(BaseModel):
    id: UUID
    agent_name: str | None
    amount_usd: float
    window_realized_pnl_usd: float
    allocation_usd: float
    reason: str
    created_at: datetime


class CoolingOffAgent(BaseModel):
    agent_id: UUID
    agent_name: str
    cooling_off_until: datetime
    streak_at_trigger: int


class SafetyState(BaseModel):
    kill_switch_active: bool
    kill_switch_reason: str | None
    kill_switch_at: datetime | None
    daily_loss_limit_usd: float | None
    today_realized_pnl_usd: float
    # Profit sweep + cooling-off — added so the dashboard can show how
    # much has been moved into insurance and which agents are paused.
    insurance_balance_usd: float
    recent_sweeps: list[SweepRecord]
    cooling_off_agents: list[CoolingOffAgent]


class KillSwitchRequest(BaseModel):
    active: bool
    reason: str | None = Field(default=None, max_length=200)


class LossLimitRequest(BaseModel):
    daily_loss_limit_usd: float | None = Field(default=None, ge=0)


async def _ensure_member(conn: asyncpg.Connection, company_id: UUID, account_id: UUID) -> str:
    role = await conn.fetchval(
        "SELECT role FROM company_members WHERE company_id=$1 AND account_id=$2",
        company_id, account_id,
    )
    if role is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "company not found")
    return role


def _ensure_admin(role: str) -> None:
    if role not in ("owner", "admin"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "owner/admin only")


@router.get("/safety", response_model=SafetyState)
async def get_safety(company_id: UUID, account_id: CurrentAccount):
    async with acquire() as conn:
        await _ensure_member(conn, company_id, account_id)
        row = await conn.fetchrow(
            """
            SELECT c.kill_switch_active, c.kill_switch_reason, c.kill_switch_at,
                   c.daily_loss_limit_usd, c.insurance_balance_usd,
                   COALESCE((
                       SELECT sum(pnl_usd) FROM trade_postmortems
                       WHERE company_id = c.id
                         AND generated_at >= date_trunc('day', now())
                   ), 0) AS today_pnl
            FROM companies c
            WHERE c.id = $1
            """,
            company_id,
        )
        if row is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "company not found")

        sweeps = await conn.fetch(
            """
            SELECT s.id, s.amount_usd, s.window_realized_pnl_usd,
                   s.allocation_usd, s.reason, s.created_at,
                   a.name AS agent_name
            FROM profit_sweeps s
            LEFT JOIN agents a ON a.id = s.agent_id
            WHERE s.company_id = $1
            ORDER BY s.created_at DESC
            LIMIT 20
            """,
            company_id,
        )
        cooling = await conn.fetch(
            """
            SELECT id, name, cooling_off_until,
                   cooling_off_loss_streak AS streak
            FROM agents
            WHERE company_id = $1
              AND cooling_off_until IS NOT NULL
              AND cooling_off_until > now()
            ORDER BY cooling_off_until
            """,
            company_id,
        )

    return SafetyState(
        kill_switch_active=row["kill_switch_active"],
        kill_switch_reason=row["kill_switch_reason"],
        kill_switch_at=row["kill_switch_at"],
        daily_loss_limit_usd=float(row["daily_loss_limit_usd"]) if row["daily_loss_limit_usd"] is not None else None,
        today_realized_pnl_usd=float(row["today_pnl"]),
        insurance_balance_usd=float(row["insurance_balance_usd"] or 0.0),
        recent_sweeps=[
            SweepRecord(
                id=s["id"], agent_name=s["agent_name"],
                amount_usd=float(s["amount_usd"]),
                window_realized_pnl_usd=float(s["window_realized_pnl_usd"]),
                allocation_usd=float(s["allocation_usd"]),
                reason=s["reason"], created_at=s["created_at"],
            ) for s in sweeps
        ],
        cooling_off_agents=[
            CoolingOffAgent(
                agent_id=c["id"], agent_name=c["name"],
                cooling_off_until=c["cooling_off_until"],
                streak_at_trigger=int(c["streak"] or 0),
            ) for c in cooling
        ],
    )


@router.post("/kill-switch", response_model=SafetyState)
async def set_kill_switch(
    company_id: UUID, body: KillSwitchRequest, account_id: CurrentAccount,
):
    async with acquire() as conn:
        role = await _ensure_member(conn, company_id, account_id)
        _ensure_admin(role)
        if body.active:
            await conn.execute(
                """
                UPDATE companies
                SET kill_switch_active = TRUE,
                    kill_switch_reason = $2,
                    kill_switch_at = now()
                WHERE id = $1
                """,
                company_id, body.reason or "manual: by admin",
            )
        else:
            await conn.execute(
                """
                UPDATE companies
                SET kill_switch_active = FALSE,
                    kill_switch_reason = NULL,
                    kill_switch_at = NULL
                WHERE id = $1
                """,
                company_id,
            )
    return await get_safety(company_id, account_id)


@router.put("/safety/loss-limit", response_model=SafetyState)
async def set_loss_limit(
    company_id: UUID, body: LossLimitRequest, account_id: CurrentAccount,
):
    async with acquire() as conn:
        role = await _ensure_member(conn, company_id, account_id)
        _ensure_admin(role)
        await conn.execute(
            "UPDATE companies SET daily_loss_limit_usd = $2 WHERE id = $1",
            company_id, body.daily_loss_limit_usd,
        )
    return await get_safety(company_id, account_id)
