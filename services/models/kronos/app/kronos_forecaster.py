"""Kronos forecaster.

Kronos predicts future candlesticks autoregressively. KronosPredictor.predict()
averages its internal samples and returns only the mean, so to recover the
uncertainty we draw `sample_count` independent paths ourselves (predict with
sample_count=1, repeated) and read the distribution off them:

  direction   = majority sign of (final close − last close) across samples
  confidence  = fraction of samples agreeing on that direction, remapped from
                [0.5,1] → [0,1] so it sits on the SAME axis as TTM's confidence
                and the agents' min_confidence_threshold (~0.5). This is an
                honest, model-derived confidence — not a heuristic.
  p10/p50/p90 = per-step quantiles across the sampled close paths.
"""

import hashlib
import logging
import os
import time

import numpy as np
import pandas as pd

log = logging.getLogger("trademaster.kronos")

os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")


class KronosForecaster:
    def __init__(
        self,
        model_repo: str,
        tokenizer_repo: str,
        context_length: int,
        prediction_length: int,
        sample_count: int,
        temperature: float,
        top_p: float,
        granularity: int,
        device: str,
    ):
        self.model_repo = model_repo
        self.tokenizer_repo = tokenizer_repo
        self.context_length = context_length
        self.prediction_length = prediction_length
        self.sample_count = sample_count
        self.temperature = temperature
        self.top_p = top_p
        self.granularity = granularity
        self.device = device
        self.predictor = None
        self.weights_hash: str = ""

    def load(self) -> None:
        # The vendored Kronos package lives on sys.path at /app/model.
        from model import Kronos, KronosPredictor, KronosTokenizer

        log.info(
            "loading Kronos repo=%s tokenizer=%s ctx=%d horizon=%d device=%s",
            self.model_repo, self.tokenizer_repo,
            self.context_length, self.prediction_length, self.device,
        )
        t0 = time.perf_counter()
        tokenizer = KronosTokenizer.from_pretrained(self.tokenizer_repo)
        model = Kronos.from_pretrained(self.model_repo)
        self.predictor = KronosPredictor(
            model, tokenizer, device=self.device, max_context=self.context_length
        )
        self.weights_hash = self._hash_state_dict(model)
        log.info(
            "Kronos loaded in %.1fs · weights=%s",
            time.perf_counter() - t0, self.weights_hash[:16],
        )

    @staticmethod
    def _hash_state_dict(model) -> str:
        h = hashlib.sha256()
        for name, p in model.state_dict().items():
            h.update(name.encode())
            h.update(p.detach().cpu().contiguous().numpy().tobytes())
        return f"sha256:{h.hexdigest()}"

    def forecast(self, bars: list[dict]) -> dict:
        """Run inference on a window of closed OHLCV bars.

        Returns p10/p50/p90 (close paths), direction, confidence ∈ [0,1],
        latency_ms.
        """
        assert self.predictor is not None, "model not loaded"
        assert len(bars) >= self.context_length, "not enough context"

        ctx = bars[-self.context_length :]
        df = pd.DataFrame(ctx)[["open", "high", "low", "close", "volume"]].astype(float)
        df["amount"] = df["volume"]
        x_ts = pd.Series(pd.to_datetime([b["t"] for b in ctx], unit="s", utc=True))

        step = pd.Timedelta(seconds=self.granularity)
        y_ts = pd.Series(
            [x_ts.iloc[-1] + step * (i + 1) for i in range(self.prediction_length)]
        )

        last_close = float(ctx[-1]["close"])

        t0 = time.perf_counter()
        paths: list[np.ndarray] = []
        for _ in range(self.sample_count):
            pred = self.predictor.predict(
                df=df,
                x_timestamp=x_ts,
                y_timestamp=y_ts,
                pred_len=self.prediction_length,
                T=self.temperature,
                top_p=self.top_p,
                sample_count=1,
                verbose=False,
            )
            paths.append(np.asarray(pred["close"], dtype=np.float64))
        latency_ms = (time.perf_counter() - t0) * 1000.0

        samples = np.vstack(paths)  # (sample_count, prediction_length)
        finals = samples[:, -1]
        ups = float(np.mean(finals > last_close))

        # Direction + honest confidence from sample agreement.
        if np.allclose(finals, last_close):
            direction, confidence = "flat", 0.0
        else:
            direction = "up" if ups >= 0.5 else "down"
            agree = max(ups, 1.0 - ups)            # ∈ [0.5, 1.0]
            confidence = max(0.0, (agree - 0.5) * 2.0)  # → [0, 1], TTM-comparable

        p10, p50, p90 = np.quantile(samples, [0.1, 0.5, 0.9], axis=0)
        return {
            "p10": p10.tolist(),
            "p50": p50.tolist(),
            "p90": p90.tolist(),
            "direction": direction,
            "confidence": confidence,
            "latency_ms": latency_ms,
        }


def make_default_forecaster() -> "KronosForecaster":
    from app.config import settings

    return KronosForecaster(
        model_repo=settings.model_repo,
        tokenizer_repo=settings.tokenizer_repo,
        context_length=settings.context_length,
        prediction_length=settings.prediction_length,
        sample_count=settings.sample_count,
        temperature=settings.temperature,
        top_p=settings.top_p,
        granularity=settings.granularity,
        device=settings.device,
    )
