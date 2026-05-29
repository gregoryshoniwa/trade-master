"""Profit sweep job (PLAN §6).

Once an hour we walk every active agent. For each one we look at the
realized P&L over a rolling window (default: last 7 days), and if it
exceeds a sweep threshold (default: 50% of allocation), we move a
fraction of that profit (default: 25%) into the company's insurance pot
and decrement the agent's allocation by the same amount.

The point is to lock in gains an agent has already earned so a single
bad streak can't give them all back. The plan calls this "profit sweep
+ insurance fund" — same idea as a bank's reserve requirement.

Sweeps are idempotent: we only sweep what's *above* the threshold, so
re-running the job within an hour just no-ops. Every sweep is logged in
the `profit_sweeps` table with the snapshot context the audit needs.
"""

from __future__ import annotations

import asyncio
import logging

from app.db import acquire

log = logging.getLogger("trademaster.sweep")

# Defaults — chosen to be conservative for paper-mode. Tunable per-company
# later (would land as columns on the `companies` table).
SWEEP_INTERVAL_SECS = 60 * 60               # 1 hour
SWEEP_WINDOW_HOURS = 7 * 24                 # last 7 days of realized P&L
SWEEP_THRESHOLD_PCT_OF_ALLOC = 0.50         # only sweep above +50% on allocation
SWEEP_FRACTION_OF_EXCESS = 0.25             # move 25% of the excess to insurance
MIN_SWEEP_USD = 1.0                         # don't bother with sub-dollar moves

_task: asyncio.Task | None = None


async def start() -> None:
    global _task
    if _task is not None:
        return
    _task = asyncio.create_task(_loop(), name="profit-sweep")
    log.info(
        "profit sweep loop started — interval=%ss window=%sh threshold=%.0f%% take=%.0f%%",
        SWEEP_INTERVAL_SECS, SWEEP_WINDOW_HOURS,
        SWEEP_THRESHOLD_PCT_OF_ALLOC * 100, SWEEP_FRACTION_OF_EXCESS * 100,
    )


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
    # Slight head-start so we don't fire on a cold boot. Sweep is a
    # safety net; not running for the first minute doesn't matter.
    await asyncio.sleep(30)
    while True:
        try:
            n = await _sweep_once()
            if n:
                log.info("swept profits from %d agents", n)
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("profit sweep pass failed; will retry")
        await asyncio.sleep(SWEEP_INTERVAL_SECS)


async def _sweep_once() -> int:
    """One pass. Returns number of agents we swept."""
    swept = 0
    async with acquire() as conn:
        # Window-realized P&L per agent. NULLs become 0 so brand-new
        # agents with no closes don't get singled out.
        rows = await conn.fetch(
            f"""
            SELECT a.id, a.company_id, a.name, a.allocated_balance_usd,
                   COALESCE(SUM(p.pnl_usd) FILTER (
                     WHERE p.generated_at > now() - interval '{SWEEP_WINDOW_HOURS} hours'
                   ), 0) AS window_pnl
            FROM agents a
            LEFT JOIN trade_postmortems p ON p.agent_id = a.id
            WHERE a.role = 'employee'
              AND a.is_active = TRUE
            GROUP BY a.id, a.company_id, a.name, a.allocated_balance_usd
            """,
        )

        for r in rows:
            alloc = float(r["allocated_balance_usd"] or 0.0)
            pnl = float(r["window_pnl"] or 0.0)
            if alloc <= 0 or pnl <= 0:
                continue

            threshold = alloc * SWEEP_THRESHOLD_PCT_OF_ALLOC
            if pnl < threshold:
                continue

            excess = pnl - threshold
            sweep_amount = round(excess * SWEEP_FRACTION_OF_EXCESS, 4)
            if sweep_amount < MIN_SWEEP_USD:
                continue

            reason = (
                f"window P&L ${pnl:.2f} > {SWEEP_THRESHOLD_PCT_OF_ALLOC*100:.0f}% "
                f"of ${alloc:.2f} alloc; sweeping {SWEEP_FRACTION_OF_EXCESS*100:.0f}% of excess"
            )

            async with conn.transaction():
                # The three writes have to happen together so we don't
                # split the books: insurance up, allocation down,
                # audit row written.
                await conn.execute(
                    "UPDATE companies SET insurance_balance_usd = insurance_balance_usd + $2 WHERE id = $1",
                    r["company_id"], sweep_amount,
                )
                await conn.execute(
                    "UPDATE agents SET allocated_balance_usd = allocated_balance_usd - $2, updated_at = now() WHERE id = $1",
                    r["id"], sweep_amount,
                )
                await conn.execute(
                    """
                    INSERT INTO profit_sweeps
                        (company_id, agent_id, amount_usd,
                         window_realized_pnl_usd, allocation_usd, reason)
                    VALUES ($1, $2, $3, $4, $5, $6)
                    """,
                    r["company_id"], r["id"], sweep_amount,
                    pnl, alloc, reason,
                )

            log.info(
                "sweep agent=%s amount=$%.2f → insurance (window P&L $%.2f / alloc $%.2f)",
                r["name"], sweep_amount, pnl, alloc,
            )
            swept += 1

    return swept
