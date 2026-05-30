"""Backtest runner — kicks off walk-forward evaluations against the
ttm/kronos services, persists the result, and lets the operator apply
recommendations back to a live agent.

Lifecycle of one run:

 1. `POST /backtests` writes a row with status='pending' and returns it.
    A background task POSTs `/backtest` on the matching model service
    (ttm:8081 or kronos:8082), waits for the result (minutes for Kronos),
    and updates the row to 'done' or 'failed'.

 2. `GET /backtests/{id}` reflects status + result_json. The web polls this.

 3. `POST /backtests/{id}/apply` body `{agent_id, set_min_confidence,
    prune_weak_symbols}` updates the agent's `min_confidence_threshold` to
    the run's recommended floor and/or removes weak symbols from
    `allowed_assets`. Records the action on the run for audit.

The model_key is the same string used everywhere else (agents.forecasting_model,
forecasting registry key): `ttm-granite-r2` or `kronos-base`.
"""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime
from typing import Annotated, Any, Literal
from uuid import UUID

import asyncpg
import httpx
from fastapi import APIRouter, BackgroundTasks, HTTPException, Query, status
from pydantic import BaseModel, Field

from app.auth import CurrentAccount
from app.db import acquire
from app.forecasting.registry import is_known as is_known_forecast

log = logging.getLogger("trademaster.backtests")

router = APIRouter(prefix="/companies/{company_id}", tags=["backtests"])

WRITE_ROLES = {"owner", "admin", "trader"}

# Where each model_key lives on the docker network.
MODEL_ENDPOINTS: dict[str, str] = {
    "ttm-granite-r2": "http://ttm:8081/backtest",
    "kronos-base":    "http://kronos:8082/backtest",
    "tsfm-ensemble":  "http://tsfm:8083/backtest",
}
# Generous deadline. Kronos on CPU is *very* slow (~60s per window with
# sample_count=8). At the form's default density (stride=3, count=5000,
# 5 symbols) one run would take 130+ hours; even with the smarter Kronos
# defaults the form ships, a 5-symbol run is multiple hours. The httpx
# timeout has to outlive that, so we cap at 6h and rely on the form to
# warn the user before they kick off something unreasonable.
BACKTEST_TIMEOUT_SECS = 6 * 60 * 60


# ───────────────────────── schemas ──────────────────────────


class BacktestCreate(BaseModel):
    model_key: str
    symbols: list[str] = Field(min_length=1, max_length=20)
    granularity_secs: int = Field(default=60, ge=30, le=86400)
    bar_count: int = Field(default=5000, ge=200, le=5000)
    horizon: int = Field(default=60, ge=1, le=240)
    stride: int = Field(default=3, ge=1, le=50)
    stop_pct: float = Field(default=0.005, gt=0.0, le=0.10)
    payoff_ratio: float = Field(default=1.5, ge=1.0, le=10.0)


class BacktestRun(BaseModel):
    id: UUID
    company_id: UUID
    requested_by: UUID
    model_key: str
    symbols: list[str]
    granularity_secs: int
    bar_count: int
    horizon: int
    stride: int
    stop_pct: float
    payoff_ratio: float
    status: Literal["pending", "running", "done", "failed"]
    error_message: str | None
    result_json: dict | None
    n_forecasts: int | None
    overall_hit_rate: float | None
    overall_brier: float | None
    overall_pnl_pct: float | None
    applied_actions: list[dict]
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None
    duration_secs: int | None


class BacktestList(BaseModel):
    runs: list[BacktestRun]


class ApplyAction(BaseModel):
    agent_id: UUID
    set_min_confidence: bool = False
    prune_weak_symbols: bool = False


class ApplyResult(BaseModel):
    run_id: UUID
    agent_id: UUID
    changes: dict[str, Any]


# ───────────────────────── helpers ──────────────────────────


async def _ensure_member(conn: asyncpg.Connection, company_id: UUID, account_id: UUID) -> str:
    role = await conn.fetchval(
        "SELECT role FROM company_members WHERE company_id=$1 AND account_id=$2",
        company_id, account_id,
    )
    if role is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "company not found")
    return role


def _j(v: Any) -> Any:
    return json.loads(v) if isinstance(v, str) else v


