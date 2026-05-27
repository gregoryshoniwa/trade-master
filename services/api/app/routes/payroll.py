"""GET /api/v1/companies/{cid}/payroll — HR view of agent LLM cost.

For each Agent (active or not) we report:
  - calls in the window
  - input + output tokens
  - actual USD cost spent
  - implied monthly run-rate (= window_cost × 30 / window_days)
  - cloud vs self-hosted classification — the UI calls these
    "freelancer" vs "employee" per the user's framing
"""

from __future__ import annotations

from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel

from app.auth import CurrentAccount
from app.db import acquire
from app.llm import get_model

router = APIRouter(prefix="/companies/{company_id}", tags=["payroll"])


Window = Literal["today", "7d", "30d", "mtd", "all"]


class PayrollRow(BaseModel):
    agent_id: UUID | None
    name: str
    role: str | None
    personality: str | None
    provider: str
    model: str
    model_label: str | None
    category: str | None        # "cloud" | "self_hosted"
    calls: int
    input_tokens: int
    output_tokens: int
    cost_usd: float
    projected_monthly_usd: float


class PayrollSummary(BaseModel):
    window: Window
    days_in_window: float
    total_cost_usd: float
    projected_monthly_usd: float
    rows: list[PayrollRow]


def _window_clause(window: Window) -> tuple[str, float]:
    """Return (SQL WHERE fragment for created_at, days_in_window)."""
    if window == "today":
        return ("u.created_at >= date_trunc('day', now())", 1.0)
    if window == "7d":
        return ("u.created_at >= now() - interval '7 days'", 7.0)
    if window == "30d":
        return ("u.created_at >= now() - interval '30 days'", 30.0)
    if window == "mtd":
        return (
            "u.created_at >= date_trunc('month', now())",
            # Treat the projection as if the user is mid-month — extrapolate
            # daily burn over the elapsed portion of the month.
            None,  # type: ignore[return-value]
        )
    return ("TRUE", 30.0)  # "all" — projection just normalizes to 30 days


@router.get("/payroll", response_model=PayrollSummary)
async def payroll(
    company_id: UUID,
    account_id: CurrentAccount,
    window: Annotated[Window, Query()] = "30d",
):
    async with acquire() as conn:
        role = await conn.fetchval(
            "SELECT role FROM company_members WHERE company_id=$1 AND account_id=$2",
            company_id, account_id,
        )
        if role is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "company not found")

        clause, days = _window_clause(window)
        if window == "mtd":
            # Compute elapsed days this month for the projection denominator.
            elapsed = await conn.fetchval(
                "SELECT GREATEST(0.0001, EXTRACT(EPOCH FROM (now() - date_trunc('month', now())))/86400.0)",
            )
            days = float(elapsed)

        # Outer join from agents → usage so even unused agents show as $0.
        rows = await conn.fetch(
            f"""
            SELECT
                a.id   AS agent_id,
                a.name AS agent_name,
                a.role,
                a.personality,
                a.llm_provider,
                a.llm_model,
                COALESCE(u.calls, 0)          AS calls,
                COALESCE(u.input_tokens, 0)   AS input_tokens,
                COALESCE(u.output_tokens, 0)  AS output_tokens,
                COALESCE(u.cost_usd, 0)       AS cost_usd
            FROM agents a
            LEFT JOIN LATERAL (
                SELECT
                    count(*)                       AS calls,
                    sum(input_tokens)              AS input_tokens,
                    sum(output_tokens)             AS output_tokens,
                    sum(estimated_cost_usd)        AS cost_usd
                FROM llm_usage u
                WHERE u.agent_id = a.id
                  AND u.company_id = $1
                  AND {clause}
            ) u ON TRUE
            WHERE a.company_id = $1
            ORDER BY cost_usd DESC, a.created_at ASC
            """,
            company_id,
        )

        # Also pick up rows whose agent_id is NULL (e.g. mem0 extraction) so
        # we don't lose track of them.
        unattributed = await conn.fetchrow(
            f"""
            SELECT
                count(*)                AS calls,
                sum(input_tokens)       AS input_tokens,
                sum(output_tokens)      AS output_tokens,
                sum(estimated_cost_usd) AS cost_usd
            FROM llm_usage u
            WHERE u.company_id = $1
              AND u.agent_id IS NULL
              AND {clause}
            """,
            company_id,
        )

    out_rows: list[PayrollRow] = []
    total = 0.0

    def _project(cost: float) -> float:
        if days <= 0:
            return 0.0
        return cost * 30.0 / days

    for r in rows:
        m = get_model(r["llm_provider"], r["llm_model"])
        cost = float(r["cost_usd"] or 0.0)
        total += cost
        out_rows.append(PayrollRow(
            agent_id=r["agent_id"],
            name=r["agent_name"],
            role=r["role"],
            personality=r["personality"],
            provider=r["llm_provider"],
            model=r["llm_model"],
            model_label=m.label if m else None,
            category=m.category if m else None,
            calls=int(r["calls"] or 0),
            input_tokens=int(r["input_tokens"] or 0),
            output_tokens=int(r["output_tokens"] or 0),
            cost_usd=cost,
            projected_monthly_usd=_project(cost),
        ))

    if unattributed and (unattributed["calls"] or 0) > 0:
        cost = float(unattributed["cost_usd"] or 0.0)
        total += cost
        out_rows.append(PayrollRow(
            agent_id=None,
            name="Background services",
            role=None,
            personality=None,
            provider="(internal)",
            model="(mem0 + tools)",
            model_label=None,
            category="cloud",
            calls=int(unattributed["calls"] or 0),
            input_tokens=int(unattributed["input_tokens"] or 0),
            output_tokens=int(unattributed["output_tokens"] or 0),
            cost_usd=cost,
            projected_monthly_usd=_project(cost),
        ))

    return PayrollSummary(
        window=window,
        days_in_window=days,
        total_cost_usd=total,
        projected_monthly_usd=_project(total),
        rows=out_rows,
    )
