"""Agent CRUD per Company.

Routes mounted under /api/v1/companies/{company_id}/agents.
All routes check that the caller is a member of the company.
"""

import json
from uuid import UUID

import asyncpg
from fastapi import APIRouter, HTTPException, status

from app.auth import CurrentAccount
from app.db import acquire
from app.forecasting import is_known as is_known_forecast
from app.llm import is_known as is_known_model
from app.personalities import PRESETS, apply_preset
from app.schemas import (
    PERSONALITIES,
    Agent,
    AgentCreate,
    AgentList,
    AgentUpdate,
    PauseRequest,
    PersonalityDef,
)

router = APIRouter(prefix="/companies/{company_id}/agents", tags=["agents"])
personality_router = APIRouter(prefix="/personalities", tags=["personalities"])


# ───────────────────────── helpers ──────────────────────────


async def _ensure_member(conn: asyncpg.Connection, company_id: UUID, account_id: UUID) -> str:
    """Return the caller's role in the Company, or 401/404 if no access."""
    role = await conn.fetchval(
        """
        SELECT role FROM company_members
        WHERE company_id = $1 AND account_id = $2
        """,
        company_id,
        account_id,
    )
    if role is None:
        # Don't leak whether the company exists.
        raise HTTPException(status.HTTP_404_NOT_FOUND, "company not found")
    return role


def _ensure_can_write(role: str) -> None:
    """Owners + admins can mutate; traders + viewers cannot."""
    if role not in ("owner", "admin"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "insufficient role")


def _row_to_agent(r: asyncpg.Record) -> Agent:
    combos = r["allowed_combinations"]
    if isinstance(combos, str):
        combos = json.loads(combos)
    return Agent(
        id=r["id"],
        company_id=r["company_id"],
        name=r["name"],
        avatar_url=r["avatar_url"],
        role=r["role"],
        reports_to_agent_id=r["reports_to_agent_id"],
        llm_provider=r["llm_provider"],
        llm_model=r["llm_model"],
        forecasting_model=r["forecasting_model"],
        voice_id=r["voice_id"],
        voice_enabled=r["voice_enabled"],
        strategies=list(r["strategies"]),
        allowed_assets=list(r["allowed_assets"]),
        allowed_contract_types=list(r["allowed_contract_types"]),
        allocated_balance_usd=float(r["allocated_balance_usd"]),
        max_position_size_usd=float(r["max_position_size_usd"]),
        max_daily_drawdown_pct=float(r["max_daily_drawdown_pct"]),
        personality=r["personality"],
        trade_selection_mode=r["trade_selection_mode"],
        allowed_combinations=combos or [],
        kelly_fraction=float(r["kelly_fraction"]),
        min_confidence_threshold=float(r["min_confidence_threshold"]),
        min_payoff_ratio=float(r["min_payoff_ratio"]),
        max_trades_per_day=r["max_trades_per_day"],
        target_holding_secs=r["target_holding_secs"],
        event_aware=r["event_aware"],
        aggression_index=r["aggression_index"],
        detected_personality=r["detected_personality"],
        trade_mode=r["trade_mode"],
        is_active=r["is_active"],
        is_paused=r["is_paused"],
        pause_reason=r["pause_reason"],
        system_prompt_addendum=r["system_prompt_addendum"],
        created_at=r["created_at"],
        updated_at=r["updated_at"],
    )


# ───────────────────────── routes ───────────────────────────


@router.get("", response_model=AgentList)
async def list_agents(company_id: UUID, account_id: CurrentAccount):
    async with acquire() as conn:
        await _ensure_member(conn, company_id, account_id)
        rows = await conn.fetch(
            "SELECT * FROM agents WHERE company_id = $1 ORDER BY created_at ASC",
            company_id,
        )
    return AgentList(agents=[_row_to_agent(r) for r in rows])


@router.get("/{agent_id}", response_model=Agent)
async def get_agent(company_id: UUID, agent_id: UUID, account_id: CurrentAccount):
    async with acquire() as conn:
        await _ensure_member(conn, company_id, account_id)
        r = await conn.fetchrow(
            "SELECT * FROM agents WHERE id = $1 AND company_id = $2",
            agent_id,
            company_id,
        )
    if r is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "agent not found")
    return _row_to_agent(r)