def _row(r: asyncpg.Record) -> BacktestRun:
    return BacktestRun(
        id=r["id"], company_id=r["company_id"], requested_by=r["requested_by"],
        model_key=r["model_key"], symbols=list(r["symbols"] or []),
        granularity_secs=r["granularity_secs"], bar_count=r["bar_count"],
        horizon=r["horizon"], stride=r["stride"],
        stop_pct=float(r["stop_pct"]), payoff_ratio=float(r["payoff_ratio"]),
        status=r["status"], error_message=r["error_message"],
        result_json=_j(r["result_json"]),
        n_forecasts=r["n_forecasts"],
        overall_hit_rate=float(r["overall_hit_rate"]) if r["overall_hit_rate"] is not None else None,
        overall_brier=float(r["overall_brier"]) if r["overall_brier"] is not None else None,
        overall_pnl_pct=float(r["overall_pnl_pct"]) if r["overall_pnl_pct"] is not None else None,
        applied_actions=_j(r["applied_actions"]) or [],
        created_at=r["created_at"], started_at=r["started_at"],
        finished_at=r["finished_at"], duration_secs=r["duration_secs"],
    )


# ───────────────────────── runner ──────────────────────────


async def _submit_backtest(run_id: UUID, body: BacktestCreate) -> None:
    """Hand the run off to the model service and return. The model service
    owns the lifecycle from here — it writes `running` → `done`/`failed`
    + the result columns directly to the same backtest_runs row. That
    way an api rebuild (which happens often during dev) doesn't kill an
    in-flight backtest, which was the whole reason the user kept seeing
    `api restarted before run completed`."""
    endpoint = MODEL_ENDPOINTS.get(body.model_key)
    if endpoint is None:
        await _mark_failed(run_id, f"no model endpoint for {body.model_key}")
        return

    payload = {
        "run_id": str(run_id),   # ← tells the model service to own the lifecycle
        "symbols": body.symbols,
        "granularity": body.granularity_secs,
        "count": body.bar_count,
        "horizon": body.horizon,
        "stride": body.stride,
        "stop_pct": body.stop_pct,
        "payoff": body.payoff_ratio,
    }
    # Tight timeout — the model service should ack in seconds. The actual
    # work runs there afterwards.
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.post(endpoint, json=payload)
            if r.status_code >= 400:
                try:
                    detail = r.json().get("detail")
                except Exception:
                    detail = None
                msg = (
                    f"upstream {r.status_code}: " + (
                        json.dumps(detail) if detail is not None else r.text[:300]
                    )
                )
                log.warning("backtest %s rejected by %s — %s", run_id, endpoint, msg)
                await _mark_failed(run_id, msg[:500])
                return
    except Exception as e:
        log.exception("backtest %s submit failed", run_id)
        await _mark_failed(run_id, f"submit failed: {e}"[:500])
        return
    log.info("backtest %s handed off to %s", run_id, endpoint)


async def _mark_failed(run_id: UUID, reason: str) -> None:
    async with acquire() as conn:
        await conn.execute(
            """
            UPDATE backtest_runs SET
                status='failed', error_message=$2,
                finished_at=now(),
                duration_secs = EXTRACT(EPOCH FROM (now() - COALESCE(started_at, created_at)))::int
            WHERE id=$1
            """,
            run_id, reason,
        )


async def reap_orphans() -> None:
    """Mark TRULY-stuck rows as failed. The model service now owns the run
    lifecycle — it writes the row directly when finished — so an api
    restart no longer orphans an in-flight backtest. We only fail rows
    that have been sitting in pending/running for longer than the
    backtest timeout, which means the upstream task itself died (kronos
    crash, the model couldn't start) and there's no one coming back."""
    async with acquire() as conn:
        n = await conn.fetchval(
            f"""
            WITH orphaned AS (
                UPDATE backtest_runs
                SET status = 'failed',
                    error_message = 'model service stopped before run completed',
                    finished_at = now()
                WHERE status IN ('pending', 'running')
                  AND COALESCE(started_at, created_at) < now() - interval '{BACKTEST_TIMEOUT_SECS} seconds'
                RETURNING 1
            )
            SELECT count(*) FROM orphaned
            """,
        )
    if n:
        log.warning("reaped %d backtest runs older than the timeout", n)


# ───────────────────────── routes ──────────────────────────


@router.post("/backtests", response_model=BacktestRun, status_code=status.HTTP_201_CREATED)
async def create_backtest(
    company_id: UUID, account_id: CurrentAccount, body: BacktestCreate,
    bg: BackgroundTasks,
):
    if not is_known_forecast(body.model_key):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"unknown model_key {body.model_key} (see /api/v1/forecasting/models)",
        )
    if body.model_key not in MODEL_ENDPOINTS:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"backtest not wired for {body.model_key} yet",
        )
    async with acquire() as conn:
        role = await _ensure_member(conn, company_id, account_id)
        if role not in WRITE_ROLES:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "insufficient role")
        row = await conn.fetchrow(
            """
            INSERT INTO backtest_runs
                (company_id, requested_by, model_key, symbols,
                 granularity_secs, bar_count, horizon, stride,
                 stop_pct, payoff_ratio)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            RETURNING *
            """,
            company_id, account_id, body.model_key, list(body.symbols),
            body.granularity_secs, body.bar_count, body.horizon, body.stride,
            body.stop_pct, body.payoff_ratio,
        )

    # Spawn the actual work; the request returns now so the UI can render
    # the "running…" row immediately.
    bg.add_task(_submit_backtest, row["id"], body)
    return _row(row)


