"""Forecast confidence calibration (PLAN §11).

We fit an isotonic regression per forecasting_model on the recent
window of (raw_confidence, win/loss) pairs and use the resulting step
function to map raw model confidence to a calibrated probability
before the trade-gating threshold check in the decision loop.

Algorithm: Pool-Adjacent-Violators (PAV). It's the maximum-likelihood
isotonic estimator for binary outcomes, runs in O(n), needs no
hyperparameters, and is exactly what scikit-learn's
IsotonicRegression(out_of_bounds="clip") does under the hood. We
implement it directly so we don't pull sklearn into the api image
just for this.

The cron runs daily. The decision loop pulls the active calibrator
once per minute via an in-memory cache (no DB hop per signal).

Statistical caveats:

* We need MIN_SAMPLES_FOR_FIT (default 80) settled trades within the
  window before fitting. Below that, no calibrator is written and
  the decision loop passes raw confidence through unchanged. This
  protects against overfitting on a handful of trades.

* `break_even` outcomes (Deriv contract sold at parity) are excluded
  from the fit — they're rare and ambiguous as a calibration target.

* The calibrator is fit on the trades that actually executed. There's a
  selection-bias hazard: if the agent only ever traded when raw confidence
  was >0.55, we have no data below 0.55 to fit on. We extrapolate
  conservatively (clamp inputs below the lowest seen raw_x to the
  first calibrated_y; that's the standard "clip" behavior).
"""

from __future__ import annotations

import asyncio
import json
import logging
import math
import time
from typing import Iterable
from uuid import UUID

from app.db import acquire

log = logging.getLogger("trademaster.calibration")

# A daily fit is the right cadence — postmortems land continuously,
# but we don't want to retrain every minute and have the trade gate
# wobble at the seam between two calibrators.
FIT_INTERVAL_SECS = 24 * 60 * 60
# Two-tier minimum samples: isotonic (PAV) needs ~80 to behave (a
# step function with too few knots overfits); Platt scaling (2-param
# logistic) is well-conditioned at 20+. Below 20 we just don't fit
# and the decision loop passes raw confidence through.
MIN_SAMPLES_FOR_ISOTONIC = 80
MIN_SAMPLES_FOR_FIT = 20
# Backwards-compatible alias used by the read endpoint.
# Window of postmortems used for the fit. Long enough to be stable;
# short enough that regime changes (a model swap, a new asset class)
# get reflected within a few days.
DEFAULT_WINDOW_DAYS = 30
# Cache TTL for the active calibrator lookup. The decision loop calls
# `calibrate(model, raw)` thousands of times per minute; refreshing
# once a minute is more than fast enough.
CACHE_TTL_SECS = 60

_task: asyncio.Task | None = None


# ────────────────────────── isotonic fit ──────────────────────────


def _pav(pairs: list[tuple[float, float]]) -> list[tuple[float, float]]:
    """Pool-Adjacent-Violators on (raw_prob, label) pairs.

    Returns sorted (x, y) breakpoints of a monotone non-decreasing
    step function. The interpretation at lookup time: for input raw,
    return the y of the smallest x >= raw (clip below to first y,
    above to last y).

    The classic in-place PAV: walk left-to-right; whenever the next
    block's mean is lower than the current's, merge them; on a merge
    we recheck the previous block too. O(n) amortized.
    """
    if not pairs:
        return []
    # Sort by raw ascending, stable.
    pairs = sorted(pairs, key=lambda p: p[0])
    # blocks[i] = (sum_y, weight, x_max)
    blocks: list[tuple[float, int, float]] = [(y, 1, x) for x, y in pairs]
    i = 0
    while i + 1 < len(blocks):
        s1, w1, x1 = blocks[i]
        s2, w2, x2 = blocks[i + 1]
        if s1 / w1 <= s2 / w2:
            i += 1
            continue
        # Violation — merge i+1 into i. Use x_max of the right block as
        # the new boundary so the step function's domain is correct.
        merged = (s1 + s2, w1 + w2, x2)
        blocks[i] = merged
        blocks.pop(i + 1)
        if i > 0:
            i -= 1
    return [(x, s / w) for s, w, x in blocks]


