"""Aggression Index + personality detector (PLAN §7.5).

Watches each agent's actual behaviour and writes back two columns:

  - `aggression_index` (0..100)   how risk-on the agent has been
  - `detected_personality` (TEXT) which of the 5 presets it most resembles

The CEO's chosen `personality` is the AGENT'S WILL ("what we told it to
be"). The detected one is the OBSERVED REALITY ("what it's actually doing
in production"). When they disagree the agent's profile page can flag it.

Heuristic — three observable features per agent (over last 30d of
postmortems):

  1. trades_per_day        higher = scalper / lower = sniper or guardian
  2. mean_stake_pct_alloc  higher = sniper or scalper-on-conviction
  3. hit_rate              proxy for selectivity / risk-off

These map to a 100-point Aggression Index, and the index maps to one of
the five PLAN §7.1 presets. Both are intentionally simple — once we have
mode posteriors from the Strategy Agent we can swap this for something
calibrated.
"""

from __future__ import annotations

import asyncio
import logging

from app.db import acquire

log = logging.getLogger("trademaster.personality")

DETECT_INTERVAL_SECS = 6 * 60 * 60   # every 6 hours; trends don't shift faster
WINDOW_DAYS = 30

_task: asyncio.Task | None = None


async def start() -> None:
    global _task
    if _task is not None:
        return
    _task = asyncio.create_task(_loop(), name="personality-detector")
    log.info("personality detector started — interval=%ss window=%dd",
             DETECT_INTERVAL_SECS, WINDOW_DAYS)


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
    await asyncio.sleep(60)  # let the rest of startup settle
    while True:
        try:
            n = await _detect_once()
            if n:
                log.info("personality recomputed for %d agents", n)
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("personality detector pass failed; will retry")
        await asyncio.sleep(DETECT_INTERVAL_SECS)


# ─── scoring ──────────────────────────────────────────────────


def aggression_index(
    *, trades_per_day: float, mean_stake_pct: float, hit_rate: float,
) -> int:
    """Combine three behaviour features into a 0..100 score. Caps each
    input to a sensible range so a single outlier (e.g. 200 trades on one
    chaotic day) can't blow the index out."""
    # Feature 1: trade frequency (0–1). 30+ trades/day caps at 1.0.
    freq = min(1.0, trades_per_day / 30.0)
    # Feature 2: stake as fraction of allocation (0–1). 25%+ caps at 1.0.
    stake = min(1.0, mean_stake_pct / 0.25)
    # Feature 3: lower hit rate = more risk on (less selective).
    # Anchor at 0.5: 50% hit-rate adds nothing, well below means very risk-on.
    risk = max(0.0, min(1.0, (0.5 - hit_rate) * 2.0))

    # Weighted sum. Higher weight on stake — that's the most direct
    # "how much money is on the line per trade" signal.
    score = 100.0 * (0.45 * stake + 0.35 * freq + 0.20 * risk)
    return max(0, min(100, round(score)))


def index_to_personality(index: int) -> str:
    """Map the index back to PLAN §7.1 presets. The bands are wider in
    the middle so most agents (which sit near 50) get tagged "balanced"
    rather than oscillating between adjacent labels each pass."""
    if index < 20:
        return "guardian"
    if index < 40:
        return "hunter"
    if index < 65:
        return "balanced"
    if index < 85:
        return "scalper"
    return "sniper"


# ─── pass ─────────────────────────────────────────────────────


async def _detect_once() -> int:
    async with acquire() as conn:
        rows = await conn.fetch(
            f"""
            SELECT a.id, a.name, a.allocated_balance_usd, a.personality,
                   COUNT(p.id)               AS n,
                   COUNT(*) FILTER (WHERE p.outcome = 'win') AS wins,
                   AVG(i.stake_usd)          AS avg_stake,
                   EXTRACT(EPOCH FROM (now() - MIN(p.generated_at))) AS span_secs
            FROM agents a
            LEFT JOIN trade_postmortems p
                   ON p.agent_id = a.id
                  AND p.company_id = a.company_id
                  AND p.generated_at > now() - interval '{WINDOW_DAYS} days'
            LEFT JOIN trade_intents i ON i.id = p.intent_id
            WHERE a.role = 'employee' AND a.is_active = TRUE
            GROUP BY a.id, a.name, a.allocated_balance_usd, a.personality
            """,
        )
        touched = 0
        for r in rows:
            n = int(r["n"])
            if n < 5:
                # Not enough data to call. Leave whatever's already on
                # the row so we don't blink the dashboard between empty
                # and detected each pass.
                continue
            alloc = float(r["allocated_balance_usd"] or 0.0)
            avg_stake = float(r["avg_stake"] or 0.0)
            span = float(r["span_secs"] or 0.0)
            days = max(1.0, span / 86400.0)
            trades_per_day = n / days
            hit_rate = int(r["wins"]) / n
            mean_stake_pct = (avg_stake / alloc) if alloc > 0 else 0.0

            idx = aggression_index(
                trades_per_day=trades_per_day,
                mean_stake_pct=mean_stake_pct,
                hit_rate=hit_rate,
            )
            detected = index_to_personality(idx)

            await conn.execute(
                """
                UPDATE agents SET
                    aggression_index = $2,
                    detected_personality = $3,
                    updated_at = now()
                WHERE id = $1
                """,
                r["id"], idx, detected,
            )
            touched += 1
            log.info(
                "agent %s: AI=%d → %s (configured: %s) · n=%d/%s d · "
                "stake=%.1f%% alloc · hit=%.0f%%",
                r["name"], idx, detected, r["personality"],
                n, f"{days:.1f}", mean_stake_pct * 100, hit_rate * 100,
            )

    return touched
