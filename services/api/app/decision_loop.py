"""Agent decision loop.

Subscribes to NATS `signals.>` (TSFM forecasts). For each forecast,
matches every active+unpaused agent in every Company that:
  - has the forecast's asset allowed (empty = any)
  - declares a strategy compatible with the forecast direction
  - sees confidence ≥ its `min_confidence_threshold`

For each match we synthesize a TradeIntent (direction → MULTUP/MULTDOWN,
stake by Kelly + caps, stop = entry × (1 − 0.5%), target = stop × payoff
ratio), run it through the deterministic Risk Agent, persist, and mark
status:

  pending_approval     trade_mode = approve_each  (default)
  auto_approved        trade_mode = autonomous
  approve_above_threshold → auto for stake < $X, else pending_approval

This is the single most important plumbing piece in Phase 1 — it
takes the system from "agents that chat" to "agents that act".
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from typing import Any
from uuid import UUID

import asyncpg
import nats
from nats.aio.msg import Msg

from app import bus, calibration, strategies
from app.contracts import pick_for_direction
from app.db import acquire
from app.ohlc import get_candles
from app.risk import evaluate as risk_evaluate
from app.selection_modes import evaluate_mode

log = logging.getLogger("trademaster.decision")

# Phase 1 trading constants — moved to per-Company config later.
DEFAULT_STOP_PCT = 0.005       # 0.5% stop
APPROVE_WINDOW_SECS = 30
APPROVE_THRESHOLD_USD = 10.0   # for approve_above_threshold mode

# Deriv multipliers are symbol-specific. We pick the SMALLEST valid value
# per symbol (least leverage — safest for Phase 1 demo). The proper fix is
# querying Deriv `contracts_for` at startup; this static map covers our
# Phase 1 catalog. Unknown symbols fall back to DEFAULT_MULTIPLIER.
SYMBOL_MULTIPLIER: dict[str, int] = {
    # Synthetic indices — verified ranges. R_50/75 reject 50, accept 50+ map.
    "R_10": 100, "R_25": 100, "R_50": 50, "R_75": 50, "R_100": 50,
    "1HZ10V": 100, "1HZ25V": 100, "1HZ50V": 50, "1HZ75V": 50, "1HZ100V": 100,
    # Real markets (forex/commodity/crypto/indices) — Deriv standard
    # multiplier range for multipliers is [100,200,300,500,800]. Smallest =
    # least leverage. If a specific symbol rejects 100, bump it (the gateway
    # logs the broker's accepted set on rejection).
    "frxEURUSD": 100, "frxGBPUSD": 100, "frxUSDJPY": 100, "frxAUDUSD": 100,
    "frxUSDCAD": 100, "frxUSDCHF": 100, "frxNZDUSD": 100, "frxEURGBP": 100,
    "frxEURJPY": 100, "frxGBPJPY": 100, "frxAUDJPY": 100, "frxEURAUD": 100,
    "frxEURCAD": 100, "frxEURCHF": 100,
    "frxXAUUSD": 100, "frxXAGUSD": 100, "frxXPDUSD": 100, "frxXPTUSD": 100,
    "cryBTCUSD": 100, "cryETHUSD": 100,
    "OTC_SPC": 100, "OTC_NDX": 100, "OTC_DJI": 100, "OTC_FTSE": 100,
    "OTC_GDAXI": 100, "OTC_N225": 100, "OTC_HSI": 100, "OTC_AS51": 100,
}
DEFAULT_MULTIPLIER = 100

class DecisionLoop:
    def __init__(self, nats_url: str | None = None):
        self.nats_url = nats_url or os.getenv("NATS_URL", "nats://nats:4222")
        self._nc: nats.NATS | None = None
        self._sub: Any | None = None
        self._stop = asyncio.Event()

    async def start(self) -> None:
        # Use the shared api NATS connection (bus). It's connected by the
        # lifespan before we start.
        nc = bus.nc()
        if nc is None:
            log.warning("decision loop: no shared nats connection; disabled")
            return
        try:
            self._sub = await nc.subscribe("signals.>", cb=self._on_signal)
            log.info("decision loop subscribed to signals.>")
        except Exception:
            log.exception("decision loop failed to subscribe (chat still works)")

    async def stop(self) -> None:
        self._stop.set()
        if self._sub is not None:
            try:
                await self._sub.unsubscribe()
            except Exception:
                pass

    async def _on_signal(self, msg: Msg) -> None:
        try:
            payload = json.loads(msg.data)
        except Exception:
            return
        # Route by model: a forecast is matched only to agents whose
        # forecasting_model equals payload["model"] (done in the SQL below).
        # We just need a model label present here.
        if not payload.get("model"):
            return

        try:
            await self._evaluate_forecast(payload)
        except Exception:
            log.exception("decision loop _evaluate_forecast failed")

    async def _evaluate_forecast(self, fc: dict[str, Any]) -> None:
        model = fc.get("model")
        asset = fc.get("asset")
        direction = fc.get("point_direction")
        raw_confidence = float(fc.get("confidence_score") or 0.0)
        last_price = float(fc.get("last_price") or 0.0)
        if not model or not asset or direction not in {"up", "down"} or last_price <= 0:
            return
        # Apply the model's active isotonic calibrator (PLAN §11). If
        # the model hasn't accumulated enough settled trades yet the
        # calibrator is a no-op and raw_confidence passes through.
        # Gating, Kelly sizing, and EV all use the calibrated value.
        confidence = await calibration.calibrate(model, raw_confidence)

        async with acquire() as conn:
            # Match candidates across ALL companies whose forecasting_model is
            # this signal's model. Each row carries its company_id so we persist
            # intents correctly. Cheap filters in SQL; finer rules run per-row.
            rows = await conn.fetch(
                """
                SELECT a.id, a.company_id, a.name, a.role, a.personality,
                       a.strategies, a.allowed_assets, a.allowed_contract_types,
                       a.min_confidence_threshold, a.kelly_fraction,
                       a.min_payoff_ratio, a.max_position_size_usd,
                       a.allocated_balance_usd, a.trade_mode,
                       a.is_active, a.is_paused, a.target_holding_secs,
                       a.forecasting_model, a.trade_selection_mode,
                       a.allowed_combinations,
                       c.current_asset_tier, c.unlocked_contract_types,
                       c.daily_profit_target_usd,
                       -- Today's realized P&L for the company. The subquery
                       -- reads from a partial index on (company_id, closed_at);
                       -- at our trade volume it's microseconds. If this gets
                       -- hot we'll cache in-process, but premature.
                       (SELECT COALESCE(SUM(realized_pnl_usd), 0)
                        FROM trade_intents
                        WHERE company_id = c.id
                          AND closed_at >= date_trunc('day', now())
                       ) AS today_realized_pnl
                FROM agents a
                JOIN companies c ON c.id = a.company_id
                WHERE a.role = 'employee'
                  AND a.is_active = TRUE
                  AND a.is_paused = FALSE
                  -- Cooling-off: skip agents currently on ice after a loss
                  -- streak. `cooling_off_until` is NULL for everyone who
                  -- isn't cooling off (and is cleared as time passes by
                  -- the natural < now() comparison).
                  AND (a.cooling_off_until IS NULL OR a.cooling_off_until < now())
                  AND a.forecasting_model = $2
                  AND $1 >= a.min_confidence_threshold
                """,
                confidence, model,
            )

        for r in rows:
            try:
                await self._maybe_intent(
                    r, fc, direction, confidence, raw_confidence, last_price, asset,
                )
            except Exception:
                log.exception("intent generation failed agent=%s", r["id"])

    async def _maybe_intent(
        self,
        agent: asyncpg.Record,
        fc: dict[str, Any],
        direction: str,
        confidence: float,
        raw_confidence: float,
        last_price: float,
        asset: str,
    ) -> None:
        # Asset whitelist on the agent
        if list(agent["allowed_assets"] or []) and asset not in agent["allowed_assets"]:
            return
        # Strategy gate — fetch recent OHLC and run the agent's strategies
        # against the live indicators. If none align with the forecast
        # direction, decline the trade. PLAN §4.
        strategy_names = list(agent["strategies"] or [])
        if not strategy_names:
            return
        candles = await get_candles(asset, granularity_sec=60, count=200)
        outcome = strategies.evaluate(strategy_names, candles, direction)
        if not outcome.accepted:
            log.info(
                "intent rejected by strategy agent=%s asset=%s: %s",
                agent["name"], asset, outcome.reason,
            )
            return

        # Stake sizing: fractional Kelly applied to allocation, capped
        # by the agent's per-position cap. Conservative for Phase 1 —
        # we'll replace with a proper Kelly-from-edge calculation
        # once we have win-rate priors from real trade outcomes.
        kelly = float(agent["kelly_fraction"])
        allocation = float(agent["allocated_balance_usd"])
        proposed = max(1.0, allocation * kelly * confidence)

        # ── Goal-aware throttle (PLAN §10 follow-up) ───────────────────
        # Read the CEO's daily profit target and today's realized P&L
        # for the company. We use a stair-step throttle:
        #   ≥ 100% of target → skip the trade entirely
        #   ≥ 80%            → halve the stake
        #   ≥ 50%            → 75% of original stake
        # The point is to protect today's gains as we approach the goal,
        # not to dial up risk after hitting it. When the target is unset
        # this whole branch is a no-op and Kelly sizing runs as-is.
        goal_note: str | None = None
        target = agent["daily_profit_target_usd"]
        if target is not None:
            target = float(target)
            today_pnl = float(agent["today_realized_pnl"] or 0)
            if target > 0:
                progress = today_pnl / target
                if progress >= 1.0:
                    log.info(
                        "agent=%s skipped: company hit daily target ($%.2f / $%.2f)",
                        agent["name"], today_pnl, target,
                    )
                    return
                if progress >= 0.8:
                    proposed = max(1.0, proposed * 0.5)
                    goal_note = f"halved (P&L ${today_pnl:.2f} = {progress:.0%} of ${target:.0f} target)"
                elif progress >= 0.5:
                    proposed = max(1.0, proposed * 0.75)
                    goal_note = f"75% (P&L ${today_pnl:.2f} = {progress:.0%} of ${target:.0f} target)"

        # Pick a contract plugin honouring the company's tier + agent's
        # allowed_contract_types. Returns None when neither MULTUP/DOWN
        # nor CALL/PUT is allowed — we skip the intent rather than fall
        # back to something the operator didn't sanction.
        plugin = pick_for_direction(
            direction=direction,
            company_tier=int(agent["current_asset_tier"] or 1),
            company_unlocked=list(agent["unlocked_contract_types"] or []),
            agent_allowed=list(agent["allowed_contract_types"] or []),
        )
        if plugin is None:
            log.info(
                "no allowed contract for agent=%s direction=%s tier=%s",
                agent["name"], direction, agent["current_asset_tier"],
            )
            return
        payoff = float(agent["min_payoff_ratio"])
        stop_pct = DEFAULT_STOP_PCT
        params = plugin.build(
            direction=direction,
            proposed_stake_usd=proposed,
            last_price=last_price,
            stop_pct=stop_pct,
            payoff_ratio=payoff,
            asset=asset,
            multiplier_default=SYMBOL_MULTIPLIER.get(asset, DEFAULT_MULTIPLIER),
            target_holding_secs=int(agent["target_holding_secs"] or 600),
        )
        contract_type = params.contract_type
        multiplier = params.multiplier or 0
        stop = params.stop_loss if params.stop_loss is not None else last_price
        target = params.take_profit if params.take_profit is not None else last_price
        duration_secs = params.duration_secs or int(agent["target_holding_secs"] or 600)

        # ── Trade-selection-mode gate (PLAN §7) ─────────────────────────
        # EV in USD using the per-signal confidence as a win-probability
        # proxy: EV = p·stake·(payoff−1) − (1−p)·stake. EV gating threshold
        # is a per-agent constant derived from allocation/Kelly so it scales
        # sensibly with account size.
        ev_usd = float(confidence) * float(proposed) * (payoff - 1) - (1 - float(confidence)) * float(proposed)
        ev_threshold_usd = max(0.25, allocation * kelly * 0.05)
        mode = agent["trade_selection_mode"] or "balanced"
        allowed_combos = agent["allowed_combinations"]
        if isinstance(allowed_combos, str):
            allowed_combos = json.loads(allowed_combos)
        # The strategy that actually fired is the one whose verdict matched
        # the forecast direction — surface it on the intent.
        triggering_strategy = outcome.triggering.name if outcome.triggering else (
            strategy_names[0] if strategy_names else None
        )
        accept, mode_reason = evaluate_mode(
            mode,
            allowed_combinations=allowed_combos or [],
            strategy=triggering_strategy,
            asset=asset,
            contract=contract_type,
            ev_usd=ev_usd,
            ev_threshold_usd=ev_threshold_usd,
            forecast=fc.get("forecast"),
            direction=direction,
            stop_loss=stop,
            confidence=confidence,
        )
        if not accept:
            log.info(
                "intent rejected by mode '%s' agent=%s asset=%s: %s",
                mode, agent["name"], asset, mode_reason,
            )
            return

        model = fc.get("model")
        rationale = (
            f"{agent['name']} ({', '.join(strategy_names)}): {model} says {direction} "
            f"with confidence {confidence:.2f} (floor {float(agent['min_confidence_threshold']):.2f}). "
            f"Stake sized via Kelly {kelly:.2f} × allocation × confidence. "
            f"Mode={mode}: {mode_reason}."
        )

        # Snapshot the decision inputs so the postmortem is accurate even if
        # the agent is reconfigured later (PLAN §13.11 entry trace).
        entry_context = {
            "agent": {
                "name": agent["name"],
                "personality": agent["personality"],
                "strategies": strategy_names,
                "kelly_fraction": kelly,
                "min_confidence_threshold": float(agent["min_confidence_threshold"]),
                "min_payoff_ratio": payoff,
                "allocated_balance_usd": allocation,
            },
            "forecast": {
                "model": fc.get("model"),
                "asof_ts": int(fc["asof_ts"]),
                "direction": direction,
                # `confidence` is the calibrated value used for gating
                # and sizing. `raw_confidence` is what the forecaster
                # actually returned. We keep both so postmortems can
                # show "the model said 65%, calibrator mapped that to
                # 51%, the agent's floor is 0.50 so we still traded".
                "confidence": confidence,
                "raw_confidence": raw_confidence,
                "calibrated": abs(confidence - raw_confidence) > 1e-9,
                "last_price": last_price,
                "horizon_steps": fc.get("horizon_steps"),
            },
            "sizing": {
                "method": "fractional_kelly_x_confidence",
                "proposed_stake_usd": round(proposed, 4),
                "multiplier": multiplier,
                # When non-null, the CEO's daily profit target trimmed the
                # stake. Useful in the postmortem: "we sized small here
                # because we were already up 80% of target".
                "goal_throttle": goal_note,
            },
            "selection_mode": {
                "mode": mode,
                "strategy": triggering_strategy,
                "ev_usd": round(ev_usd, 4),
                "ev_threshold_usd": round(ev_threshold_usd, 4),
                "accepted": True,
                "reason": mode_reason,
            },
            "strategy": {
                "triggering": triggering_strategy,
                "score": outcome.triggering.score if outcome.triggering else 0.0,
                "reason": outcome.reason,
                "verdicts": [
                    {"name": v.name, "verdict": v.verdict, "score": v.score, "reason": v.reason}
                    for v in outcome.verdicts
                ],
            },
        }

        async with acquire() as conn:
            async with conn.transaction():
                verdict = await risk_evaluate(
                    conn,
                    company_id=agent["company_id"],
                    agent_id=agent["id"],
                    asset=asset,
                    contract_type=contract_type,
                    proposed_stake_usd=proposed,
                    confidence=confidence,
                    stop_loss=stop,
                )

                stake = verdict.applied_stake_usd or proposed
                # Status routing per trade_mode
                trade_mode = agent["trade_mode"]
                if not verdict.ok:
                    status = "rejected_by_risk"
                    expires_at = None
                elif trade_mode == "autonomous":
                    status = "auto_approved"
                    expires_at = None
                elif trade_mode == "approve_above_threshold":
                    if stake < APPROVE_THRESHOLD_USD:
                        status = "auto_approved"
                        expires_at = None
                    else:
                        status = "pending_approval"
                        expires_at = await conn.fetchval(
                            "SELECT now() + make_interval(secs => $1)",
                            APPROVE_WINDOW_SECS,
                        )
                else:  # approve_each (default)
                    status = "pending_approval"
                    expires_at = await conn.fetchval(
                        "SELECT now() + interval '%s seconds'" % APPROVE_WINDOW_SECS
                    )

                # Proper EV (both legs): p·stake·(payoff−1) − (1−p)·stake.
                # We re-compute against the post-risk applied stake.
                ev = float(confidence) * stake * (payoff - 1) - (1 - float(confidence)) * stake
                from datetime import datetime, timezone
                asof_ts = datetime.fromtimestamp(int(fc["asof_ts"]), tz=timezone.utc)

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
                    agent["company_id"], agent["id"],
                    asset, contract_type, direction,
                    stake, multiplier, duration_secs,
                    last_price, stop, target,
                    fc.get("model"), asof_ts, confidence,
                    payoff, ev, rationale,
                    status, json.dumps(verdict.as_jsonb()), expires_at,
                    json.dumps(entry_context),
                )
                log.info(
                    "intent %s · %s %s %s stake=%.2f conf=%.2f → %s",
                    agent["name"], asset, contract_type, direction,
                    stake, confidence, status,
                )

                # Autonomous-mode intents skip the approval queue — publish
                # straight to the order router.
                if status == "auto_approved":
                    await bus.publish_approved_intent(conn, intent_id)


# Module-level singleton — owned by the FastAPI lifespan in main.py.
decision_loop: DecisionLoop | None = None


async def start_decision_loop() -> None:
    global decision_loop
    if decision_loop is None:
        decision_loop = DecisionLoop()
    await decision_loop.start()


async def stop_decision_loop() -> None:
    if decision_loop is not None:
        await decision_loop.stop()
