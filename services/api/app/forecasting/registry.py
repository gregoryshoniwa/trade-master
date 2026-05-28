"""Catalog of time-series foundation models (TSFMs) an Agent can run on.

Single source of truth: routes/agents.py validates an Agent's
`forecasting_model` against this registry, the ForecastingModelPicker UI
hydrates from /api/v1/forecasting/models, and the decision loop routes a
forecast to agents whose forecasting_model equals the forecast's `model`.

CRITICAL INVARIANT: `key` must equal the publishing service's `model_label`
exactly (the value it writes into the signal envelope's `model` field). A
mismatch means agents silently never match the model. See PLAN.md §3.
"""

from dataclasses import dataclass
from typing import Literal


@dataclass(frozen=True)
class ForecastModelDef:
    key: str                    # == publisher model_label == agents.forecasting_model
    label: str                  # human-friendly name
    family: str                 # ttm / kronos / chronos / timesfm / fincast
    params: str                 # rough size, e.g. "~5M", "102M"
    license: str
    inputs: str                 # what the model consumes (close-only vs OHLCV)
    granularity: str            # bar/tick cadence it forecasts on
    context_length: int
    prediction_length: int
    description: str
    tier: Literal["fast", "mid", "heavy"] = "mid"


CATALOG: list[ForecastModelDef] = [
    ForecastModelDef(
        key="ttm-granite-r2",
        label="TTM (Granite TimeSeries r2)",
        family="ttm",
        params="~5M",
        license="Apache-2.0",
        inputs="univariate close",
        granularity="per-tick (1s)",
        context_length=512,
        prediction_length=96,
        description=(
            "IBM TinyTimeMixer — a tiny MLP-Mixer point forecaster. Extremely "
            "fast on CPU. Forecasts the close series only; confidence is a "
            "sigma-based heuristic."
        ),
        tier="fast",
    ),
    ForecastModelDef(
        key="kronos-base",
        label="Kronos-base (K-line foundation model)",
        family="kronos",
        params="102M",
        license="MIT",
        inputs="OHLCV candles",
        granularity="1-minute bars",
        context_length=512,
        prediction_length=12,
        description=(
            "NeoQuasar Kronos — a decoder-only autoregressive model built for "
            "financial candlesticks. Consumes full OHLCV; confidence is the "
            "fraction of sampled futures agreeing on direction (honest, not a "
            "heuristic). We tried -small for the latency win; quality dropped "
            "Kronny below break-even on real fills, so we're on -base."
        ),
        tier="mid",
    ),
]

BY_KEY: dict[str, ForecastModelDef] = {m.key: m for m in CATALOG}


def get_model(key: str) -> ForecastModelDef | None:
    return BY_KEY.get(key)


def is_known(key: str) -> bool:
    return key in BY_KEY
