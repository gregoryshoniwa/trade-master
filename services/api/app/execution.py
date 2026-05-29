"""Execution consumer.

Subscribes to the gateway's execution events and reconciles them into
trade_intents:

  trades.executed.{company}  → status executed | failed_execution,
                               broker_contract_id, buy_price, longcode
  trades.closed.{company}    → realized_pnl_usd, exit_reason, closed_at,
                               status 'executed' stays (closed is a
                               sub-state captured by closed_at)
"""

from __future__ import annotations

import asyncio
import json
import logging
from uuid import UUID

from nats.aio.msg import Msg

from app import bus, postmortem
from app.db import acquire

log = logging.getLogger("trademaster.execution")

_subs = []


async def start() -> None:
    nc = bus.nc()
    if nc is None:
        log.warning("execution consumer: no nats connection")
        return
    _subs.append(await nc.subscribe("trades.executed.>", cb=_on_executed))
    _subs.append(await nc.subscribe("trades.closed.>", cb=_on_closed))
    log.info("execution consumer subscribed to trades.executed.> + trades.closed.>")


async def stop() -> None:
    for s in _subs:
        try:
            await s.unsubscribe()
        except Exception:
            pass
    _subs.clear()


async def _on_executed(msg: Msg) -> None:
    try:
        ev = json.loads(msg.data)
    except Exception:
        return
    intent_id = ev.get("intent_id")
    if not intent_id:
        return
    try:
        async with acquire() as conn:
            if ev.get("ok"):
                await conn.execute(
                    """
                    UPDATE trade_intents
                    SET status = 'executed',
                        broker_contract_id = $2,
                        buy_price_usd = $3,
                        buy_transaction_id = $4,
                        longcode = $5,
                        executed_at = now()
                    WHERE id = $1 AND status IN ('approved','auto_approved')
                    """,
                    intent_id,
                    str(ev.get("contract_id")) if ev.get("contract_id") else None,
                    ev.get("buy_price"),
                    ev.get("transaction_id"),
                    ev.get("longcode"),
                )
                log.info("intent %s executed contract=%s", intent_id, ev.get("contract_id"))
            else:
                await conn.execute(
                    """
                    UPDATE trade_intents
                    SET status = 'failed_execution',
                        execution_error = $2
                    WHERE id = $1 AND status IN ('approved','auto_approved')
                    """,
                    intent_id, ev.get("error", "unknown"),
                )
                log.warning("intent %s execution failed: %s", intent_id, ev.get("error"))
    except Exception:
        log.exception("execution consumer _on_executed failed")


async def _on_closed(msg: Msg) -> None:
    try:
        ev = json.loads(msg.data)
    except Exception:
        return
    intent_id = ev.get("intent_id")
    if not intent_id:
        return
    pnl = ev.get("realized_pnl_usd")
    try:
        async with acquire() as conn:
            # Guard on closed_at IS NULL so a re-delivered close event doesn't
            # re-stamp the row or fire a second postmortem.
            res = await conn.execute(
                """
                UPDATE trade_intents
                SET realized_pnl_usd = $2,
                    exit_reason = $3,
                    closed_at = now()
                WHERE id = $1 AND closed_at IS NULL
                """,
                intent_id, pnl, ev.get("exit_reason"),
            )
            log.info(
                "intent %s closed pnl=%s reason=%s",
                intent_id, pnl, ev.get("exit_reason"),
            )
            # Cooling-off bookkeeping. We only count this once per intent
            # (we're inside the same idempotent "if we won the close race"
            # block). A win resets the streak; a loss bumps it; on threshold
            # we flip the agent into a cooling-off window.
            if not res.endswith(" 0") and pnl is not None:
                await _apply_cooling_off(conn, UUID(intent_id), float(pnl))
        # Only the delivery that actually closed the intent generates the
        # postmortem. Run it detached — it makes an LLM call for the narrative
        # and must not block the NATS callback.
        if not res.endswith(" 0"):
            asyncio.create_task(postmortem.generate(UUID(intent_id)))
    except Exception:
        log.exception("execution consumer _on_closed failed")


# Cooling-off: after `LOSS_STREAK_LIMIT` consecutive losses the agent gets
# put on ice for `COOLING_OFF_MINUTES`. Counter resets on the next win.
# Keeps a single bad afternoon from blowing through the budget — the
# 11-check Risk Agent already filters individual trades; this catches the
# "many small individually-OK trades, all losing" failure mode.
LOSS_STREAK_LIMIT = 3
COOLING_OFF_MINUTES = 30


async def _apply_cooling_off(conn, intent_id: UUID, pnl: float) -> None:
    agent_id = await conn.fetchval(
        "SELECT agent_id FROM trade_intents WHERE id = $1", intent_id,
    )
    if agent_id is None:
        return
    if pnl > 0:
        # Win — reset the streak. Leave cooling_off_until alone; if the
        # agent's already cooling off we don't shorten it on a fluke win.
        await conn.execute(
            """
            UPDATE agents
            SET cooling_off_loss_streak = 0, last_outcome_at = now()
            WHERE id = $1
            """,
            agent_id,
        )
        return

    # Loss (or breakeven counts as a loss for the streak — pnl<=0 above
    # `if pnl > 0` is the else branch).
    new_streak = await conn.fetchval(
        """
        UPDATE agents
        SET cooling_off_loss_streak = cooling_off_loss_streak + 1,
            last_outcome_at = now()
        WHERE id = $1
        RETURNING cooling_off_loss_streak
        """,
        agent_id,
    )
    if new_streak and new_streak >= LOSS_STREAK_LIMIT:
        await conn.execute(
            f"""
            UPDATE agents
            SET cooling_off_until = now() + interval '{COOLING_OFF_MINUTES} minutes',
                cooling_off_loss_streak = 0
            WHERE id = $1
            """,
            agent_id,
        )
        log.warning(
            "agent %s entering cooling-off for %dm after %d-loss streak",
            agent_id, COOLING_OFF_MINUTES, new_streak,
        )
