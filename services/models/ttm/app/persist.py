"""Persist backtest results directly into the api's `backtest_runs` table.

Why this lives in the model service rather than the api: the api process
restarts every time we ship a feature, and a Kronos run takes hours. If
the api owned the lifecycle (which it used to), every rebuild killed the
run and the orphan reaper marked it failed. Letting the model service
finish on its own clock and just stamp the row when it's done makes the
run robust to api churn.

The api still owns row creation + initial status. We only flip
running → done / failed and stamp the result columns.
"""

from __future__ import annotations

import datetime as dt
import json
import logging
import os
from uuid import UUID

import asyncpg

log = logging.getLogger("trademaster.ttm.persist")


async def mark_running(run_id: UUID) -> None:
    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        log.warning("DATABASE_URL not set; skipping mark_running for %s", run_id)
        return
    try:
        conn = await asyncpg.connect(db_url)
        try:
            await conn.execute(
                """
                UPDATE backtest_runs
                SET status = 'running', started_at = $2
                WHERE id = $1 AND status IN ('pending', 'running')
                """,
                run_id, dt.datetime.now(tz=dt.timezone.utc),
            )
        finally:
            await conn.close()
    except Exception:
        log.exception("mark_running failed for %s", run_id)


async def mark_done(run_id: UUID, started_at: dt.datetime, result: dict) -> None:
    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        log.warning("DATABASE_URL not set; skipping mark_done for %s", run_id)
        return
    summary = result.get("summary") or {}
    finished = dt.datetime.now(tz=dt.timezone.utc)
    duration = int((finished - started_at).total_seconds())
    try:
        conn = await asyncpg.connect(db_url)
        try:
            await conn.execute(
                """
                UPDATE backtest_runs SET
                    status = 'done',
                    result_json = $2::jsonb,
                    n_forecasts = $3,
                    overall_hit_rate = $4,
                    overall_brier = $5,
                    overall_pnl_pct = $6,
                    finished_at = $7,
                    duration_secs = $8
                WHERE id = $1
                """,
                run_id, json.dumps(result),
                summary.get("n_forecasts"),
                summary.get("overall_hit_rate"),
                summary.get("overall_brier"),
                summary.get("overall_pnl_pct"),
                finished, duration,
            )
        finally:
            await conn.close()
    except Exception:
        log.exception("mark_done failed for %s", run_id)


async def mark_failed(run_id: UUID, reason: str) -> None:
    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        log.warning("DATABASE_URL not set; skipping mark_failed for %s", run_id)
        return
    try:
        conn = await asyncpg.connect(db_url)
        try:
            await conn.execute(
                """
                UPDATE backtest_runs SET
                    status = 'failed',
                    error_message = $2,
                    finished_at = now(),
                    duration_secs = EXTRACT(EPOCH FROM (now() - COALESCE(started_at, created_at)))::int
                WHERE id = $1
                """,
                run_id, reason[:500],
            )
        finally:
            await conn.close()
    except Exception:
        log.exception("mark_failed failed for %s", run_id)
