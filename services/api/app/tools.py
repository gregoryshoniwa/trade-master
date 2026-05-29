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


# Fields the manager is allowed to change on an employee. Anything that
# touches the broker connection (llm_*, forecasting_model) or the
# employee's character (personality, voice_id) stays off-limits — those
# are CEO concerns, not the manager's.
#
# `allocated_balance_usd` IS included here: the CEO often instructs the
# manager during chat (e.g. "cut Kronny's allocation to $50") and the
# manager needs to be able to execute that directly.
MANAGER_ADJUSTABLE_FIELDS = {
    "min_confidence_threshold": (float, 0.0, 1.0),
    "kelly_fraction":           (float, 0.0, 1.0),
    "min_payoff_ratio":         (float, 1.0, 10.0),
    "max_position_size_usd":    (float, 1.0, 10000.0),
    "max_trades_per_day":       (int,   1,   2000),
    "target_holding_secs":      (int,   30,  86400),
    "allocated_balance_usd":    (float, 0.0, 100000.0),
}


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

        # ── Manager-only tools (role check inside execute_tool) ─────────
        ToolDef(
            name="get_team_status",
            description=(
                "MANAGER ONLY. Returns a digest of every employee on this "
                "company: name, model, current params, live P&L and hit-rate "
                "over the last 7d, paused/cooling-off state. Use this to "
                "decide who needs an adjustment."
            ),
            parameters={"type": "object", "properties": {}},
        ),
        ToolDef(
            name="adjust_employee",
            description=(
                "MANAGER ONLY. Update one numeric parameter on an employee. "
                f"Allowed fields: {', '.join(MANAGER_ADJUSTABLE_FIELDS)}. "
                "Always include a 1-sentence `reason` so the audit trail "
                "explains why."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "employee_agent_id": {
                        "type": "string",
                        "description": "UUID of the employee to adjust.",
                    },
                    "field": {
                        "type": "string",
                        "enum": list(MANAGER_ADJUSTABLE_FIELDS),
                    },
                    "value": {
                        "type": "number",
                        "description": "New value. Will be range-checked.",
                    },
                    "reason": {
                        "type": "string",
                        "description": "Why you're making this change.",
                    },
                },
                "required": ["employee_agent_id", "field", "value", "reason"],
            },
        ),
        ToolDef(
            name="pause_employee",
            description=(
                "MANAGER ONLY. Pause an employee so it stops issuing new "
                "intents. Existing open positions stay open. Use when an "
                "agent is bleeding and you want to stop the bleeding while "
                "you investigate."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "employee_agent_id": {"type": "string"},
                    "reason": {"type": "string"},
                },
                "required": ["employee_agent_id", "reason"],
            },
        ),
        ToolDef(
            name="resume_employee",
            description=(
                "MANAGER ONLY. Clear an employee's pause so it can issue "
                "new intents again."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "employee_agent_id": {"type": "string"},
                    "reason": {"type": "string"},
                },
                "required": ["employee_agent_id", "reason"],
            },
        ),
        ToolDef(
            name="hold_meeting_with_employee",
            description=(
                "MANAGER ONLY. Hold a focused 1:1 meeting with a specific "
                "employee — a deeper, single-employee conversation that "
                "writes its own transcript and lets you take one targeted "
                "action. Call this when a team review surfaced one employee "
                "that deserves more attention than the standard pass."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "employee_agent_id": {
                        "type": "string",
                        "description": "UUID of the employee to meet with.",
                    },
                    "agenda": {
                        "type": "string",
                        "description": "One sentence on what you want to discuss.",
                    },
                },
                "required": ["employee_agent_id", "agenda"],
            },
        ),

        # ── Company-level goals (CEO ⇄ manager loop) ────────────────────
        ToolDef(
            name="get_company_goals",
            description=(
                "Return the calling Company's CEO-set goals — currently "
                "the daily profit target (USD) if any, plus paper-mode "
                "status. Read this at the start of every review so your "
                "decisions track the CEO's intent. NULL target means "
                "'no specific target; just don't lose money'."
            ),
            parameters={"type": "object", "properties": {}},
        ),
        ToolDef(
            name="set_company_daily_profit_target",
            description=(
                "MANAGER ONLY. Update the Company's daily profit target "
                "in USD. Use this when the CEO instructs you to change "
                "the target during a chat or meeting. Pass null to clear "
                "the target. Always include `reason` so the audit trail "
                "explains the change."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "daily_profit_target_usd": {
                        "type": ["number", "null"],
                        "minimum": 0,
                        "maximum": 100000,
                        "description": "New target in USD, or null to clear.",
                    },
                    "reason": {"type": "string"},
                },
                "required": ["daily_profit_target_usd", "reason"],
            },
        ),

        # ── Economic calendar (PLAN §9) ─────────────────────────────────
        ToolDef(
            name="get_upcoming_economic_events",
            description=(
                "Return upcoming high-impact economic events from the "
                "ingested Forex Factory calendar. Useful for the manager "
                "when sizing risk, and for employees deciding whether "
                "to trade through an event window. Defaults to the next "
                "24 hours and high-impact only — these are the ones that "
                "actually move markets."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "hours_ahead": {
                        "type": "integer", "minimum": 1, "maximum": 168,
                        "description": "How far ahead to look (default 24).",
                    },
                    "impact": {
                        "type": "string",
                        "enum": ["high", "medium", "any"],
                        "description": "Minimum event impact level (default 'high').",
                    },
                    "asset": {
                        "type": "string",
                        "description": "Optional — filter to events affecting this Deriv symbol.",
                    },
                },
            },
        ),

        # ── Employee → Manager messaging ────────────────────────────────
        ToolDef(
            name="request_meeting_with_manager",
            description=(
                "EMPLOYEE ONLY. Drop a request into the manager's queue "
                "asking for a 1:1 — use this when you've noticed "
                "something material the manager should know about (a "
                "loss streak, an asset that's stopped working, a "
                "config you think should change). The manager picks up "
                "pending requests at the next review or in a triggered "
                "1:1; don't expect an immediate response."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "reason": {
                        "type": "string",
                        "description": "1-2 sentences on what you want to discuss.",
                    },
                },
                "required": ["reason"],
            },
        ),

        # ── Web search (gated by per-company config) ────────────────────
        ToolDef(
            name="web_search",
            description=(
                "Search the public web for fresh information — useful when "
                "the user asks about news, a release date, an upcoming event, "
                "or anything outside your training data. The CEO must enable "
                "web search for this company and may restrict which domains "
                "are allowed. There is a small daily quota; spend it on "
                "queries that change the answer."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "The search query — be specific, like 'Fed minutes June 2026 dot plot'.",
                    },
                    "max_results": {
                        "type": "integer",
                        "minimum": 1,
                        "maximum": 10,
                        "description": "How many results to return (default 5).",
                    },
                },
                "required": ["query"],
            },
        ),
    ]


