"""Thin async client for TSFM.ai's hosted forecasting API.

Endpoint shape verified against `https://api.tsfm.ai/v1/forecast` and
`https://api.tsfm.ai/v1/forecast/ensemble` (April 2026 migration):

  POST /v1/forecast
    body:
      {
        "model": "amazon/chronos-2",
        "inputs": [
          {
            "item_id": "<symbol>",
            "target": [[v], [v], ...],   # 2D [num_timesteps][num_channels]
            "start": "<iso-timestamp>"
          }
        ],
        "parameters": {
          "prediction_length": 12,
          "freq": "1min",
          "quantiles": [0.1, 0.5, 0.9]
        }
      }
    auth:  Bearer <TSFM_API_KEY>

  Response (single):
    {
      "outputs": [{
        "mean": [[v], [v], ...],
        "quantile_predictions": [
          {"level": 0.1, "values": [[v], ...]},
          {"level": 0.5, "values": [[v], ...]},
          {"level": 0.9, "values": [[v], ...]}
        ]
      }],
      ...
    }

  Ensemble wraps the above under `ensemble_result.outputs[...]` and
  exposes per-model picks under `ranked_results[]` with weight/score.
  We always read from `ensemble_result` so the ensemble's voting is
  what reaches the decision loop.
"""

from __future__ import annotations

import asyncio
import datetime as dt
import logging
import time
from dataclasses import dataclass
from typing import Any

import httpx

from app.config import settings

log = logging.getLogger("trademaster.tsfm.client")


@dataclass
class TsfmForecast:
    p10: list[float]
    p50: list[float]
    p90: list[float]
    last_price: float
    direction: str          # 'up' | 'down' | 'flat'
    confidence: float       # in [0, 1]
    latency_ms: float
    raw_models: list[str]   # which models contributed (ensemble metadata)


def _extract_outputs(payload: dict) -> dict | None:
    """Return the `outputs[0]` block from either a single-model forecast
    response or an ensemble response. The ensemble nests its aggregate
    forecast under `ensemble_result.outputs[0]`; the single-model
    response has `outputs[0]` directly. Both share the same shape so
    once we get to the block, parsing is identical."""
    if not isinstance(payload, dict):
        return None
    # Ensemble: ensemble_result.outputs[0]
    er = payload.get("ensemble_result")
    if isinstance(er, dict):
        outs = er.get("outputs")
        if isinstance(outs, list) and outs:
            return outs[0] if isinstance(outs[0], dict) else None
    # Single model: outputs[0]
    outs = payload.get("outputs")
    if isinstance(outs, list) and outs:
        return outs[0] if isinstance(outs[0], dict) else None
    return None


def _flatten_2d(rows: list[Any]) -> list[float]:
    """Convert TSFM's [[v], [v], ...] univariate output back to [v, v, ...]."""
    out: list[float] = []
    for r in rows:
        if isinstance(r, list) and r:
            out.append(float(r[0]))
        elif isinstance(r, (int, float)):
            out.append(float(r))
    return out


def _extract_quantiles(payload: dict) -> tuple[list[float], list[float], list[float]] | None:
    """Pull (p10, p50, p90) from the response's outputs block."""
    block = _extract_outputs(payload)
    if block is None:
        return None
    p10: list[float] = []
    p50: list[float] = []
    p90: list[float] = []
    qs = block.get("quantile_predictions")
    if isinstance(qs, list):
        for q in qs:
            if not isinstance(q, dict):
                continue
            level = q.get("level")
            vals = q.get("values")
            if not isinstance(vals, list):
                continue
            flat = _flatten_2d(vals)
            if level is None or not flat:
                continue
            try:
                lf = float(level)
            except (TypeError, ValueError):
                continue
            if abs(lf - 0.1) < 0.01:
                p10 = flat
            elif abs(lf - 0.5) < 0.01:
                p50 = flat
            elif abs(lf - 0.9) < 0.01:
                p90 = flat
    # Fallback: only `mean` is present. Treat it as p50 and degenerate
    # the bands; direction/confidence still work.
    if not p50:
        mean = block.get("mean")
        if isinstance(mean, list):
            p50 = _flatten_2d(mean)
    if not p50:
        return None
    p10 = p10 or p50
    p90 = p90 or p50
    return p10, p50, p90


def _extract_ensemble_models(payload: dict) -> list[str]:
    """Best-effort: pull the list of models that actually ran from the
    ensemble metadata. Useful in the published envelope so postmortems
    can attribute which model dominated."""
    rr = payload.get("ranked_results")
    if isinstance(rr, list):
        names: list[str] = []
        for r in rr:
            if isinstance(r, dict) and "model" in r:
                names.append(str(r["model"]))
        if names:
            return names
    # Single-model response carries `model` at the top level.
    m = payload.get("model")
    if isinstance(m, str):
        return [m]
    return list(settings.ensemble_models)


