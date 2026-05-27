"""Tools the chat agent can call.

Phase 1 — read-only stubs. As trading flows go live the placeholders below
are replaced with real Postgres queries against the trades / fills tables
without changing the LLM-facing schema.
"""

from __future__ import annotations

import json
import logging
from typing import Any
from uuid import UUID

from app.db import acquire
from app.llm import ToolDef
from app.personalities import PRESETS

log = logging.getLogger("trademaster.tools")


# ───────────────────────── tool schemas ──────────────────────────


def available_tools() -> list[ToolDef]:
    return [
        ToolDef(
            name="get_pnl",
            description=(
                "Return the current P&L for the active Company in USD over a "
                "timeframe. In Phase 1 paper trading this is a placeholder "
                "with synthetic numbers; production wires real trades."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "timeframe": {
                        "type": "string",
                        "enum": ["today", "7d", "30d", "mtd", "all"],
                        "description": "Reporting window.",
                    },
                },
                "required": ["timeframe"],
            },
        ),
        ToolDef(
            name="get_my_personality",
            description=(
                "Return the calling agent's full personality + trade-selection "
                "configuration. Useful when the user asks what the agent's "
                "settings are."
            ),
            parameters={
                "type": "object",
                "properties": {},
            },
        ),
        ToolDef(
            name="get_recent_decisions",
            description=(
                "Return the agent's most recent trade decisions and outcomes "
                "(if any). Phase 1 returns an empty list until trading flows go live."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "limit": {
                        "type": "integer",
                        "minimum": 1,
                        "maximum": 50,
                        "description": "How many decisions to return.",
                    },
                },
            },
        ),
        ToolDef(
            name="get_company_tier_status",
            description=(
                "Return the calling Company's current asset tier and which "
                "contract types are unlocked, plus what's needed to unlock the "
                "next tier."
            ),
            parameters={"type": "object", "properties": {}},
        ),
    ]


# ────────────────────────── tool runner ───────────────────────────


class ToolContext:
    """Bundle of identifiers + DB access the tools need to do their job."""

    def __init__(self, *, company_id: UUID, account_id: UUID, agent_id: UUID):
        self.company_id = company_id
        self.account_id = account_id
        self.agent_id = agent_id


async def execute_tool(name: str, args: dict, ctx: ToolContext) -> str:
    """Dispatch by name and return a JSON-encoded result string. We never
    let a tool exception leak to the LLM — return an error envelope so the
    model can apologize."""
    try:
        match name:
            case "get_pnl":
                payload = await _get_pnl(args, ctx)
            case "get_my_personality":
                payload = await _get_my_personality(ctx)
            case "get_recent_decisions":
                payload = await _get_recent_decisions(args, ctx)
            case "get_company_tier_status":
                payload = await _get_company_tier_status(ctx)
            case _:
                payload = {"error": f"unknown tool: {name}"}
    except Exception as e:
        log.exception("tool error name=%s", name)
        payload = {"error": str(e)}
    return json.dumps(payload, default=str)


# ───────────────────────── implementations ──────────────────────────


async def _get_pnl(args: dict, ctx: ToolContext) -> dict[str, Any]:
    # Placeholder until real trades flow. We still scope by the Company so
    # the shape is right when we wire it.
    return {
        "company_id": str(ctx.company_id),
        "timeframe": args.get("timeframe", "today"),
        "pnl_usd": 0.0,
        "currency": "USD",
        "note": (
            "Phase 1 paper trading — no real trades yet. P&L will populate "
            "once execution is enabled."
        ),
    }


async def _get_my_personality(ctx: ToolContext) -> dict[str, Any]:
    async with acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT name, role, personality, trade_selection_mode,
                   kelly_fraction, min_confidence_threshold, min_payoff_ratio,
                   max_trades_per_day, target_holding_secs, trade_mode,
                   strategies, allocated_balance_usd, max_position_size_usd,
                   max_daily_drawdown_pct
            FROM agents
            WHERE id = $1 AND company_id = $2
            """,
            ctx.agent_id, ctx.company_id,
        )
    if row is None:
        return {"error": "agent not found"}
    preset = PRESETS.get(row["personality"])
    return {
        "name": row["name"],
        "role": row["role"],
        "personality": row["personality"],
        "personality_label": preset["label"] if preset else "Custom",
        "personality_icon": preset["icon"] if preset else "✦",
        "trade_selection_mode": row["trade_selection_mode"],
        "kelly_fraction": float(row["kelly_fraction"]),
        "min_confidence_threshold": float(row["min_confidence_threshold"]),
        "min_payoff_ratio": float(row["min_payoff_ratio"]),
        "max_trades_per_day": row["max_trades_per_day"],
        "target_holding_secs": row["target_holding_secs"],
        "trade_mode": row["trade_mode"],
        "strategies": list(row["strategies"]),
        "allocated_balance_usd": float(row["allocated_balance_usd"]),
        "max_position_size_usd": float(row["max_position_size_usd"]),
        "max_daily_drawdown_pct": float(row["max_daily_drawdown_pct"]),
    }


async def _get_recent_decisions(args: dict, ctx: ToolContext) -> dict[str, Any]:
    return {
        "agent_id": str(ctx.agent_id),
        "decisions": [],
        "note": "No trade decisions yet — trading flows go live in Phase 3.",
    }


async def _get_company_tier_status(ctx: ToolContext) -> dict[str, Any]:
    async with acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT name, current_asset_tier, unlocked_contract_types, paper_mode
            FROM companies WHERE id = $1
            """,
            ctx.company_id,
        )
    if row is None:
        return {"error": "company not found"}
    next_tier = row["current_asset_tier"] + 1 if row["current_asset_tier"] < 9 else None
    return {
        "company_name": row["name"],
        "current_tier": row["current_asset_tier"],
        "unlocked_contract_types": list(row["unlocked_contract_types"]),
        "paper_mode": row["paper_mode"],
        "next_tier": next_tier,
        "next_tier_requirement": (
            "30 days at current tier · ≥50 trades · Sharpe ≥ 1.0 · max DD "
            "within limit · WebAuthn confirm"
            if next_tier else None
        ),
    }