# ────────────────────────── tool runner ───────────────────────────


class ToolContext:
    """Bundle of identifiers + DB access the tools need to do their job."""

    def __init__(self, *, company_id: UUID, account_id: UUID, agent_id: UUID):
        self.company_id = company_id
        self.account_id = account_id
        self.agent_id = agent_id


MANAGER_TOOLS = {
    "get_team_status", "adjust_employee", "pause_employee", "resume_employee",
    "hold_meeting_with_employee", "set_company_daily_profit_target",
}
EMPLOYEE_TOOLS = {"request_meeting_with_manager"}


async def _ensure_employee(ctx: ToolContext) -> str | None:
    """Inverse of `_ensure_manager` — used for employee-only tools."""
    async with acquire() as conn:
        role = await conn.fetchval(
            "SELECT role FROM agents WHERE id = $1 AND company_id = $2",
            ctx.agent_id, ctx.company_id,
        )
    if role != "employee":
        return f"only employee agents can call this tool (caller role: {role})"
    return None


async def _ensure_manager(ctx: ToolContext) -> str | None:
    """Returns None when the caller is a manager, or an error string
    suitable for returning to the LLM otherwise. The tool runner uses
    this once per manager-restricted call so the role check is in one
    place."""
    async with acquire() as conn:
        role = await conn.fetchval(
            "SELECT role FROM agents WHERE id = $1 AND company_id = $2",
            ctx.agent_id, ctx.company_id,
        )
    if role != "manager":
        return f"only manager agents can call this tool (caller role: {role})"
    return None


