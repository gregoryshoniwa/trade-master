"""CEO / operator manual trades.

POST /companies/{cid}/trades/quick

A single round-trip endpoint that the dashboard's "CEO Trades" panel
calls when the human wants to take a trade directly — bypassing the
agent decision loop and the approvals queue.

Mechanically: we create a `trade_intent` row with `status='auto_approved'`
attributed to the company's manager agent (because `agent_id` is NOT
NULL in the schema and CEO is not an agent). The entry_context tags
the trade as CEO-initiated so reports can filter it out of the agent
attribution math. The intent is published to `trades.approved.{cid}`
immediately so the gateway routes it to the broker.

The risk agent still gets to run — the CEO can shoot themselves in
the foot, but only within the deterministic risk envelope (drawdown
caps, concurrency limits, kill switch). That's the whole point of the
risk agent: it's the floor under both LLMs AND humans.

The Settings + tier checks aren't applied here — the assumption is
that anyone with company write-role permission can place trades
on their own account.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Annotated, Literal
from uuid import UUID

import asyncpg
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from app import bus
from app.auth import CurrentAccount
from app.db import acquire

log = logging.getLogger("trademaster.manual_trades")

router = APIRouter(prefix="/companies/{company_id}/trades", tags=["trades"])

WRITE_ROLES = {"owner", "admin", "trader"}


class QuickTradeIn(BaseModel):
    asset: str
    direction: Literal["up", "down"]
    stake_usd: Annotated[float, Field(gt=0, le=10_000)]
    # Optional duration override (seconds). Defaults to 60s — the
    # shortest "scalp-and-see" interval that makes sense for the
    # dashboard's tap-to-trade flow.
    duration_secs: Annotated[int, Field(ge=15, le=86_400)] = 60
    reason: str = "CEO trade from dashboard"


class QuickTradeOut(BaseModel):
    intent_id: UUID
    asset: str
    direction: str
    contract_type: str
    stake_usd: float
    duration_secs: int
    entry_price: float
    status: str


async def _ensure_member(conn: asyncpg.Connection, company_id: UUID, account_id: UUID) -> str:
    role = await conn.fetchval(
        "SELECT role FROM company_members WHERE company_id=$1 AND account_id=$2",
        company_id, account_id,
    )
    if role is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "company not found")
    return role


@router.post("/quick", response_model=QuickTradeOut)
async def place_quick_trade(
    company_id: UUID, account_id: CurrentAccount, body: QuickTradeIn,
):
    """One-shot manual trade — create + auto-approve + publish.

    Risk agent still runs. If it rejects, the response is 409 with the
    rejection reason; nothing reaches the broker."""
    # Lazy imports to avoid circulars at module load time (these modules
    # in turn import bus and db).
    from app.contracts import pick_for_direction
    from app.decision_loop import (
        DEFAULT_STOP_PCT, DEFAULT_MULTIPLIER, SYMBOL_MULTIPLIER,
    )
    from app.ohlc import get_candles
    from app.risk import evaluate as risk_evaluate

    async with acquire() as conn:
        role = await _ensure_member(conn, company_id, account_id)
        if role not in WRITE_ROLES:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "insufficient role")

        # Pick the company's manager agent as the `agent_id` since the
        # schema requires one. Tag entry_context so attribution can
        # filter these out of the agent's stats later.
        manager = await conn.fetchrow(
            """
            SELECT a.id, a.name, a.min_payoff_ratio, a.target_holding_secs,
                   a.allowed_contract_types,
                   c.current_asset_tier, c.unlocked_contract_types
            FROM agents a
            JOIN companies c ON c.id = a.company_id
            WHERE a.company_id = $1 AND a.role = 'manager'
              AND a.is_active = TRUE
            ORDER BY a.created_at ASC
            LIMIT 1
            """,
            company_id,
        )
        if manager is None:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "no active manager agent — create or activate one to enable CEO trades",
            )

    # Snap current price for entry / risk math.
    candles = await get_candles(body.asset, granularity_sec=60, count=2)
    if not candles:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"no recent ticks for {body.asset} — chart subscription required",
        )
    last_price = float(candles[-1]["close"])

    plugin = pick_for_direction(
        direction=body.direction,
        company_tier=int(manager["current_asset_tier"] or 1),
        company_unlocked=list(manager["unlocked_contract_types"] or []),
        agent_allowed=list(manager["allowed_contract_types"] or []),
    )
    if plugin is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"no contract type available for {body.direction} on this tier",
        )

    payoff = float(manager["min_payoff_ratio"] or 1.5)
    params = plugin.build(
        direction=body.direction,
        proposed_stake_usd=body.stake_usd,
        last_price=last_price,
        stop_pct=DEFAULT_STOP_PCT,
        payoff_ratio=payoff,
        asset=body.asset,
        multiplier_default=SYMBOL_MULTIPLIER.get(body.asset, DEFAULT_MULTIPLIER),
        target_holding_secs=body.duration_secs,
    )
    stop = params.stop_loss if params.stop_loss is not None else last_price

    async with acquire() as conn:
        async with conn.transaction():
            verdict = await risk_evaluate(
                conn,
                company_id=company_id, agent_id=manager["id"],
                asset=body.asset, contract_type=params.contract_type,
                proposed_stake_usd=body.stake_usd,
                # CEO is the signal — there's no model behind a manual
                # trade, so the confidence-floor check is meaningless.
                # Pass 1.0 to satisfy it; the other deterministic gates
                # (drawdown, kill switch, concurrency, calendar
                # blackouts) still apply.
                confidence=1.0,
                stop_loss=stop,
                # Manager has no allocation pool by design; gate against
                # the company's broker balance instead.
                is_ceo_trade=True,
            )
            if not verdict.ok:
                raise HTTPException(
                    status.HTTP_409_CONFLICT,
                    f"risk rejected: {verdict.reason or 'no detail'}",
                )
            applied_stake = verdict.applied_stake_usd or body.stake_usd

            entry_context = {
                "agent": {"name": manager["name"]},
                "forecast": None,
                "sizing": {"method": "ceo_manual", "proposed_stake_usd": body.stake_usd},
                "selection_mode": {
                    "mode": "ceo_manual", "accepted": True,
                    "reason": body.reason,
                    "placed_by_account_id": str(account_id),
                },
                "strategy": None,
            }
            rationale = f"CEO manual trade by user {account_id}: {body.reason}"
            asof_ts = datetime.now(tz=timezone.utc)
            expires_at = await conn.fetchval(
                "SELECT now() + interval '60 seconds'",
            )

            intent_id = await conn.fetchval(
                """
                INSERT INTO trade_intents (
                    company_id, agent_id,
                    asset, contract_type, direction,
                    stake_usd, multiplier, duration_secs,
                    entry_price, stop_loss, take_profit,
                    source_model, source_asof_ts, confidence,
                    expected_payoff_ratio, expected_value_usd, rationale,
                    status, risk_verdict, expires_at, entry_context
                )
                VALUES ($1, $2, $3, $4, $5,
                        $6, $7, $8,
                        $9, $10, $11,
                        $12, $13, $14,
                        $15, $16, $17,
                        $18, $19::jsonb, $20, $21::jsonb)
                RETURNING id
                """,
                company_id, manager["id"],
                body.asset, params.contract_type, body.direction,
                applied_stake, params.multiplier, body.duration_secs,
                last_price, stop, params.take_profit,
                "ceo_manual", asof_ts, 1.0,
                payoff, 0.0, rationale,
                "auto_approved", json.dumps(verdict.as_jsonb()), expires_at,
                json.dumps(entry_context),
            )
            # Publish straight to gateway — same path autonomous-mode
            # intents take.
            await bus.publish_approved_intent(conn, intent_id)

    log.info(
        "ceo manual trade · %s %s %s stake=%.2f → auto_approved (intent=%s)",
        manager["name"], body.asset, params.contract_type, applied_stake, intent_id,
    )
    return QuickTradeOut(
        intent_id=intent_id,
        asset=body.asset,
        direction=body.direction,
        contract_type=params.contract_type,
        stake_usd=float(applied_stake),
        duration_secs=body.duration_secs,
        entry_price=last_price,
        status="auto_approved",
    )