def _direction_and_confidence(
    last_price: float, p10: list[float], p50: list[float], p90: list[float],
) -> tuple[str, float]:
    """Direction = sign of (p50[-1] − last_price). Confidence = fraction
    of the [p10, p90] envelope that sits on the same side of last_price
    as the median — a quantile analogue of Kronos's sampled-direction-
    agreement. Falls back to a magnitude proxy for point predictions."""
    if not p50:
        return "flat", 0.0
    end_p50 = p50[-1]
    end_p10 = p10[-1] if p10 else end_p50
    end_p90 = p90[-1] if p90 else end_p50
    move = end_p50 - last_price
    if abs(move) < 1e-9:
        return "flat", 0.0
    direction = "up" if move > 0 else "down"
    span = max(1e-9, end_p90 - end_p10)
    if span <= 1e-9:
        rel = min(1.0, abs(move) / max(abs(last_price) * 0.001, 1e-9))
        return direction, max(0.0, min(1.0, 0.5 + 0.5 * rel))
    if direction == "up":
        on_side = max(0.0, min(span, end_p90 - last_price))
    else:
        on_side = max(0.0, min(span, last_price - end_p10))
    return direction, max(0.0, min(1.0, on_side / span))


class TsfmClient:
    def __init__(self) -> None:
        if not settings.tsfm_api_key:
            raise RuntimeError(
                "TSFM_API_KEY is not set — the TSFM service refuses to "
                "start without it. Set it in .env or via docker-compose."
            )
        self._http = httpx.AsyncClient(
            base_url=settings.tsfm_api_base,
            headers={
                "Authorization": f"Bearer {settings.tsfm_api_key}",
                "Content-Type": "application/json",
                "User-Agent": "trademaster-tsfm/0.1",
            },
            timeout=httpx.Timeout(settings.request_timeout_secs),
        )

    async def aclose(self) -> None:
        await self._http.aclose()

    async def forecast_ensemble(
        self, *, symbol: str, series: list[float], last_price: float, horizon: int,
        bar_epochs: list[int] | None = None,
    ) -> TsfmForecast:
        """Call /v1/forecast/ensemble with our two-model default. We
        send a univariate `target` (2D shape [N][1]) and let TSFM.ai
        handle backtest scoring + aggregation across models.

        `bar_epochs` is optional — when present we use the first bar's
        epoch as `start`; otherwise we fall back to now (which works
        because TSFM is index-based not calendar-based)."""
        if bar_epochs and bar_epochs[0]:
            start = dt.datetime.fromtimestamp(bar_epochs[0], tz=dt.timezone.utc).isoformat()
        else:
            start = dt.datetime.now(tz=dt.timezone.utc).isoformat()
        # 2D shape [num_timesteps][num_channels=1]; required per the
        # 2026-04 migration even for univariate series.
        target_2d = [[float(v)] for v in series]
        body: dict[str, Any] = {
            "models": settings.ensemble_models,
            "inputs": [{
                "item_id": symbol,
                "target": target_2d,
                "start": start,
            }],
            "parameters": {
                "prediction_length": horizon,
                "freq": settings.freq,
                "quantiles": [0.1, 0.5, 0.9],
            },
        }
        attempt = 0
        last_exc: Exception | None = None
        t0 = time.perf_counter()
        data: dict[str, Any] = {}
        while attempt <= settings.max_retries:
            try:
                resp = await self._http.post("/v1/forecast/ensemble", json=body)
                if resp.status_code >= 500:
                    raise RuntimeError(f"tsfm 5xx: {resp.status_code} {resp.text[:200]}")
                resp.raise_for_status()
                data = resp.json()
                break
            except (httpx.TimeoutException, httpx.HTTPError, RuntimeError) as e:
                last_exc = e
                if attempt >= settings.max_retries:
                    raise
                await asyncio.sleep(0.5 * (attempt + 1))
            attempt += 1
        else:
            raise last_exc or RuntimeError("tsfm: exhausted retries")
        latency_ms = (time.perf_counter() - t0) * 1000.0
        q = _extract_quantiles(data)
        if q is None:
            raise RuntimeError(
                "tsfm: response missing quantile_predictions / mean — "
                f"top-level keys: {list(data.keys())[:10]}"
            )
        p10, p50, p90 = q
        p10 = p10[:horizon]
        p50 = p50[:horizon]
        p90 = p90[:horizon]
        direction, confidence = _direction_and_confidence(last_price, p10, p50, p90)
        raw_models = _extract_ensemble_models(data)
        return TsfmForecast(
            p10=p10, p50=p50, p90=p90,
            last_price=last_price, direction=direction, confidence=confidence,
            latency_ms=latency_ms, raw_models=raw_models,
        )