async def execute_tool(name: str, args: dict, ctx: ToolContext) -> str:
    """Dispatch by name and return a JSON-encoded result string. We never
    let a tool exception leak to the LLM — return an error envelope so the
    model can apologize."""
    try:
        if name in MANAGER_TOOLS:
            denied = await _ensure_manager(ctx)
            if denied is not None:
                return json.dumps({"error": denied})
        if name in EMPLOYEE_TOOLS:
            denied = await _ensure_employee(ctx)
            if denied is not None:
                return json.dumps({"error": denied})
        match name:
            case "get_pnl":
                payload = await _get_pnl(args, ctx)
            case "get_my_personality":
                payload = await _get_my_personality(ctx)
            case "get_recent_decisions":
                payload = await _get_recent_decisions(args, ctx)
            case "get_company_tier_status":
                payload = await _get_company_tier_status(ctx)
            case "get_team_status":
                payload = await _get_team_status(ctx)
            case "adjust_employee":
                payload = await _adjust_employee(args, ctx)
            case "pause_employee":
                payload = await _pause_employee(args, ctx)
            case "resume_employee":
                payload = await _resume_employee(args, ctx)
            case "web_search":
                payload = await _web_search(args, ctx)
            case "hold_meeting_with_employee":
                payload = await _hold_meeting_with_employee(args, ctx)
            case "get_company_goals":
                payload = await _get_company_goals(ctx)
            case "set_company_daily_profit_target":
                payload = await _set_company_daily_profit_target(args, ctx)
            case "get_upcoming_economic_events":
                payload = await _get_upcoming_economic_events(args, ctx)
            case "request_meeting_with_manager":
                payload = await _request_meeting_with_manager(args, ctx)
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


# ─── Manager tools (role-checked via _ensure_manager) ───────────────