# ───────────────────────── Platt scaling ──────────────────────────


def _platt_fit(pairs: list[tuple[float, float]]) -> tuple[float, float] | None:
    """Fit logistic σ(A·raw + B) on (raw, label) pairs by Newton-Raphson.

    Uses Platt's prior-corrected targets (Platt 2000): treats positives
    as y=(N⁺+1)/(N⁺+2) and negatives as y=1/(N⁻+2) instead of {0,1}.
    This keeps the fit well-behaved when one class is rare — important
    for small samples where the raw MLE would push parameters off to
    infinity if the data is even mildly separable.

    Returns (A, B), or None when one of the classes is absent — we
    can't fit a calibration on all-wins or all-losses.
    """
    n_pos = sum(1 for _, y in pairs if y > 0.5)
    n_neg = len(pairs) - n_pos
    if n_pos == 0 or n_neg == 0:
        return None
    t_pos = (n_pos + 1) / (n_pos + 2)
    t_neg = 1 / (n_neg + 2)
    targets = [t_pos if y > 0.5 else t_neg for _, y in pairs]

    A, B = 0.0, math.log(n_pos / n_neg)  # sane init: logit of class balance
    for _ in range(40):
        gA = gB = 0.0
        h00 = h01 = h11 = 0.0
        for (x, _), t in zip(pairs, targets):
            z = max(-30.0, min(30.0, A * x + B))
            p = 1.0 / (1.0 + math.exp(-z))
            d = p - t
            gA += d * x
            gB += d
            # tiny ridge to keep H invertible when all p_i collapse to 0/1
            w = p * (1.0 - p) + 1e-9
            h00 += w * x * x
            h01 += w * x
            h11 += w
        det = h00 * h11 - h01 * h01
        if abs(det) < 1e-12:
            break
        dA = (h11 * gA - h01 * gB) / det
        dB = (h00 * gB - h01 * gA) / det
        A -= dA
        B -= dB
        if abs(dA) < 1e-7 and abs(dB) < 1e-7:
            break
    return A, B


def _platt_to_steps(A: float, B: float, n_points: int = 41) -> list[tuple[float, float]]:
    """Sample the sigmoid σ(A·x + B) at n_points evenly spaced on [0,1].

    Storing the curve as breakpoints lets the same `apply_isotonic`
    lookup work for both isotonic and Platt artifacts, which keeps
    the decision-loop apply path uniform."""
    pts: list[tuple[float, float]] = []
    for i in range(n_points):
        x = i / (n_points - 1)
        z = max(-30.0, min(30.0, A * x + B))
        y = 1.0 / (1.0 + math.exp(-z))
        pts.append((x, y))
    # Platt is monotone in A>0; defensively enforce non-decreasing here
    # in case numerical noise produced a regression. A negative A means
    # the model is anti-correlated with outcomes — leave the curve as
    # is; the user needs to see that.
    if A >= 0:
        for i in range(1, len(pts)):
            if pts[i][1] < pts[i - 1][1]:
                pts[i] = (pts[i][0], pts[i - 1][1])
    return pts


def apply_isotonic(steps: list[tuple[float, float]], x: float) -> float:
    """Map raw confidence x through the step function.

    Below the smallest breakpoint → first y (clip low).
    Above the largest breakpoint → last y (clip high).
    Otherwise return y of the smallest breakpoint with x_k >= x.
    """
    if not steps:
        return x
    if x <= steps[0][0]:
        return steps[0][1]
    if x >= steps[-1][0]:
        return steps[-1][1]
    # Linear scan is fine — calibrators have at most ~window_days * trades_per_day
    # breakpoints, which is well under 1000 in practice.
    for bx, by in steps:
        if x <= bx:
            return by
    return steps[-1][1]


