"""Edge report (PLAN §6).

One question, plain English: **does each agent actually have edge in
live trading, and how does it compare to what their backtest predicted?**

For each employee agent we report — over a rolling window (default 30d):

  - live_n              count of settled trades
  - live_hit_rate       wins / settled
  - live_avg_pnl_usd    mean realized P&L per trade
  - live_total_pnl_usd  sum
  - live_avg_confidence avg `intent.confidence` (was the model bullish?)
  - backtest_hit_rate   most recent finished backtest using this model
                        on overlapping symbols; null if no run exists
  - hit_rate_gap_pp     (live - backtest) × 100, in percentage points
  - verdict             "no edge" / "real edge" / "underperforming vs backtest"

The report lives entirely on top of trade_postmortems + trade_intents +
backtest_runs — no new tables, no schema changes. Just a derivation the
UI page can ask for and render.
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Annotated, Any, Literal
from uuid import UUID

import asyncpg
from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel

from app.auth import CurrentAccount
from app.db import acquire

router = APIRouter(prefix="/companies/{company_id}", tags=["edge"])

Window = Literal["7d", "30d", "90d", "all"]

_WINDOW_SQL: dict[Window, str] = {
    "7d":  "p.generated_at > now() - interval '7 days'",
    "30d": "p.generated_at > now() - interval '30 days'",
    "90d": "p.generated_at > now() - interval '90 days'",
    "all": "TRUE",
}


class AgentEdge(BaseModel):
    agent_id: UUID
    agent_name: str
    forecasting_model: str
    is_active: bool
    is_paused: bool
    live_n: int
    live_wins: int
    live_losses: int
    live_hit_rate: float | None
    live_avg_pnl_usd: float | None
    live_total_pnl_usd: float
    live_avg_confidence: float | None
    backtest_hit_rate: float | None
    backtest_run_id: UUID | None
    backtest_n_forecasts: int | None
    hit_rate_gap_pp: float | None
    verdict: str
    verdict_tone: Literal["bull", "bear", "muted"]
    # ── Calibration (PLAN §11) ──────────────────────────────────────
    # Pulled from the active forecast_calibrators row for this agent's
    # forecasting_model. The Brier/ECE delta is the single best answer
    # to "is the gap between backtest and live just because the model
    # is miscalibrated?". A big improvement means yes.
    calibration_method: Literal["isotonic", "platt"] | None = None
    calibration_n_samples: int | None = None
    calibration_brier_raw: float | None = None
    calibration_brier_calibrated: float | None = None
    calibration_ece_raw: float | None = None
    calibration_ece_calibrated: float | None = None


class EdgeReport(BaseModel):
    window: Window
    generated_at: datetime
    agents: list[AgentEdge]


def _classify(
    live_n: int, live_hit: float | None, live_pnl: float, bt_hit: float | None,
) -> tuple[str, Literal["bull", "bear", "muted"]]:
    """Pick a verdict from the available evidence."""
    if live_n < 10:
        return ("too few trades to call", "muted")
    if live_hit is None:
        return ("no hit-rate yet", "muted")
    if bt_hit is not None and live_hit + 0.03 < bt_hit:
        # Live trailing backtest by more than 3pp — model lost its
        # in-sample edge when it had to live with real fills/spread.
        return ("underperforming vs backtest", "bear")
    if live_hit >= 0.55 and live_pnl > 0:
        return ("real edge", "bull")
    if live_hit < 0.48:
        return ("inverse / no edge", "bear")
    return ("noise — close to coin-flip", "muted")


async def _ensure_member(conn: asyncpg.Connection, company_id: UUID, account_id: UUID) -> None:
    role = await conn.fetchval(
        "SELECT role FROM company_members WHERE company_id=$1 AND account_id=$2",
        company_id, account_id,
    )
    if role is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "company not found")


@router.get("/edge", response_model=EdgeReport)
async def get_edge(
    company_id: UUID, account_id: CurrentAccount,
    window: Annotated[Window, Query()] = "30d",
):
    where = _WINDOW_SQL[window]
    async with acquire() as conn:
        await _ensure_member(conn, company_id, account_id)

        # Per-agent live stats over the window.
        live_rows = await conn.fetch(
            f"""
            SELECT a.id AS agent_id, a.name AS agent_name,
                   a.forecasting_model, a.is_active, a.is_paused,
                   COUNT(p.id) AS n,
                   COUNT(*) FILTER (WHERE p.outcome = 'win')  AS wins,
                   COUNT(*) FILTER (WHERE p.outcome = 'loss') AS losses,
                   COALESCE(SUM(p.pnl_usd), 0) AS total_pnl,
                   AVG(p.pnl_usd) AS avg_pnl,
                   AVG(i.confidence) AS avg_conf
            FROM agents a
            LEFT JOIN trade_postmortems p
                   ON p.agent_id = a.id
                  AND p.company_id = a.company_id
                  AND {where}
            LEFT JOIN trade_intents i ON i.id = p.intent_id
            WHERE a.company_id = $1
              AND a.role = 'employee'
            GROUP BY a.id, a.name, a.forecasting_model, a.is_active, a.is_paused
            ORDER BY a.name
            """,
            company_id,
        )

        # Latest finished backtest per model_key. We pick the most recent
        # one so the comparison reflects the user's current evaluation.
        bt_rows = await conn.fetch(
            """
            SELECT DISTINCT ON (model_key)
                   id, model_key, overall_hit_rate, n_forecasts
            FROM backtest_runs
            WHERE company_id = $1 AND status = 'done'
            ORDER BY model_key, finished_at DESC NULLS LAST
            """,
            company_id,
        )
        bt_by_model: dict[str, dict[str, Any]] = {
            r["model_key"]: {
                "id": r["id"],
                "hit": float(r["overall_hit_rate"]) if r["overall_hit_rate"] is not None else None,
                "n": int(r["n_forecasts"]) if r["n_forecasts"] is not None else None,
            }
            for r in bt_rows
        }

        # Active calibrators by forecasting_model — one row per model
        # because the unique index makes only one active per model.
        cal_rows = await conn.fetch(
            """
            SELECT forecasting_model, method, n_samples,
                   raw_brier, calibrated_brier, raw_ece, calibrated_ece
            FROM forecast_calibrators
            WHERE is_active
            """,
        )
        cal_by_model: dict[str, dict[str, Any]] = {
            r["forecasting_model"]: {
                "method": r["method"],
                "n": int(r["n_samples"]),
                "brier_raw": float(r["raw_brier"]),
                "brier_cal": float(r["calibrated_brier"]),
                "ece_raw": float(r["raw_ece"]),
                "ece_cal": float(r["calibrated_ece"]),
            }
            for r in cal_rows
        }

    agents = []
    for r in live_rows:
        n = int(r["n"])
        wins = int(r["wins"])
        losses = int(r["losses"])
        hit = (wins / n) if n else None
        avg_pnl = float(r["avg_pnl"]) if r["avg_pnl"] is not None else None
        total_pnl = float(r["total_pnl"])
        avg_conf = float(r["avg_conf"]) if r["avg_conf"] is not None else None

        bt = bt_by_model.get(r["forecasting_model"])
        bt_hit = bt["hit"] if bt else None
        gap = ((hit - bt_hit) * 100.0) if (hit is not None and bt_hit is not None) else None
        verdict, tone = _classify(n, hit, total_pnl, bt_hit)

        cal = cal_by_model.get(r["forecasting_model"])

        agents.append(AgentEdge(
            agent_id=r["agent_id"], agent_name=r["agent_name"],
            forecasting_model=r["forecasting_model"],
            is_active=bool(r["is_active"]), is_paused=bool(r["is_paused"]),
            live_n=n, live_wins=wins, live_losses=losses,
            live_hit_rate=hit, live_avg_pnl_usd=avg_pnl,
            live_total_pnl_usd=total_pnl, live_avg_confidence=avg_conf,
            backtest_hit_rate=bt_hit,
            backtest_run_id=bt["id"] if bt else None,
            backtest_n_forecasts=bt["n"] if bt else None,
            hit_rate_gap_pp=gap, verdict=verdict, verdict_tone=tone,
            calibration_method=cal["method"] if cal else None,
            calibration_n_samples=cal["n"] if cal else None,
            calibration_brier_raw=cal["brier_raw"] if cal else None,
            calibration_brier_calibrated=cal["brier_cal"] if cal else None,
            calibration_ece_raw=cal["ece_raw"] if cal else None,
            calibration_ece_calibrated=cal["ece_cal"] if cal else None,
        ))

    return EdgeReport(
        window=window, generated_at=datetime.utcnow(), agents=agents,
    )