async def _get_team_status(ctx: ToolContext) -> dict[str, Any]:
    """Digest the manager LLM uses to decide whether/who to adjust. One
    row per employee on the same company. P&L + hit-rate over the last
    7 days from postmortems; current tunable knobs from agents."""
    async with acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT a.id, a.name, a.forecasting_model,
                   a.min_confidence_threshold, a.kelly_fraction,
                   a.min_payoff_ratio, a.max_position_size_usd,
                   a.max_trades_per_day, a.target_holding_secs,
                   a.allocated_balance_usd, a.allowed_assets,
                   a.is_paused, a.pause_reason,
                   a.cooling_off_until, a.cooling_off_loss_streak,
                   COALESCE(SUM(p.pnl_usd) FILTER (
                     WHERE p.generated_at > now() - interval '7 days'
                   ), 0) AS pnl_7d,
                   COUNT(p.id) FILTER (
                     WHERE p.generated_at > now() - interval '7 days'
                   ) AS n_7d,
                   COUNT(*) FILTER (
                     WHERE p.outcome = 'win'
                       AND p.generated_at > now() - interval '7 days'
                   ) AS wins_7d
            FROM agents a
            LEFT JOIN trade_postmortems p ON p.agent_id = a.id
            WHERE a.company_id = $1 AND a.role = 'employee'
            GROUP BY a.id
            ORDER BY a.name
            """,
            ctx.company_id,
        )
    employees = []
    for r in rows:
        n = int(r["n_7d"])
        hit = (int(r["wins_7d"]) / n) if n else None
        employees.append({
            "employee_agent_id": str(r["id"]),
            "name": r["name"],
            "forecasting_model": r["forecasting_model"],
            "config": {
                "min_confidence_threshold": float(r["min_confidence_threshold"]),
                "kelly_fraction": float(r["kelly_fraction"]),
                "min_payoff_ratio": float(r["min_payoff_ratio"]),
                "max_position_size_usd": float(r["max_position_size_usd"]),
                "max_trades_per_day": int(r["max_trades_per_day"]),
                "target_holding_secs": int(r["target_holding_secs"]),
            },
            "allocated_balance_usd": float(r["allocated_balance_usd"]),
            "allowed_assets": list(r["allowed_assets"] or []),
            "state": {
                "is_paused": bool(r["is_paused"]),
                "pause_reason": r["pause_reason"],
                "cooling_off_until": r["cooling_off_until"],
                "cooling_off_loss_streak": int(r["cooling_off_loss_streak"] or 0),
            },
            "last_7d": {
                "trades": n,
                "wins": int(r["wins_7d"]),
                "hit_rate": hit,
                "pnl_usd": float(r["pnl_7d"]),
            },
        })
    return {"employees": employees}


async def _log_action(
    *, company_id: UUID, manager_agent_id: UUID,
    employee_agent_id: UUID | None, kind: str,
    field_name: str | None = None,
    before_value: Any = None, after_value: Any = None,
    reason: str | None = None, llm_narrative: str | None = None,
) -> UUID:
    async with acquire() as conn:
        return await conn.fetchval(
            """
            INSERT INTO manager_actions
                (company_id, manager_agent_id, employee_agent_id,
                 action_kind, field_name, before_value, after_value,
                 reason, llm_narrative)
            VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9)
            RETURNING id
            """,
            company_id, manager_agent_id, employee_agent_id, kind, field_name,
            json.dumps(before_value) if before_value is not None else None,
            json.dumps(after_value) if after_value is not None else None,
            reason, llm_narrative,
        )


async def _adjust_employee(args: dict, ctx: ToolContext) -> dict[str, Any]:
    field = args.get("field")
    reason = (args.get("reason") or "").strip()
    raw_value = args.get("value")
    emp_id_str = args.get("employee_agent_id") or ""
    if field not in MANAGER_ADJUSTABLE_FIELDS:
        return {"error": f"field {field!r} is not adjustable"}
    if not reason:
        return {"error": "reason is required so the audit trail can explain why"}
    try:
        emp_id = UUID(emp_id_str)
    except ValueError:
        return {"error": "employee_agent_id must be a valid UUID"}

    py_type, lo, hi = MANAGER_ADJUSTABLE_FIELDS[field]
    try:
        new_value = py_type(raw_value)
    except (TypeError, ValueError):
        return {"error": f"value must be a {py_type.__name__}"}
    if not (lo <= new_value <= hi):
        return {"error": f"{field} must be in [{lo}, {hi}], got {new_value}"}

    async with acquire() as conn:
        old_value = await conn.fetchval(
            f"SELECT {field} FROM agents WHERE id=$1 AND company_id=$2 AND role='employee'",
            emp_id, ctx.company_id,
        )
        if old_value is None:
            return {"error": "employee not found on this company"}
        # Cast for jsonb logging — numeric/float doesn't serialise straight
        # to JSON via asyncpg's Decimal type.
        before = float(old_value) if isinstance(old_value, (int, float)) else old_value
        try:
            before = py_type(before)
        except (TypeError, ValueError):
            pass
        await conn.execute(
            f"UPDATE agents SET {field} = $1, updated_at = now() WHERE id = $2",
            new_value, emp_id,
        )
    action_id = await _log_action(
        company_id=ctx.company_id, manager_agent_id=ctx.agent_id,
        employee_agent_id=emp_id, kind="adjust", field_name=field,
        before_value=before, after_value=new_value, reason=reason,
    )
    log.info("manager %s adjusted employee %s: %s %s → %s (%s)",
             ctx.agent_id, emp_id, field, before, new_value, reason)
    return {
        "ok": True, "action_id": str(action_id),
        "field": field, "before": before, "after": new_value,
    }


async def _pause_employee(args: dict, ctx: ToolContext) -> dict[str, Any]:
    reason = (args.get("reason") or "").strip()
    emp_id_str = args.get("employee_agent_id") or ""
    if not reason:
        return {"error": "reason is required"}
    try:
        emp_id = UUID(emp_id_str)
    except ValueError:
        return {"error": "employee_agent_id must be a valid UUID"}
    async with acquire() as conn:
        res = await conn.execute(
            """
            UPDATE agents
            SET is_paused = TRUE, pause_reason = $3, updated_at = now()
            WHERE id = $1 AND company_id = $2 AND role = 'employee'
            """,
            emp_id, ctx.company_id, f"manager: {reason}"[:200],
        )
    if res.endswith(" 0"):
        return {"error": "employee not found on this company"}
    await _log_action(
        company_id=ctx.company_id, manager_agent_id=ctx.agent_id,
        employee_agent_id=emp_id, kind="pause", reason=reason,
    )
    return {"ok": True, "paused": True}


async def _resume_employee(args: dict, ctx: ToolContext) -> dict[str, Any]:
    reason = (args.get("reason") or "").strip()
    emp_id_str = args.get("employee_agent_id") or ""
    if not reason:
        return {"error": "reason is required"}
    try:
        emp_id = UUID(emp_id_str)
    except ValueError:
        return {"error": "employee_agent_id must be a valid UUID"}
    async with acquire() as conn:
        res = await conn.execute(
            """
            UPDATE agents
            SET is_paused = FALSE, pause_reason = NULL, updated_at = now()
            WHERE id = $1 AND company_id = $2 AND role = 'employee'
            """,
            emp_id, ctx.company_id,
        )
    if res.endswith(" 0"):
        return {"error": "employee not found on this company"}
    await _log_action(
        company_id=ctx.company_id, manager_agent_id=ctx.agent_id,
        employee_agent_id=emp_id, kind="resume", reason=reason,
    )
    return {"ok": True, "paused": False}


async def _get_company_goals(ctx: ToolContext) -> dict[str, Any]:
    async with acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT name, paper_mode, current_asset_tier,
                   daily_profit_target_usd
            FROM companies WHERE id = $1
            """,
            ctx.company_id,
        )
    if row is None:
        return {"error": "company not found"}
    target = row["daily_profit_target_usd"]
    return {
        "company_name": row["name"],
        "paper_mode": bool(row["paper_mode"]),
        "current_asset_tier": int(row["current_asset_tier"] or 1),
        "daily_profit_target_usd": float(target) if target is not None else None,
        "guidance": (
            "Size positions and pick employees to support this target."
            if target is not None else
            "No specific daily target set — preserve capital and avoid losses."
        ),
    }