@router.post("", response_model=Agent, status_code=status.HTTP_201_CREATED)
async def create_agent(
    company_id: UUID, body: AgentCreate, account_id: CurrentAccount
):
    if body.personality not in PERSONALITIES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "invalid personality")
    if not is_known_model(body.llm_provider, body.llm_model):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"unsupported model {body.llm_provider}/{body.llm_model} — "
            "pick one from /api/v1/llm/models",
        )
    if not is_known_forecast(body.forecasting_model):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"unsupported forecasting_model {body.forecasting_model} — "
            "pick one from /api/v1/forecasting/models",
        )

    # Apply preset defaults for any fields the caller didn't provide.
    preset_vals = apply_preset(body.personality)
    kelly = body.kelly_fraction if body.kelly_fraction is not None else preset_vals.get("kelly_fraction", 0.25)
    min_conf = body.min_confidence_threshold if body.min_confidence_threshold is not None else preset_vals.get("min_confidence_threshold", 0.55)
    min_payoff = body.min_payoff_ratio if body.min_payoff_ratio is not None else preset_vals.get("min_payoff_ratio", 1.5)
    max_trades = body.max_trades_per_day if body.max_trades_per_day is not None else preset_vals.get("max_trades_per_day", 20)
    holding = body.target_holding_secs if body.target_holding_secs is not None else preset_vals.get("target_holding_secs")

    async with acquire() as conn:
        role = await _ensure_member(conn, company_id, account_id)
        _ensure_can_write(role)

        # Validate reports_to_agent_id is in this company.
        if body.reports_to_agent_id is not None:
            ok = await conn.fetchval(
                "SELECT 1 FROM agents WHERE id = $1 AND company_id = $2",
                body.reports_to_agent_id,
                company_id,
            )
            if not ok:
                raise HTTPException(status.HTTP_400_BAD_REQUEST, "reports_to_agent_id not in this company")

        r = await conn.fetchrow(
            """
            INSERT INTO agents (
                company_id, name, avatar_url, role, reports_to_agent_id,
                llm_provider, llm_model, forecasting_model, llm_config, voice_id, voice_enabled,
                strategies, allowed_assets, allowed_contract_types,
                allocated_balance_usd, max_position_size_usd, max_daily_drawdown_pct,
                personality, trade_selection_mode, allowed_combinations,
                kelly_fraction, min_confidence_threshold, min_payoff_ratio,
                max_trades_per_day, target_holding_secs, event_aware,
                trade_mode, system_prompt_addendum, created_by
            )
            VALUES (
                $1, $2, $3, $4, $5,
                $6, $7, $8, $9, $10, $11,
                $12, $13, $14,
                $15, $16, $17,
                $18, $19, $20::jsonb,
                $21, $22, $23,
                $24, $25, $26,
                $27, $28, $29
            )
            RETURNING *
            """,
            company_id, body.name, body.avatar_url, body.role, body.reports_to_agent_id,
            body.llm_provider, body.llm_model, body.forecasting_model, json.dumps(body.llm_config), body.voice_id, body.voice_enabled,
            body.strategies, body.allowed_assets, body.allowed_contract_types,
            body.allocated_balance_usd, body.max_position_size_usd, body.max_daily_drawdown_pct,
            body.personality, body.trade_selection_mode, json.dumps(body.allowed_combinations),
            kelly, min_conf, min_payoff,
            max_trades, holding, body.event_aware,
            body.trade_mode, body.system_prompt_addendum, account_id,
        )
    return _row_to_agent(r)