# ──────────────────────── reliability metrics ────────────────────────


def _brier(probs: Iterable[float], labels: Iterable[float]) -> float:
    """Brier score: mean squared error of probabilistic predictions.
    0 is perfect, 0.25 is "always predict 0.5", 1.0 is "perfectly wrong"."""
    probs = list(probs)
    labels = list(labels)
    if not probs:
        return 0.0
    return sum((p - y) ** 2 for p, y in zip(probs, labels)) / len(probs)


def _ece(probs: Iterable[float], labels: Iterable[float], bins: int = 10) -> float:
    """Expected Calibration Error — weighted gap between predicted
    probability and observed frequency, across N equal-width bins.

    Edge case: an empty bin contributes nothing (zero weight)."""
    probs = list(probs)
    labels = list(labels)
    if not probs:
        return 0.0
    bin_totals = [0] * bins
    bin_conf_sum = [0.0] * bins
    bin_label_sum = [0.0] * bins
    for p, y in zip(probs, labels):
        # Clamp 1.0 into the last bin to avoid an out-of-range index.
        b = min(bins - 1, max(0, int(p * bins)))
        bin_totals[b] += 1
        bin_conf_sum[b] += p
        bin_label_sum[b] += y
    n = len(probs)
    ece = 0.0
    for b in range(bins):
        if bin_totals[b] == 0:
            continue
        avg_conf = bin_conf_sum[b] / bin_totals[b]
        avg_label = bin_label_sum[b] / bin_totals[b]
        ece += (bin_totals[b] / n) * abs(avg_conf - avg_label)
    return ece


# ─────────────────────────── fit + persist ───────────────────────────


async def _fetch_pairs(
    *, model: str, window_days: int,
) -> list[tuple[float, float]]:
    """Pull (raw_confidence, label) pairs from settled trades for a model."""
    async with acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT i.confidence AS raw, p.outcome
            FROM trade_postmortems p
            JOIN trade_intents i ON i.id = p.intent_id
            WHERE i.source_model = $1
              AND p.outcome IN ('win', 'loss')
              AND p.generated_at >= now() - make_interval(days => $2)
              AND i.confidence IS NOT NULL
            """,
            model, window_days,
        )
    return [(float(r["raw"]), 1.0 if r["outcome"] == "win" else 0.0) for r in rows]


async def fit_and_store(*, model: str, window_days: int = DEFAULT_WINDOW_DAYS) -> dict | None:
    """Fit calibrator for one model and persist it. Returns a summary
    dict on success, or None if there weren't enough samples / one
    class was missing."""
    pairs = await _fetch_pairs(model=model, window_days=window_days)
    if len(pairs) < MIN_SAMPLES_FOR_FIT:
        log.info(
            "calibrator skip model=%s n=%d (< %d required)",
            model, len(pairs), MIN_SAMPLES_FOR_FIT,
        )
        return None

    raw_probs = [p[0] for p in pairs]
    labels = [p[1] for p in pairs]

    # Pick the fitter by sample size — see the constants at the top
    # for the rationale.
    if len(pairs) >= MIN_SAMPLES_FOR_ISOTONIC:
        method = "isotonic"
        steps = _pav(pairs)
    else:
        method = "platt"
        fit = _platt_fit(pairs)
        if fit is None:
            log.info("calibrator skip model=%s n=%d (one class missing)",
                     model, len(pairs))
            return None
        steps = _platt_to_steps(*fit)

    calibrated_probs = [apply_isotonic(steps, x) for x in raw_probs]

    raw_brier = _brier(raw_probs, labels)
    cal_brier = _brier(calibrated_probs, labels)
    raw_ece = _ece(raw_probs, labels)
    cal_ece = _ece(calibrated_probs, labels)

    artifact = [{"x": round(bx, 6), "y": round(by, 6)} for bx, by in steps]

    async with acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                "UPDATE forecast_calibrators SET is_active = FALSE WHERE forecasting_model = $1 AND is_active",
                model,
            )
            await conn.execute(
                """
                INSERT INTO forecast_calibrators (
                    forecasting_model, window_days, n_samples,
                    raw_brier, calibrated_brier, raw_ece, calibrated_ece,
                    artifact, method, is_active
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, TRUE)
                """,
                model, window_days, len(pairs),
                raw_brier, cal_brier, raw_ece, cal_ece,
                json.dumps(artifact), method,
            )
    log.info(
        "calibrator fit model=%s method=%s n=%d  Brier %.4f→%.4f  ECE %.4f→%.4f",
        model, method, len(pairs), raw_brier, cal_brier, raw_ece, cal_ece,
    )
    # Invalidate the cache so the next call picks up the new artifact.
    _cache.clear()
    return {
        "model": model, "method": method, "n": len(pairs),
        "raw_brier": raw_brier, "calibrated_brier": cal_brier,
        "raw_ece": raw_ece, "calibrated_ece": cal_ece,
        "steps": len(steps),
    }


async def _fit_all_active_models() -> int:
    """One pass: fit every distinct model that appears in active agents."""
    async with acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT DISTINCT forecasting_model
            FROM agents
            WHERE is_active = TRUE AND forecasting_model IS NOT NULL
            """,
        )
    n = 0
    for r in rows:
        try:
            if await fit_and_store(model=r["forecasting_model"]):
                n += 1
        except Exception:
            log.exception("calibrator fit failed model=%s", r["forecasting_model"])
    return n