async def _set_company_daily_profit_target(args: dict, ctx: ToolContext) -> dict[str, Any]:
    reason = (args.get("reason") or "").strip()
    raw = args.get("daily_profit_target_usd")
    if not reason:
        return {"error": "reason is required"}
    # Allow null to clear, otherwise validate range.
    target: float | None
    if raw is None:
        target = None
    else:
        try:
            target = float(raw)
        except (TypeError, ValueError):
            return {"error": "daily_profit_target_usd must be a number or null"}
        if target < 0 or target > 100_000:
            return {"error": "daily_profit_target_usd must be between 0 and 100,000"}
    async with acquire() as conn:
        prev = await conn.fetchval(
            "SELECT daily_profit_target_usd FROM companies WHERE id = $1",
            ctx.company_id,
        )
        await conn.execute(
            "UPDATE companies SET daily_profit_target_usd = $2, updated_at = now() WHERE id = $1",
            ctx.company_id, target,
        )
    await _log_action(
        company_id=ctx.company_id, manager_agent_id=ctx.agent_id,
        employee_agent_id=None, kind="adjust",
        field_name="company.daily_profit_target_usd",
        before_value=float(prev) if prev is not None else None,
        after_value=target,
        reason=reason,
    )
    return {
        "ok": True,
        "previous": float(prev) if prev is not None else None,
        "current": target,
    }


async def _get_upcoming_economic_events(args: dict, ctx: ToolContext) -> dict[str, Any]:
    hours = int(args.get("hours_ahead") or 24)
    hours = max(1, min(168, hours))
    impact = (args.get("impact") or "high").lower()
    asset = (args.get("asset") or "").strip()

    clauses = ["ts BETWEEN now() AND now() + make_interval(hours => $1)"]
    sql_args: list[Any] = [hours]
    if impact == "high":
        clauses.append("impact = 'high'")
    elif impact == "medium":
        clauses.append("impact IN ('medium','high')")
    # 'any' → no impact filter
    if asset:
        sql_args.append(asset)
        clauses.append(f"${len(sql_args)} = ANY(affected_assets)")
    where = " AND ".join(clauses)
    async with acquire() as conn:
        rows = await conn.fetch(
            f"""
            SELECT name, impact, currency, ts, affected_assets
            FROM economic_events
            WHERE {where}
            ORDER BY ts ASC
            LIMIT 40
            """,
            *sql_args,
        )
    events = [
        {
            "name": r["name"],
            "impact": r["impact"],
            "currency": r["currency"],
            "ts": r["ts"].isoformat(),
            "minutes_until": int((r["ts"].timestamp() - _now_ts()) / 60),
            "affected_assets": list(r["affected_assets"] or []),
        }
        for r in rows
    ]
    return {
        "hours_ahead": hours,
        "impact_filter": impact,
        "asset_filter": asset or None,
        "events": events,
        "guidance": (
            "Avoid opening new positions within 15 minutes of a high-impact "
            "event on the affected asset; halve stake for 2 hours after."
            if events else
            "No events in this window — clear runway."
        ),
    }


def _now_ts() -> float:
    """Wrapped so unit tests can monkeypatch (and to keep the import
    block at the top quiet — `time` lives only here)."""
    import time as _t
    return _t.time()


