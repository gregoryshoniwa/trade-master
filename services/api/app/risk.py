"""Risk Agent — deterministic pre-trade validation.

Hard rule from PLAN §15: agents (LLMs) cannot bypass this layer. The
chat route never calls Risk; only the decision loop does. The checks
are intentionally boring and predictable.

Phase 1 scope:
  - Kill switch (per-company; flipped by admin OR circuit breaker)
  - Per-agent caps (allocation, max position size, max daily DD)
  - Trade frequency cap (max_trades_per_day)
  - Confidence floor (agent.min_confidence_threshold)
  - Cool-down after consecutive losses (skipped — no closed trades yet)
  - Greed limit after consecutive wins (skipped — same)
  - Stop-loss required (hardcoded)
  - Tier check (asset + contract type unlocked at company tier)
  - Event-aware blackout (queries economic_events; -15/+30 min for high
    impact, -5/+10 min for medium; agent.event_aware=false opts out)

Returns a structured verdict so the UI can surface "why".
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from uuid import UUID

import asyncpg


@dataclass
class RiskCheck:
    name: str
    passed: bool
    detail: str | None = None


@dataclass
class RiskVerdict:
    ok: bool
    reason: str | None
    checks: list[RiskCheck]
    # Caps applied — may shrink stake or otherwise mutate the intent.
    applied_stake_usd: float | None = None

    def as_jsonb(self) -> dict[str, Any]:
        return {
            "ok": self.ok,
            "reason": self.reason,
            "checks": [c.__dict__ for c in self.checks],
            "applied_stake_usd": self.applied_stake_usd,
        }


# Hard floors regardless of agent config — defense in depth.
GLOBAL_MIN_STAKE_USD = 1.0
GLOBAL_MAX_STAKE_USD = 500.0


async def evaluate(
    conn: asyncpg.Connection,
    *,
    company_id: UUID,
    agent_id: UUID,
    asset: str,
    contract_type: str,
    proposed_stake_usd: float,
    confidence: float,
    stop_loss: float | None,
) -> RiskVerdict:
    checks: list[RiskCheck] = []

    agent = await conn.fetchrow(
        """
        SELECT id, name, is_active, is_paused, pause_reason,
               allocated_balance_usd, max_position_size_usd, max_daily_drawdown_pct,
               max_trades_per_day, min_confidence_threshold,
               allowed_assets, allowed_contract_types, event_aware
        FROM agents
        WHERE id = $1 AND company_id = $2
        """,
        agent_id, company_id,
    )
    if agent is None:
        return _fail("agent not found", checks)

    # ── activity / pause ────────────────────────────────────────
    if not agent["is_active"]:
        return _fail("agent is not active", _add(checks, "is_active", False))
    checks.append(RiskCheck("is_active", True))
    if agent["is_paused"]:
        return _fail(
            f"agent paused: {agent['pause_reason'] or 'no reason'}",
            _add(checks, "not_paused", False, agent["pause_reason"]),
        )
    checks.append(RiskCheck("not_paused", True))

    # ── company tier + kill switch ──────────────────────────────
    co = await conn.fetchrow(
        """
        SELECT current_asset_tier, unlocked_contract_types,
               kill_switch_active, kill_switch_reason
        FROM companies WHERE id = $1
        """,
        company_id,
    )
    if co is None:
        return _fail("company not found", checks)
    if co["kill_switch_active"]:
        return _fail(
            f"kill switch active: {co['kill_switch_reason'] or 'no reason given'}",
            _add(checks, "kill_switch", False, detail=co["kill_switch_reason"]),
        )
    checks.append(RiskCheck("kill_switch", True))
    unlocked_contracts = list(co["unlocked_contract_types"] or [])
    contract_ok = contract_type in unlocked_contracts
    checks.append(RiskCheck(
        "contract_unlocked", contract_ok,
        detail=f"company tier {co['current_asset_tier']}; unlocked: {unlocked_contracts}",
    ))
    if not contract_ok:
        return _fail(f"contract type {contract_type} not unlocked at this tier", checks)

    # ── per-agent asset/contract whitelist ──────────────────────
    allowed_assets = list(agent["allowed_assets"] or [])
    if allowed_assets and asset not in allowed_assets:
        return _fail(
            f"asset {asset} not in agent's allowed_assets",
            _add(checks, "agent_asset_allowed", False),
        )
    checks.append(RiskCheck("agent_asset_allowed", True))

    allowed_contracts = list(agent["allowed_contract_types"] or [])
    if allowed_contracts and contract_type not in allowed_contracts:
        return _fail(
            f"contract {contract_type} not in agent's allowed_contract_types",
            _add(checks, "agent_contract_allowed", False),
        )
    checks.append(RiskCheck("agent_contract_allowed", True))

    # ── economic-calendar blackout (PLAN §9) ────────────────────
    # Agents with event_aware=false opt out; high-impact events block trading
    # ±15/30 min, medium ±5/10. The ingestor populates affected_assets so we
    # don't need to derive currency-from-symbol here.
    if agent["event_aware"]:
        blackout = await conn.fetchrow(
            """
            SELECT name, impact, ts FROM economic_events
            WHERE $1 = ANY(affected_assets)
              AND (
                (impact = 'high'   AND ts BETWEEN now() - interval '30 min' AND now() + interval '15 min')
                OR
                (impact = 'medium' AND ts BETWEEN now() - interval '10 min' AND now() + interval '5 min')
              )
            ORDER BY ts ASC
            LIMIT 1
            """,
            asset,
        )
        if blackout is not None:
            return _fail(
                f"event blackout: {blackout['name']} ({blackout['impact']})",
                _add(checks, "event_blackout", False,
                     detail=f"{blackout['name']} {blackout['impact']} at {blackout['ts'].isoformat()}"),
            )
        checks.append(RiskCheck("event_blackout", True))

    # ── confidence floor ────────────────────────────────────────
    conf_ok = confidence >= float(agent["min_confidence_threshold"])
    checks.append(RiskCheck(
        "confidence_floor", conf_ok,
        detail=f"{confidence:.2f} vs floor {float(agent['min_confidence_threshold']):.2f}",
    ))
    if not conf_ok:
        return _fail("confidence below agent floor", checks)

    # ── stop-loss required ──────────────────────────────────────
    if stop_loss is None or stop_loss <= 0:
        return _fail("stop_loss required", _add(checks, "stop_loss_present", False))
    checks.append(RiskCheck("stop_loss_present", True))

    # ── stake caps ──────────────────────────────────────────────
    max_pos = float(agent["max_position_size_usd"])
    capped_stake = max(GLOBAL_MIN_STAKE_USD, min(proposed_stake_usd, max_pos, GLOBAL_MAX_STAKE_USD))
    checks.append(RiskCheck(
        "stake_within_caps", True,
        detail=f"proposed ${proposed_stake_usd:.2f} → capped ${capped_stake:.2f}"
               f" (agent max ${max_pos:.2f}, global cap ${GLOBAL_MAX_STAKE_USD:.0f})",
    ))

    # ── post-event sizing (PLAN §9) ─────────────────────────────
    # In the 2 hours after a high-impact event fired on this asset, halve
    # the stake. We skip this for event_aware=false agents (they opted out).
    if agent["event_aware"]:
        recent = await conn.fetchval(
            """
            SELECT name FROM economic_events
            WHERE $1 = ANY(affected_assets)
              AND impact = 'high'
              AND ts BETWEEN now() - interval '2 hours' AND now()
            ORDER BY ts DESC
            LIMIT 1
            """,
            asset,
        )
        if recent:
            reduced = max(GLOBAL_MIN_STAKE_USD, round(capped_stake * 0.5, 2))
            checks.append(RiskCheck(
                "post_event_sizing", True,
                detail=f"50% reduction for 2hr post {recent}: ${capped_stake:.2f} → ${reduced:.2f}",
            ))
            capped_stake = reduced

    # ── trades-per-day cap ──────────────────────────────────────
    used_today = await conn.fetchval(
        """
        SELECT count(*) FROM trade_intents
        WHERE agent_id = $1
          AND created_at >= date_trunc('day', now())
          AND status IN ('pending_approval','approved','auto_approved','executed')
        """,
        agent_id,
    )
    used_today = int(used_today or 0)
    cap = int(agent["max_trades_per_day"])
    freq_ok = used_today < cap
    checks.append(RiskCheck(
        "trades_per_day", freq_ok,
        detail=f"{used_today} / {cap} today",
    ))
    if not freq_ok:
        return _fail("max trades/day reached", checks)

    # ── daily drawdown cap ──────────────────────────────────────
    # Phase 1 stub: we have no realized P&L tables yet (Phase 7 wiring).
    # When that lands, replace this with a real LossSoFar query.
    checks.append(RiskCheck("daily_dd_cap", True, detail="P&L tracking not yet wired"))

    # ── allocation availability ─────────────────────────────────
    # Sum of stake_usd for pending+approved+executed today as a proxy for
    # "currently committed" until we have a real allocations ledger.
    committed = await conn.fetchval(
        """
        SELECT COALESCE(sum(stake_usd), 0) FROM trade_intents
        WHERE agent_id = $1
          AND status IN ('pending_approval','approved','auto_approved')
        """,
        agent_id,
    )
    committed = float(committed or 0.0)
    available = float(agent["allocated_balance_usd"]) - committed
    alloc_ok = available >= capped_stake
    checks.append(RiskCheck(
        "allocation_available", alloc_ok,
        detail=f"available ${available:.2f} vs needed ${capped_stake:.2f}",
    ))
    if not alloc_ok:
        return _fail("insufficient allocation", checks)

    return RiskVerdict(ok=True, reason=None, checks=checks, applied_stake_usd=capped_stake)


def _fail(reason: str, checks: list[RiskCheck]) -> RiskVerdict:
    return RiskVerdict(ok=False, reason=reason, checks=checks)


def _add(checks: list[RiskCheck], name: str, passed: bool, detail: str | None = None) -> list[RiskCheck]:
    checks.append(RiskCheck(name, passed, detail))
    return checks
