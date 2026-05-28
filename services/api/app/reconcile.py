"""Trade-close reconciliation.

When a multiplier contract settles on Deriv, the gateway's
proposal_open_contract subscription should fire and publish trades.closed.>.
That works while the gateway is up — but a gateway restart kills every
TrackContract goroutine, so any contract that settles AFTER the restart
goes unreported. Result: trade_intents.closed_at stays NULL, attribution
shows no rows, and the open-positions panel keeps surfacing trades the
user closed hours ago.

This loop closes the gap. Every 60s it:

 1. lists executed trade_intents missing closed_at,
 2. pulls a page of Deriv `statement` (via the existing NATS RPC) and
    indexes sell rows by contract_id,
 3. for any matching contract, computes pnl = sell.amount - buy_price_usd
    and publishes a synthetic trades.closed.{company} event — which
    flows through execution._on_closed exactly like a fresh broker push.

Idempotent: execution._on_closed guards on `closed_at IS NULL`, so a
second push for the same contract is a no-op.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any
from uuid import UUID

from app import bus
from app.db import acquire

log = logging.getLogger("trademaster.reconcile")

_task: asyncio.Task | None = None
_INTERVAL_SECS = 60
_STATEMENT_PAGE = 500  # Deriv's per-call cap
_MAX_PAGES = 50        # ≤25000 transactions; survives multi-day outages


async def start() -> None:
    global _task
    if _task is not None:
        return
    _task = asyncio.create_task(_loop(), name="trade-reconcile")
    log.info("trade reconcile loop started (interval=%ss)", _INTERVAL_SECS)


async def stop() -> None:
    global _task
    if _task is None:
        return
    _task.cancel()
    try:
        await _task
    except (asyncio.CancelledError, Exception):
        pass
    _task = None


async def _loop() -> None:
    # First pass at startup catches anything that drifted while the api
    # was down. Subsequent passes ride the timer.
    await asyncio.sleep(5)
    while True:
        try:
            n = await _reconcile_once()
            if n:
                log.info("reconciled %d unclosed intents", n)
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("reconcile pass failed; will retry")
        await asyncio.sleep(_INTERVAL_SECS)


async def _reconcile_once() -> int:
    # 1. Unclosed executed intents with a broker contract id. Cap at 500 —
    #    that's the statement page size, so we can't reconcile more in one
    #    call anyway; the next tick picks up the rest.
    async with acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT id, company_id, broker_contract_id, buy_price_usd, executed_at
            FROM trade_intents
            WHERE status = 'executed'
              AND closed_at IS NULL
              AND broker_contract_id IS NOT NULL
            ORDER BY executed_at DESC
            LIMIT $1
            """,
            _STATEMENT_PAGE,
        )
    if not rows:
        return 0

    nc = bus.nc()
    if nc is None:
        log.debug("reconcile: no nats connection")
        return 0

    # 2. Walk Deriv statement pages newest-first, indexing sells by
    #    contract_id, until we've matched every open intent, hit the page
    #    cap, or walked past the oldest unclosed intent's executed_at
    #    (anything older has no possible match). The cutoff is the cheap
    #    termination criterion — without it, a single yesterday-stuck
    #    intent would force a 25k-row scan every minute forever.
    oldest_executed = min(r["executed_at"] for r in rows if r["executed_at"]) if any(r["executed_at"] for r in rows) else None
    cutoff_ts = (oldest_executed.timestamp() - 60) if oldest_executed else 0
    open_contract_ids = {str(r["broker_contract_id"]) for r in rows}
    sells_by_contract: dict[str, dict[str, Any]] = {}
    for page in range(_MAX_PAGES):
        if not open_contract_ids:
            break
        payload = json.dumps({
            "limit": _STATEMENT_PAGE, "offset": page * _STATEMENT_PAGE,
        }).encode()
        try:
            reply = await nc.request("deriv.statement.req", payload, timeout=30)
        except asyncio.TimeoutError:
            log.warning("reconcile: statement RPC timed out at page %s", page)
            break
        statement = json.loads(reply.data)
        if "error" in statement:
            log.warning("reconcile: statement err at page %s: %s", page, statement["error"])
            break
        txs = statement.get("transactions") or []
        if not txs:
            break
        page_oldest_ts = txs[-1].get("transaction_time") or 0
        for t in txs:
            if t.get("action_type") == "sell" and t.get("contract_id"):
                cid = str(t["contract_id"])
                if cid in open_contract_ids:
                    sells_by_contract[cid] = t
                    open_contract_ids.discard(cid)
        if cutoff_ts and page_oldest_ts and page_oldest_ts < cutoff_ts:
            break
    if not sells_by_contract:
        return 0

    # 3. For each unclosed intent with a matching sell, publish a synthetic
    #    trades.closed event. _on_closed will write to the DB and trigger a
    #    postmortem, same as a live broker push.
    closed = 0
    for r in rows:
        contract_id = str(r["broker_contract_id"])
        sell = sells_by_contract.get(contract_id)
        if not sell:
            continue
        buy_price = float(r["buy_price_usd"] or 0.0)
        sell_amount = float(sell.get("amount") or 0.0)
        pnl = round(sell_amount - buy_price, 2)
        ev = {
            "intent_id": str(r["id"]),
            "company_id": str(r["company_id"]),
            "contract_id": int(contract_id) if contract_id.isdigit() else 0,
            "realized_pnl_usd": pnl,
            "exit_reason": "reconciled",
            "status": "sold",
        }
        try:
            await nc.publish(
                f"trades.closed.{ev['company_id']}",
                json.dumps(ev).encode(),
            )
            closed += 1
        except Exception:
            log.exception("reconcile: publish failed for intent %s", r["id"])

    return closed