async def _request_meeting_with_manager(args: dict, ctx: ToolContext) -> dict[str, Any]:
    reason = (args.get("reason") or "").strip()
    if not reason:
        return {"error": "reason is required (1-2 sentences)"}
    # Cap the reason to a reasonable length so a runaway LLM can't
    # write a novel into the queue.
    reason = reason[:2000]
    async with acquire() as conn:
        # Don't pile up duplicate pending requests from the same
        # employee in a short window — coalesce.
        existing = await conn.fetchval(
            """
            SELECT id FROM employee_meeting_requests
            WHERE employee_agent_id = $1 AND status = 'pending'
              AND created_at > now() - interval '6 hours'
            LIMIT 1
            """,
            ctx.agent_id,
        )
        if existing is not None:
            return {
                "ok": True,
                "request_id": str(existing),
                "note": "you already have a pending request; the manager will see both reasons next review",
            }
        new_id = await conn.fetchval(
            """
            INSERT INTO employee_meeting_requests
                (company_id, employee_agent_id, reason)
            VALUES ($1, $2, $3)
            RETURNING id
            """,
            ctx.company_id, ctx.agent_id, reason,
        )
    return {
        "ok": True,
        "request_id": str(new_id),
        "note": "the manager will pick this up at the next review or 1:1",
    }


async def _hold_meeting_with_employee(args: dict, ctx: ToolContext) -> dict[str, Any]:
    """Schedule a 1:1 meeting between the calling manager and a named
    employee. The meeting itself runs as a background task so it doesn't
    block the calling LLM round; the transcript surfaces in the activity
    feed and chat history once it completes."""
    import asyncio as _asyncio

    from app.manager_review import in_meeting_with, trigger_one_on_one

    # Recursion guard: if this tool is called from inside an
    # already-running 1:1, refuse. Otherwise a manager that wants to
    # "go deeper" on an employee just spawns another meeting from
    # within the current one, which then does the same, ad infinitum.
    current = in_meeting_with.get()
    if current is not None:
        return {
            "error": (
                "you are already in a 1:1 meeting — finish this one "
                "(by writing your meeting notes and not calling any "
                "more tools) before scheduling another"
            ),
        }

    agenda = (args.get("agenda") or "").strip()
    emp_id_str = args.get("employee_agent_id") or ""
    if not agenda:
        return {"error": "agenda is required (1 sentence on what you want to discuss)"}
    try:
        emp_id = UUID(emp_id_str)
    except ValueError:
        return {"error": "employee_agent_id must be a valid UUID"}
    # Verify the employee exists on this company before spawning the task —
    # cheap pre-check so the LLM gets immediate feedback on a bad id.
    async with acquire() as conn:
        emp = await conn.fetchrow(
            "SELECT id, name FROM agents WHERE id=$1 AND company_id=$2 AND role='employee'",
            emp_id, ctx.company_id,
        )
    if emp is None:
        return {"error": "employee not found on this company"}
    # Fire-and-forget. The task runs after the current tool call
    # returns, so the manager's review can finish writing its own
    # transcript first.
    _asyncio.create_task(trigger_one_on_one(
        company_id=ctx.company_id, employee_agent_id=emp_id, agenda=agenda,
    ))
    return {"ok": True, "scheduled": True, "employee_name": emp["name"]}


async def _web_search(args: dict, ctx: ToolContext) -> dict[str, Any]:
    """Run a per-company-gated internet search. Returns title + url +
    snippet for each result, plus the remaining daily quota so the
    LLM can self-pace."""
    from app.web_search import search as _ws_search

    query = (args.get("query") or "").strip()
    if not query:
        return {"error": "query is required"}
    max_results = int(args.get("max_results") or 5)
    outcome = await _ws_search(
        company_id=ctx.company_id, agent_id=ctx.agent_id,
        query=query, max_results=max_results,
    )
    if not outcome.ok:
        return {
            "ok": False,
            "error": outcome.reason or "search failed",
            "quota_used_today": outcome.quota_used_today,
            "quota_total": outcome.quota_total,
        }
    return {
        "ok": True,
        "query": query,
        "results": [
            {"title": r.title, "url": r.url, "snippet": r.snippet, "domain": r.domain}
            for r in outcome.results
        ],
        "quota_used_today": outcome.quota_used_today,
        "quota_total": outcome.quota_total,
    }
