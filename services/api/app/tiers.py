"""Tier-based feature gates.

Single source of truth for what each subscription level can do. Keep
limits in code — they version with the runtime so a deploy can change
the limits atomically, and a future Stripe-flip just updates the
`companies.tier_name` column.

Read at hot paths via `await gate_feature(company_id, "feature")` or
its more specific cousins (`gate_agent_count`, `gate_forecaster`, …).
Each gate raises `TierLimitError` when blocked; routes catch it and
turn it into a 402-Payment-Required so the UI can show "upgrade your
tier" in the right place.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from fastapi import HTTPException, status

from app.db import acquire

TierName = Literal["free", "starter", "pro", "enterprise"]
INF = 10**9  # practical infinity — bigger than anything real, smaller than json/db sentinels


@dataclass(frozen=True)
class TierLimits:
    name: TierName
    label: str
    max_users: int
    # `max_agents` counts EMPLOYEE agents the user has authored — Alpha
    # (manager) and Scout (research) come seeded with every company and
    # are exempt so the free tier still has a working agentic loop.
    max_employees: int
    allowed_forecasters: tuple[str, ...]
    paper_only: bool                # blocks deriv_environment='real'
    voice_minutes_per_month: int    # 0 means voice is gated off entirely
    web_search_daily_quota: int     # the per-company default; CEO can lower
    manager_loop: bool              # scheduled review + 1:1 meetings
    label_color: str                # for the Settings/dashboard badge


_TIERS: dict[str, TierLimits] = {
    "free": TierLimits(
        name="free", label="Free",
        max_users=1, max_employees=1,
        allowed_forecasters=("ttm-granite-r2",),
        paper_only=True,
        voice_minutes_per_month=0,
        web_search_daily_quota=0,
        manager_loop=False,
        label_color="text-text-mute",
    ),
    "starter": TierLimits(
        name="starter", label="Starter",
        max_users=3, max_employees=5,
        allowed_forecasters=("ttm-granite-r2", "kronos-base"),
        paper_only=False,   # demo allowed, real still passkey-gated
        voice_minutes_per_month=30,
        web_search_daily_quota=100,
        manager_loop=False,
        label_color="text-accent",
    ),
    "pro": TierLimits(
        name="pro", label="Pro",
        max_users=10, max_employees=INF,
        allowed_forecasters=("ttm-granite-r2", "kronos-base", "tsfm-ensemble"),
        paper_only=False,
        voice_minutes_per_month=200,
        web_search_daily_quota=500,
        manager_loop=True,
        label_color="text-bull",
    ),
    "enterprise": TierLimits(
        name="enterprise", label="Enterprise",
        max_users=INF, max_employees=INF,
        allowed_forecasters=("ttm-granite-r2", "kronos-base", "tsfm-ensemble"),
        paper_only=False,
        voice_minutes_per_month=INF,
        web_search_daily_quota=INF,
        manager_loop=True,
        label_color="text-warning",
    ),
}


def get_limits(tier: str) -> TierLimits:
    """Returns a TierLimits — unknown tiers fall through to 'free' so
    we fail closed."""
    return _TIERS.get(tier, _TIERS["free"])


def all_limits() -> list[TierLimits]:
    return list(_TIERS.values())


class TierLimitError(HTTPException):
    """Raised when a tier gate trips. HTTP 402 ('Payment Required') —
    semantically perfect even though most clients just treat it as a
    4xx with a body. The UI looks at the `detail` payload for the
    feature name and upgrade-CTA."""

    def __init__(self, *, feature: str, tier: TierName, message: str):
        super().__init__(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail={
                "error": "tier_limit",
                "feature": feature,
                "current_tier": tier,
                "message": message,
            },
        )


# ────────────────────── reads ──────────────────────


async def get_tier_name(company_id) -> TierName:
    async with acquire() as conn:
        name = await conn.fetchval(
            "SELECT tier_name FROM companies WHERE id = $1", company_id,
        )
    return name if name in _TIERS else "free"


async def get_tier(company_id) -> TierLimits:
    return get_limits(await get_tier_name(company_id))


# ────────────────────── gates ──────────────────────


async def gate_add_user(company_id) -> None:
    """Block adding a new member when the seat cap is hit."""
    tier = await get_tier(company_id)
    if tier.max_users >= INF:
        return
    async with acquire() as conn:
        n = await conn.fetchval(
            "SELECT count(*) FROM company_members WHERE company_id = $1",
            company_id,
        )
    if int(n) >= tier.max_users:
        raise TierLimitError(
            feature="users",
            tier=tier.name,
            message=(
                f"the {tier.label} tier includes up to {tier.max_users} "
                "user(s). Upgrade to add more."
            ),
        )


async def gate_add_employee_agent(company_id) -> None:
    """Block creating a new EMPLOYEE agent when the cap is hit. Manager
    and research agents (Alpha + Scout) are exempt."""
    tier = await get_tier(company_id)
    if tier.max_employees >= INF:
        return
    async with acquire() as conn:
        n = await conn.fetchval(
            "SELECT count(*) FROM agents WHERE company_id = $1 AND role = 'employee'",
            company_id,
        )
    if int(n) >= tier.max_employees:
        raise TierLimitError(
            feature="employee_agents",
            tier=tier.name,
            message=(
                f"the {tier.label} tier includes up to {tier.max_employees} "
                "employee agent(s). Upgrade for more."
            ),
        )


async def gate_forecaster(company_id, model_key: str) -> None:
    tier = await get_tier(company_id)
    if model_key not in tier.allowed_forecasters:
        raise TierLimitError(
            feature="forecasting_model",
            tier=tier.name,
            message=(
                f"{model_key} is not available on the {tier.label} tier. "
                f"Tier allows: {', '.join(tier.allowed_forecasters)}."
            ),
        )


async def gate_real_trading(company_id) -> None:
    """Trip when a paper-only tier tries to flip a company to real
    money. The WebAuthn passkey check still applies on top — both gates
    must pass."""
    tier = await get_tier(company_id)
    if tier.paper_only:
        raise TierLimitError(
            feature="real_trading",
            tier=tier.name,
            message=f"real-money trading is not available on the {tier.label} tier.",
        )


async def gate_voice(company_id) -> None:
    """Allow voice when the tier permits any monthly minutes. Per-minute
    enforcement (after `voice_minutes_per_month` is spent) would live
    here too, but tracking by-minute requires aggregating
    `llm_usage_records.duration_secs` for the month — deferred."""
    tier = await get_tier(company_id)
    if tier.voice_minutes_per_month <= 0:
        raise TierLimitError(
            feature="voice",
            tier=tier.name,
            message=f"voice chat is not available on the {tier.label} tier.",
        )


def manager_loop_allowed(tier_name: str) -> bool:
    """Cheap synchronous check used by the manager-review cron to skip
    companies whose tier doesn't include the manager loop."""
    return get_limits(tier_name).manager_loop


def tier_web_search_quota(tier_name: str) -> int:
    return get_limits(tier_name).web_search_daily_quota
