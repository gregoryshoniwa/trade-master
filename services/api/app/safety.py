"""Safety background tasks (PLAN §22 / Phase 7 basics).

Two periodic checks:

  Circuit breaker (every 60s): for each company with a daily_loss_limit_usd
  set, if today's realized loss exceeds the limit, flip kill_switch_active=
  TRUE with reason="circuit breaker: …". The risk agent then blocks all
  new intents for that company until an admin clears the switch.

  Auto-pause (every 5 min): for each active+unpaused agent, compute
  realized P&L over the rolling last 24h from trade_postmortems. If the
  loss is ≥ max_daily_drawdown_pct × allocated_balance_usd, set is_paused
  with reason="auto-pause: drawdown". Operator must review + unpause.

Both are best-effort; an exception logs and the loop keeps running.
"""

from __future__ import annotations

import asyncio
import logging

from app.db import acquire

log = logging.getLogger("trademaster.safety")

CIRCUIT_INTERVAL_SECS = 60
AUTO_PAUSE_INTERVAL_SECS = 5 * 60

_task: asyncio.Task | None = None
_stop = asyncio.Event()


async def check_circuit_breakers() -> int:
    """Trip the kill switch for any company whose daily realized loss has
    exceeded its configured daily_loss_limit_usd. Returns the number of
    companies tripped this cycle."""
    tripped = 0
    try:
        async with acquire() as conn:
            rows = await conn.fetch(
                """
                WITH today_pnl AS (
                    SELECT company_id, COALESCE(sum(pnl_usd), 0) AS pnl
                    FROM trade_postmortems
                    WHERE generated_at >= date_trunc('day', now())
                    GROUP BY company_id
                )
                SELECT c.id, c.name, c.daily_loss_limit_usd, COALESCE(p.pnl, 0) AS today_pnl
                FROM companies c
                LEFT JOIN today_pnl p ON p.company_id = c.id
                WHERE c.kill_switch_active = FALSE
                  AND c.daily_loss_limit_usd IS NOT NULL
                  AND -COALESCE(p.pnl, 0) >= c.daily_loss_limit_usd
                """,
            )
            for r in rows:
                reason = (
                    f"circuit breaker: realized loss "
                    f"${-float(r['today_pnl']):.2f} >= limit "
                    f"${float(r['daily_loss_limit_usd']):.2f}"
                )
                await conn.execute(
                    """
                    UPDATE companies
                    SET kill_switch_active = TRUE,
                        kill_switch_reason = $2,
                        kill_switch_at = now()
                    WHERE id = $1
                    """,
                    r["id"], reason,
                )
                tripped += 1
                log.warning("CIRCUIT BREAKER tripped for company=%s: %s", r["name"], reason)
    except Exception:
        log.exception("circuit breaker check failed; will retry")
    return tripped


async def check_auto_pause() -> int:
    """Pause any active+unpaused agent whose rolling 24h realized loss
    exceeds max_daily_drawdown_pct × allocated_balance_usd. Returns the
    number of agents paused this cycle."""
    paused = 0
    try:
        async with acquire() as conn:
            rows = await conn.fetch(
                """
                WITH agent_pnl AS (
                    SELECT agent_id, COALESCE(sum(pnl_usd), 0) AS pnl
                    FROM trade_postmortems
                    WHERE generated_at >= now() - interval '24 hours'
                    GROUP BY agent_id
                )
                SELECT a.id, a.name, a.allocated_balance_usd,
                       a.max_daily_drawdown_pct, COALESCE(p.pnl, 0) AS pnl_24h
                FROM agents a
                LEFT JOIN agent_pnl p ON p.agent_id = a.id
                WHERE a.is_active = TRUE
                  AND a.is_paused = FALSE
                  AND a.allocated_balance_usd > 0
                  AND -COALESCE(p.pnl, 0) >=
                      (a.max_daily_drawdown_pct / 100.0) * a.allocated_balance_usd
                """,
            )
            for r in rows:
                limit = (float(r["max_daily_drawdown_pct"]) / 100.0) * float(r["allocated_balance_usd"])
                reason = (
                    f"auto-pause: 24h realized loss "
                    f"${-float(r['pnl_24h']):.2f} >= drawdown limit ${limit:.2f}"
                )
                await conn.execute(
                    """
                    UPDATE agents
                    SET is_paused = TRUE, pause_reason = $2
                    WHERE id = $1
                    """,
                    r["id"], reason,
                )
                paused += 1
                log.warning("AUTO-PAUSE agent=%s: %s", r["name"], reason)
    except Exception:
        log.exception("auto-pause check failed; will retry")
    return paused


async def _loop() -> None:
    """Two-stride scheduler: circuit-breaker every 60s, auto-pause every
    5 min. We share one task so it's easy to start/stop in main.py."""
    last_pause = 0.0
    while not _stop.is_set():
        await check_circuit_breakers()
        loop = asyncio.get_event_loop()
        if loop.time() - last_pause >= AUTO_PAUSE_INTERVAL_SECS:
            await check_auto_pause()
            last_pause = loop.time()
        try:
            await asyncio.wait_for(_stop.wait(), timeout=CIRCUIT_INTERVAL_SECS)
        except asyncio.TimeoutError:
            pass


async def start() -> None:
    global _task
    if _task is not None:
        return
    _stop.clear()
    _task = asyncio.create_task(_loop())
    log.info(
        "safety monitor started (circuit %ds, auto-pause %ds)",
        CIRCUIT_INTERVAL_SECS, AUTO_PAUSE_INTERVAL_SECS,
    )


async def stop() -> None:
    global _task
    if _task is None:
        return
    _stop.set()
    try:
        await asyncio.wait_for(_task, timeout=5.0)
    except asyncio.TimeoutError:
        _task.cancel()
    _task = None