# ───────────────────── apply (decision loop hook) ─────────────────────


_cache: dict[str, tuple[float, list[tuple[float, float]] | None]] = {}


async def _load_active(model: str) -> list[tuple[float, float]] | None:
    async with acquire() as conn:
        artifact = await conn.fetchval(
            """
            SELECT artifact FROM forecast_calibrators
            WHERE forecasting_model = $1 AND is_active
            """,
            model,
        )
    if artifact is None:
        return None
    raw = json.loads(artifact) if isinstance(artifact, str) else artifact
    return [(float(p["x"]), float(p["y"])) for p in raw]


async def calibrate(model: str, raw_confidence: float) -> float:
    """Map raw model confidence through the active calibrator.

    Falls through to `raw_confidence` when there is no active calibrator
    (either because the model has fewer than MIN_SAMPLES_FOR_FIT settled
    trades, or because the cron hasn't run yet)."""
    if not model:
        return raw_confidence
    now = time.monotonic()
    cached = _cache.get(model)
    if cached is None or now - cached[0] > CACHE_TTL_SECS:
        try:
            steps = await _load_active(model)
        except Exception:
            log.exception("calibrator load failed model=%s", model)
            steps = None
        _cache[model] = (now, steps)
    else:
        steps = cached[1]
    if steps is None:
        return raw_confidence
    return apply_isotonic(steps, raw_confidence)


# ───────────────────────────── cron ─────────────────────────────


async def start() -> None:
    global _task
    if _task is not None:
        return
    _task = asyncio.create_task(_loop(), name="calibration")
    log.info("calibration loop started — interval=%ss window=%dd min_n=%d",
             FIT_INTERVAL_SECS, DEFAULT_WINDOW_DAYS, MIN_SAMPLES_FOR_FIT)


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
    # Give the rest of startup a moment to settle, then fit immediately
    # — the loop wakes up on a 24h interval so we don't want the first
    # fit to wait a whole day.
    await asyncio.sleep(45)
    while True:
        try:
            n = await _fit_all_active_models()
            if n:
                log.info("calibration pass: %d models refit", n)
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("calibration pass failed; will retry")
        await asyncio.sleep(FIT_INTERVAL_SECS)
