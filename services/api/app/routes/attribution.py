"""Performance attribution (PLAN §3 Phase 3).

Three roll-ups sourced from trade_postmortems — by agent, by forecasting
model, by asset — for a configurable rolling window. The web app at
/attribution renders these as three sorted tables.

Win-rate, average P&L, calibration honesty (Brier-derived score), and
allocation-relative P&L all come from postmortems we already write at trade
close (see app.postmortem.generate).
"""

from __future__ import annotations

from typing import Annotated, Literal
from uuid import UUID

import asyncpg
from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel

from app.auth import CurrentAccount
from app.db import acquire

router = APIRouter(prefix="/companies/{company_id}", tags=["attribution"])


Window = Literal["today", "7d", "30d", "all"]


class AgentAttribution(BaseModel):
    agent_id: str | None
    agent_name: str | None
    trades: int
    wins: int
    losses: int
    win_rate: float
    pnl_usd: float
    best_usd: float
    worst_usd: float
    avg_pnl_usd: float
    avg_calibration: float | None
    allocated_balance_usd: float | None


class ModelAttribution(BaseModel):
    source_model: str
    trades: int
    wins: int
    losses: int
    win_rate: float
    pnl_usd: float
    avg_pnl_usd: float


class AssetAttribution(BaseModel):
    asset: str
    trades: int
    wins: int
    losses: int
    win_rate: float
    pnl_usd: float
    avg_pnl_usd: float


class AttributionSummary(BaseModel):
    window: Window
    trades: int
    pnl_usd: float
    win_rate: float
    by_agent: list[AgentAttribution]
    by_model: list[ModelAttribution]
    by_asset: list[AssetAttribution]


_WINDOW_SQL: dict[Window, str] = {
    "today": "generated_at >= date_trunc('day', now())",
    "7d":    "generated_at >= now() - interval '7 days'",
    "30d":   "generated_at >= now() - interval '30 days'",
    "all":   "TRUE",
}


async def _ensure_member(conn: asyncpg.Connection, company_id: UUID, account_id: UUID) -> str:
    role = await conn.fetchval(
        "SELECT role FROM company_members WHERE company_id=$1 AND account_id=$2",
        company_id, account_id,
    )
    if role is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "company not found")
    return role


@router.get("/attribution", response_model=AttributionSummary)
async def get_attribution(
    company_id: UUID,
    account_id: CurrentAccount,
    window: Annotated[Window, Query()] = "30d",
):
    where = _WINDOW_SQL[window]

    async with acquire() as conn:
        await _ensure_member(conn, company_id, account_id)

        # Top-line summary
        top = await conn.fetchrow(
            f"""
            SELECT count(*) AS trades,
                   COALESCE(sum(pnl_usd), 0) AS pnl,
                   COALESCE(avg((outcome = 'win')::int), 0) AS win_rate
            FROM trade_postmortems
            WHERE company_id = $1 AND {where}
            """,
            company_id,
        )

        # By agent — start from agents (so zero-trade agents still appear)
        # and LEFT JOIN postmortems in the chosen window. Surfaces Kronny /
        # any new agent before its first settled trade.
        agent_rows = await conn.fetch(
            f"""
            SELECT a.id   AS agent_id,
                   a.name AS agent_name,
                   COUNT(p.id)                              AS trades,
                   COUNT(*) FILTER (WHERE p.outcome = 'win')  AS wins,
                   COUNT(*) FILTER (WHERE p.outcome = 'loss') AS losses,
                   COALESCE(sum(p.pnl_usd), 0)              AS pnl,
                   COALESCE(max(p.pnl_usd), 0)              AS best,
                   COALESCE(min(p.pnl_usd), 0)              AS worst,
                   COALESCE(avg(p.pnl_usd), 0)              AS avg_pnl,
                   AVG((p.employee_rating->>'calibration_score')::float) AS avg_calib,
                   a.allocated_balance_usd
            FROM agents a
            LEFT JOIN trade_postmortems p
                   ON p.agent_id = a.id
                  AND p.company_id = a.company_id
                  AND {where}
            WHERE a.company_id = $1
              AND a.role = 'employee'
            GROUP BY a.id, a.name, a.allocated_balance_usd
            -- agents with trades first (sorted by P&L), zero-trade agents at the bottom
            ORDER BY (COUNT(p.id) = 0) ASC, pnl DESC
            """,
            company_id,
        )

        # By forecasting model — read source_model off the joined intent.
        model_rows = await conn.fetch(
            f"""
            SELECT i.source_model,
                   count(*) AS trades,
                   count(*) FILTER (WHERE p.outcome = 'win')  AS wins,
                   count(*) FILTER (WHERE p.outcome = 'loss') AS losses,
                   COALESCE(sum(p.pnl_usd), 0) AS pnl,
                   COALESCE(avg(p.pnl_usd), 0) AS avg_pnl
            FROM trade_postmortems p
            JOIN trade_intents i ON i.id = p.intent_id
            WHERE p.company_id = $1 AND {where}
            GROUP BY i.source_model
            ORDER BY pnl DESC
            """,
            company_id,
        )

        # By asset
        asset_rows = await conn.fetch(
            f"""
            SELECT i.asset,
                   count(*) AS trades,
                   count(*) FILTER (WHERE p.outcome = 'win')  AS wins,
                   count(*) FILTER (WHERE p.outcome = 'loss') AS losses,
                   COALESCE(sum(p.pnl_usd), 0) AS pnl,
                   COALESCE(avg(p.pnl_usd), 0) AS avg_pnl
            FROM trade_postmortems p
            JOIN trade_intents i ON i.id = p.intent_id
            WHERE p.company_id = $1 AND {where}
            GROUP BY i.asset
            ORDER BY pnl DESC
            """,
            company_id,
        )

    def wr(trades: int, wins: int) -> float:
        return (wins / trades) if trades else 0.0

    return AttributionSummary(
        window=window,
        trades=int(top["trades"]),
        pnl_usd=float(top["pnl"]),
        win_rate=float(top["win_rate"]),
        by_agent=[
            AgentAttribution(
                agent_id=str(r["agent_id"]) if r["agent_id"] else None,
                agent_name=r["agent_name"],
                trades=int(r["trades"]),
                wins=int(r["wins"]),
                losses=int(r["losses"]),
                win_rate=wr(int(r["trades"]), int(r["wins"])),
                pnl_usd=float(r["pnl"]),
                best_usd=float(r["best"]),
                worst_usd=float(r["worst"]),
                avg_pnl_usd=float(r["avg_pnl"]),
                avg_calibration=float(r["avg_calib"]) if r["avg_calib"] is not None else None,
                allocated_balance_usd=float(r["allocated_balance_usd"]) if r["allocated_balance_usd"] is not None else None,
            )
            for r in agent_rows
        ],
        by_model=[
            ModelAttribution(
                source_model=r["source_model"],
                trades=int(r["trades"]),
                wins=int(r["wins"]),
                losses=int(r["losses"]),
                win_rate=wr(int(r["trades"]), int(r["wins"])),
                pnl_usd=float(r["pnl"]),
                avg_pnl_usd=float(r["avg_pnl"]),
            )
            for r in model_rows
        ],
        by_asset=[
            AssetAttribution(
                asset=r["asset"],
                trades=int(r["trades"]),
                wins=int(r["wins"]),
                losses=int(r["losses"]),
                win_rate=wr(int(r["trades"]), int(r["wins"])),
                pnl_usd=float(r["pnl"]),
                avg_pnl_usd=float(r["avg_pnl"]),
            )
            for r in asset_rows
        ],
    )