@router.patch("/{agent_id}", response_model=Agent)
async def update_agent(
    company_id: UUID, agent_id: UUID, body: AgentUpdate, account_id: CurrentAccount
):
    if body.personality is not None and body.personality not in PERSONALITIES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "invalid personality")

    # If either provider or model is being changed, both must end up
    # together describing a registry entry. Load current values and
    # apply the patch in-memory before validating.
    if body.llm_provider is not None or body.llm_model is not None:
        async with acquire() as conn:
            cur = await conn.fetchrow(
                "SELECT llm_provider, llm_model FROM agents WHERE id = $1 AND company_id = $2",
                agent_id, company_id,
            )
        if cur is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "agent not found")
        prov = body.llm_provider or cur["llm_provider"]
        mdl = body.llm_model or cur["llm_model"]
        if not is_known_model(prov, mdl):
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"unsupported model {prov}/{mdl} — pick one from /api/v1/llm/models",
            )

    if body.forecasting_model is not None and not is_known_forecast(body.forecasting_model):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"unsupported forecasting_model {body.forecasting_model} — "
            "pick one from /api/v1/forecasting/models",
        )

    fields = body.model_dump(exclude_none=True)
    if not fields:
        # Idempotent no-op
        async with acquire() as conn:
            await _ensure_member(conn, company_id, account_id)
            r = await conn.fetchrow(
                "SELECT * FROM agents WHERE id = $1 AND company_id = $2",
                agent_id, company_id,
            )
        if r is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "agent not found")
        return _row_to_agent(r)

    # If the caller swapped personality preset without overriding params, pull
    # in preset defaults for any params they didn't set.
    if "personality" in fields and fields["personality"] != "custom":
        preset_vals = apply_preset(fields["personality"])
        for k, v in preset_vals.items():
            fields.setdefault(k, v)

    async with acquire() as conn:
        role = await _ensure_member(conn, company_id, account_id)
        _ensure_can_write(role)

        # Build dynamic UPDATE with positional placeholders.
        set_parts = []
        values: list = []
        for i, (col, val) in enumerate(fields.items(), start=1):
            set_parts.append(f"{col} = ${i}")
            # asyncpg won't auto-convert dict/list → jsonb.
            if col in ("llm_config", "allowed_combinations"):
                values.append(json.dumps(val))
            else:
                values.append(val)

        values.append(agent_id)
        values.append(company_id)
        sql = f"""
            UPDATE agents
            SET {", ".join(set_parts)}
            WHERE id = ${len(values) - 1} AND company_id = ${len(values)}
            RETURNING *
        """
        r = await conn.fetchrow(sql, *values)

    if r is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "agent not found")
    return _row_to_agent(r)


@router.delete("/{agent_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_agent(company_id: UUID, agent_id: UUID, account_id: CurrentAccount):
    async with acquire() as conn:
        role = await _ensure_member(conn, company_id, account_id)
        _ensure_can_write(role)
        result = await conn.execute(
            "DELETE FROM agents WHERE id = $1 AND company_id = $2",
            agent_id, company_id,
        )
    if result.endswith(" 0"):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "agent not found")
    return None


@router.post("/{agent_id}/activate", response_model=Agent)
async def activate_agent(company_id: UUID, agent_id: UUID, account_id: CurrentAccount):
    async with acquire() as conn:
        role = await _ensure_member(conn, company_id, account_id)
        _ensure_can_write(role)
        r = await conn.fetchrow(
            """
            UPDATE agents
            SET is_active = TRUE, is_paused = FALSE, pause_reason = NULL
            WHERE id = $1 AND company_id = $2
            RETURNING *
            """,
            agent_id, company_id,
        )
    if r is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "agent not found")
    return _row_to_agent(r)


@router.post("/{agent_id}/pause", response_model=Agent)
async def pause_agent(
    company_id: UUID, agent_id: UUID, body: PauseRequest, account_id: CurrentAccount
):
    async with acquire() as conn:
        role = await _ensure_member(conn, company_id, account_id)
        _ensure_can_write(role)
        r = await conn.fetchrow(
            """
            UPDATE agents
            SET is_paused = TRUE, pause_reason = $3
            WHERE id = $1 AND company_id = $2
            RETURNING *
            """,
            agent_id, company_id, body.reason,
        )
    if r is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "agent not found")
    return _row_to_agent(r)


# ──────────────────── /personalities (separate router) ────────────────────


@personality_router.get("", response_model=list[PersonalityDef])
async def list_personalities():
    """Return the 5 personality presets so the frontend can render the picker
    from a single source of truth."""
    return [PersonalityDef(**p) for p in PRESETS.values()]
