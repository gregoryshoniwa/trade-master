"""Forecast calibration read endpoints (PLAN §11).

Surfaces the active isotonic calibrator per forecasting_model — its
reliability metrics (Brier / ECE), the (raw → calibrated) breakpoint
table for plotting, and when it was last fit. Mounted under
`/companies/{cid}/...` for symmetry with the rest of the app even
though calibrators are global per model."""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any
from uuid import UUID

import asyncpg
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from app.auth import CurrentAccount
from app.db import acquire

router = APIRouter(prefix="/companies/{company_id}", tags=["calibration"])


class CalibratorPoint(BaseModel):
    x: float
    y: float


class CalibratorStatus(BaseModel):
    forecasting_model: str
    fitted_at: datetime | None
    window_days: int | None
    n_samples: int
    method: str | None
    raw_brier: float | None
    calibrated_brier: float | None
    raw_ece: float | None
    calibrated_ece: float | None
    artifact: list[CalibratorPoint]
    state: str  # 'calibrated' | 'insufficient_data' | 'never_fit'
    min_samples_required: int


async def _ensure_member(conn: asyncpg.Connection, company_id: UUID, account_id: UUID) -> None:
    role = await conn.fetchval(
        "SELECT role FROM company_members WHERE company_id=$1 AND account_id=$2",
        company_id, account_id,
    )
    if role is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "company not found")


@router.get("/calibrators/{model}", response_model=CalibratorStatus)
async def get_calibrator(company_id: UUID, model: str, account_id: CurrentAccount):
    # Import here to avoid a hard module-load dep when calibration.py
    # is unavailable for any reason (it isn't, but cheap defence).
    from app.calibration import MIN_SAMPLES_FOR_FIT

    async with acquire() as conn:
        await _ensure_member(conn, company_id, account_id)
        row = await conn.fetchrow(
            """
            SELECT fitted_at, window_days, n_samples, method,
                   raw_brier, calibrated_brier, raw_ece, calibrated_ece,
                   artifact
            FROM forecast_calibrators
            WHERE forecasting_model = $1 AND is_active
            """,
            model,
        )
        # Even without an active calibrator we want to tell the UI
        # "how close are we to fitting?" — count the eligible postmortems.
        n_avail = await conn.fetchval(
            """
            SELECT count(*)
            FROM trade_postmortems p
            JOIN trade_intents i ON i.id = p.intent_id
            WHERE i.source_model = $1
              AND p.outcome IN ('win', 'loss')
              AND p.generated_at >= now() - interval '30 days'
              AND i.confidence IS NOT NULL
            """,
            model,
        ) or 0

    if row is None:
        return CalibratorStatus(
            forecasting_model=model,
            fitted_at=None, window_days=None,
            n_samples=int(n_avail),
            method=None,
            raw_brier=None, calibrated_brier=None,
            raw_ece=None, calibrated_ece=None,
            artifact=[],
            state="insufficient_data" if int(n_avail) > 0 else "never_fit",
            min_samples_required=MIN_SAMPLES_FOR_FIT,
        )

    raw_artifact: Any = row["artifact"]
    if isinstance(raw_artifact, str):
        raw_artifact = json.loads(raw_artifact)
    return CalibratorStatus(
        forecasting_model=model,
        fitted_at=row["fitted_at"],
        window_days=int(row["window_days"]),
        n_samples=int(row["n_samples"]),
        method=row["method"],
        raw_brier=float(row["raw_brier"]),
        calibrated_brier=float(row["calibrated_brier"]),
        raw_ece=float(row["raw_ece"]),
        calibrated_ece=float(row["calibrated_ece"]),
        artifact=[CalibratorPoint(x=float(p["x"]), y=float(p["y"])) for p in raw_artifact],
        state="calibrated",
        min_samples_required=MIN_SAMPLES_FOR_FIT,
    )
