"""Shared NATS connection for the api process.

The decision loop, approvals route, and execution consumer all publish/
subscribe through this single connection rather than each opening their
own. Initialized + closed by the FastAPI lifespan.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any
from uuid import UUID

import nats

log = logging.getLogger("trademaster.bus")

_nc: nats.NATS | None = None


async def connect() -> None:
    global _nc
    if _nc is not None:
        return
    url = os.getenv("NATS_URL", "nats://nats:4222")
    try:
        _nc = await nats.connect(
            url,
            name="trademaster-api",
            reconnect_time_wait=2,
            max_reconnect_attempts=-1,
        )
        log.info("api nats connected url=%s", url)
    except Exception:
        log.exception("api nats connect failed (trading + decisions degraded)")


async def close() -> None:
    global _nc
    if _nc is not None:
        try:
            await _nc.drain()
        except Exception:
            pass
        _nc = None


def nc() -> nats.NATS | None:
    return _nc


async def publish_json(subject: str, obj: Any) -> None:
    if _nc is None:
        log.warning("publish skipped (no nats): %s", subject)
        return
    await _nc.publish(subject, json.dumps(obj, default=str).encode())


async def publish_approved_intent(conn, intent_id: UUID) -> None:
    """Load an intent and publish it to trades.approved.{company} so the
    gateway's order router executes it. Call this after an intent reaches
    'approved' or 'auto_approved'."""
    row = await conn.fetchrow(
        """
        SELECT id, client_uuid, company_id, agent_id, asset, contract_type,
               stake_usd, multiplier, duration_secs, expected_payoff_ratio
        FROM trade_intents
        WHERE id = $1
        """,
        intent_id,
    )
    if row is None:
        return
    # Deriv multiplier limit_order takes stop_loss / take_profit as P&L
    # AMOUNTS in account currency (not prices). Give every contract a real
    # broker-enforced exit: stop at half the stake, target at stake ×
    # payoff. Makes the Risk Agent's stop requirement real at the broker
    # and lets contracts settle so realized P&L actually flows.
    stake = float(row["stake_usd"])
    payoff = float(row["expected_payoff_ratio"] or 1.5)
    payload = {
        "intent_id": str(row["id"]),
        "client_uuid": str(row["client_uuid"]),
        "company_id": str(row["company_id"]),
        "agent_id": str(row["agent_id"]),
        "asset": row["asset"],
        "contract_type": row["contract_type"],
        "stake_usd": stake,
        "multiplier": row["multiplier"] or 0,
        "duration_secs": row["duration_secs"],
        "stop_loss_amount": round(stake * 0.5, 2),
        "take_profit_amount": round(stake * payoff, 2),
        "currency": "USD",
    }
    await publish_json(f"trades.approved.{row['company_id']}", payload)
    log.info("published approved intent %s → trades.approved", intent_id)