@router.get("/backtests", response_model=BacktestList)
async def list_backtests(
    company_id: UUID, account_id: CurrentAccount,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
):
    async with acquire() as conn:
        await _ensure_member(conn, company_id, account_id)
        rows = await conn.fetch(
            """
            SELECT * FROM backtest_runs
            WHERE company_id = $1
            ORDER BY created_at DESC
            LIMIT $2
            """,
            company_id, limit,
        )
    return BacktestList(runs=[_row(r) for r in rows])


@router.get("/backtests/{run_id}", response_model=BacktestRun)
async def get_backtest(
    company_id: UUID, run_id: UUID, account_id: CurrentAccount,
):
    async with acquire() as conn:
        await _ensure_member(conn, company_id, account_id)
        row = await conn.fetchrow(
            "SELECT * FROM backtest_runs WHERE id=$1 AND company_id=$2",
            run_id, company_id,
        )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "backtest not found")
    return _row(row)


@router.post("/backtests/{run_id}/apply", response_model=ApplyResult)
async def apply_backtest(
    company_id: UUID, run_id: UUID, account_id: CurrentAccount,
    body: ApplyAction,
):
    """Push recommendations into an agent. Updates only the fields the
    operator opted into — confidence floor and/or asset whitelist."""
    async with acquire() as conn:
        role = await _ensure_member(conn, company_id, account_id)
        if role not in WRITE_ROLES:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "insufficient role")
        run = await conn.fetchrow(
            "SELECT * FROM backtest_runs WHERE id=$1 AND company_id=$2",
            run_id, company_id,
        )
        if run is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "backtest not found")
        if run["status"] != "done":
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f"can't apply a {run['status']} run",
            )
        agent = await conn.fetchrow(
            """
            SELECT id, name, min_confidence_threshold, allowed_assets,
                   forecasting_model
            FROM agents
            WHERE id = $1 AND company_id = $2
            """,
            body.agent_id, company_id,
        )
        if agent is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "agent not found")
        if agent["forecasting_model"] != run["model_key"]:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"agent uses {agent['forecasting_model']} but backtest is "
                f"{run['model_key']} — pick an agent that consumes this model",
            )

        summary = _j(run["result_json"]).get("summary") if run["result_json"] else {}
        changes: dict[str, Any] = {}

        if body.set_min_confidence:
            bf = (summary or {}).get("best_floor")
            if not bf:
                raise HTTPException(
                    status.HTTP_409_CONFLICT,
                    "this run found no confidence floor with edge — nothing to apply",
                )
            new_floor = float(bf["floor"])
            changes["min_confidence_threshold"] = {
                "from": float(agent["min_confidence_threshold"]),
                "to": new_floor,
                "evidence": bf,
            }
            await conn.execute(
                "UPDATE agents SET min_confidence_threshold=$2, updated_at=now() WHERE id=$1",
                agent["id"], new_floor,
            )

        if body.prune_weak_symbols:
            weak = list((summary or {}).get("weak_symbols") or [])
            current = list(agent["allowed_assets"] or [])
            # If the agent has an empty whitelist it means "all" — pruning
            # only makes sense once the list is materialised. Seed it from
            # the run's symbol list minus the weak ones.
            base = current or list(run["symbols"] or [])
            new_assets = [s for s in base if s not in weak]
            if not weak:
                raise HTTPException(
                    status.HTTP_409_CONFLICT,
                    "this run found no clearly-weak symbols — nothing to prune",
                )
            changes["allowed_assets"] = {
                "from": current, "to": new_assets, "pruned": weak,
            }
            await conn.execute(
                "UPDATE agents SET allowed_assets=$2, updated_at=now() WHERE id=$1",
                agent["id"], new_assets,
            )

        if not changes:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "pick at least one of set_min_confidence / prune_weak_symbols",
            )

        action = {
            "agent_id": str(agent["id"]),
            "agent_name": agent["name"],
            "by_account": str(account_id),
            "at": datetime.utcnow().isoformat() + "Z",
            "changes": changes,
        }
        await conn.execute(
            """
            UPDATE backtest_runs
            SET applied_actions = applied_actions || $2::jsonb
            WHERE id = $1
            """,
            run_id, json.dumps([action]),
        )

    return ApplyResult(run_id=run_id, agent_id=agent["id"], changes=changes)
