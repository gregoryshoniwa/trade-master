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

import json
import logging

from nats.aio.msg import Msg

from app import bus
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
    try:
        async with acquire() as conn:
            await conn.execute(
                """
                UPDATE trade_intents
                SET realized_pnl_usd = $2,
                    exit_reason = $3,
                    closed_at = now()
                WHERE id = $1
                """,
                intent_id,
                ev.get("realized_pnl_usd"),
                ev.get("exit_reason"),
            )
            log.info(
                "intent %s closed pnl=%s reason=%s",
                intent_id, ev.get("realized_pnl_usd"), ev.get("exit_reason"),
            )
    except Exception:
        log.exception("execution consumer _on_closed failed")
