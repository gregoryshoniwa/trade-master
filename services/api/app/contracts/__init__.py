"""Contract-type plugin registry (PLAN §5 / Phase 5).

Each contract type Deriv offers (Multipliers, Accumulators, Turbos,
Vanilla CALL/PUT, Rise/Fall ticks, …) has its own buy params, settlement
shape, and risk profile. Hard-coding them in `decision_loop` made
MULTUP/MULTDOWN special and everything else impossible.

This module is a thin registry of `ContractPlugin` objects. The decision
loop asks the registry to pick a plugin given the agent's preferences +
the asset/direction, then calls the plugin to produce the trade
parameters. The gateway router has a parallel switch on `contract_type`
for the broker-side buy parameters.

Adding a new contract type later is now:

  1. Drop a new module in this folder that declares a `ContractPlugin`.
  2. Import it below.
  3. Add the broker buy-params branch in
     `services/gateway/internal/trader/router.go`.

That's it — the decision loop, risk agent, execution consumer, and
postmortem path are all agnostic.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal


Tier = int   # 1..9 per PLAN §8.1

Direction = Literal["up", "down", "flat"]


@dataclass(frozen=True)
class TradeParams:
    """What the decision loop hands the order router. Field names match
    the gateway's `ApprovedIntent` so the bus envelope is a pass-through."""

    contract_type: str
    stake_usd: float
    multiplier: int | None     # Multipliers only
    duration_secs: int | None  # Tick / second contracts
    stop_loss: float | None    # Price level
    take_profit: float | None  # Price level


@dataclass(frozen=True)
class ContractPlugin:
    """One contract family — name, tier it unlocks at, what asset
    classes it works on, and how to size + place a trade given the
    agent's intent."""

    key: str                       # the contract_type stored on the intent
    label: str                     # human-friendly
    tier: Tier                     # required company tier
    families: tuple[str, ...]      # which contract families it belongs to
                                   # (e.g. "directional", "range", "accumulator")
    supports_direction: bool       # False for direction-less products like ACCU
    description: str

    def build(
        self, *,
        direction: Direction,
        proposed_stake_usd: float,
        last_price: float,
        stop_pct: float,
        payoff_ratio: float,
        asset: str,
        multiplier_default: int,
        target_holding_secs: int,
    ) -> TradeParams:
        raise NotImplementedError


# ───────────────────────── plugins ──────────────────────────


class MultiplierUp(ContractPlugin):
    """MULTUP — long-leveraged contract that profits when price rises.

    Tier 1. Stop/target expressed as broker-side limit_order in USD,
    derived from the requested price-percentage stop and the payoff
    ratio."""

    def __init__(self) -> None:
        object.__setattr__(self, "key", "MULTUP")
        object.__setattr__(self, "label", "Multiplier UP")
        object.__setattr__(self, "tier", 1)
        object.__setattr__(self, "families", ("directional", "leveraged"))
        object.__setattr__(self, "supports_direction", True)
        object.__setattr__(
            self, "description",
            "Leveraged long on the underlying. Broker manages settlement at the "
            "stop or target. The standard intra-day product on Deriv."
        )

    def build(self, **kw) -> TradeParams:
        last = float(kw["last_price"])
        stop_pct = float(kw["stop_pct"])
        payoff = float(kw["payoff_ratio"])
        stop_price = last * (1.0 - stop_pct)
        target_price = last * (1.0 + stop_pct * payoff)
        return TradeParams(
            contract_type="MULTUP",
            stake_usd=float(kw["proposed_stake_usd"]),
            multiplier=int(kw["multiplier_default"]),
            duration_secs=None,   # multipliers run open-ended
            stop_loss=stop_price,
            take_profit=target_price,
        )


class MultiplierDown(MultiplierUp):
    def __init__(self) -> None:
        super().__init__()
        object.__setattr__(self, "key", "MULTDOWN")
        object.__setattr__(self, "label", "Multiplier DOWN")
        object.__setattr__(
            self, "description",
            "Leveraged short on the underlying. Mirror of MULTUP."
        )

    def build(self, **kw) -> TradeParams:
        last = float(kw["last_price"])
        stop_pct = float(kw["stop_pct"])
        payoff = float(kw["payoff_ratio"])
        stop_price = last * (1.0 + stop_pct)
        target_price = last * (1.0 - stop_pct * payoff)
        return TradeParams(
            contract_type="MULTDOWN",
            stake_usd=float(kw["proposed_stake_usd"]),
            multiplier=int(kw["multiplier_default"]),
            duration_secs=None,
            stop_loss=stop_price,
            take_profit=target_price,
        )


class RiseFallRise(ContractPlugin):
    """CALL (Rise) — fixed-stake, fixed-payout tick/second contract on
    direction-only. Tier 0 product (available everywhere); no leverage."""

    def __init__(self) -> None:
        object.__setattr__(self, "key", "CALL")
        object.__setattr__(self, "label", "Rise (CALL)")
        object.__setattr__(self, "tier", 1)
        object.__setattr__(self, "families", ("directional", "binary"))
        object.__setattr__(self, "supports_direction", True)
        object.__setattr__(
            self, "description",
            "Binary 'price goes up' contract. Fixed stake / fixed payout — "
            "no stops or targets, the broker settles at the duration."
        )

    def build(self, **kw) -> TradeParams:
        return TradeParams(
            contract_type="CALL",
            stake_usd=float(kw["proposed_stake_usd"]),
            multiplier=None,
            duration_secs=int(kw["target_holding_secs"] or 60),
            stop_loss=None,
            take_profit=None,
        )


class RiseFallPut(RiseFallRise):
    def __init__(self) -> None:
        super().__init__()
        object.__setattr__(self, "key", "PUT")
        object.__setattr__(self, "label", "Fall (PUT)")
        object.__setattr__(
            self, "description",
            "Binary 'price goes down' contract. Mirror of CALL."
        )

    def build(self, **kw) -> TradeParams:
        return TradeParams(
            contract_type="PUT",
            stake_usd=float(kw["proposed_stake_usd"]),
            multiplier=None,
            duration_secs=int(kw["target_holding_secs"] or 60),
            stop_loss=None,
            take_profit=None,
        )


# Registry ─────────────────────────────────────────────────────
# Ordering matters: we prefer leveraged Multipliers when available
# (more bps per signal), fall back to binary Rise/Fall otherwise.

CATALOG: list[ContractPlugin] = [
    MultiplierUp(),
    MultiplierDown(),
    RiseFallRise(),
    RiseFallPut(),
]

BY_KEY: dict[str, ContractPlugin] = {p.key: p for p in CATALOG}


def pick_for_direction(
    *,
    direction: Direction,
    company_tier: Tier,
    company_unlocked: list[str],
    agent_allowed: list[str],
) -> ContractPlugin | None:
    """Choose the highest-tier contract this agent can place that matches
    the desired direction. Returns None when no plugin is allowed —
    decision loop should skip the intent in that case."""
    if direction not in ("up", "down"):
        return None

    want = {"up": ("MULTUP", "CALL"), "down": ("MULTDOWN", "PUT")}[direction]
    # If the agent's allowed_contract_types is empty it means "no
    # restriction" — fall back to the company's unlocked set.
    pool = agent_allowed if agent_allowed else company_unlocked
    pool_set = {k.upper() for k in pool}

    for key in want:
        p = BY_KEY.get(key)
        if p is None:
            continue
        if key not in pool_set:
            continue
        if p.tier > company_tier:
            continue
        return p
    return None
