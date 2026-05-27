"""TTM (Tiny Time Mixers) forecaster.

TTM is point-forecast only (PLAN §3.1). For visual confidence bands we
wrap the point output with an empirical std-based band from recent returns.
Phase 1+ replaces this with conformal calibration.
"""

import hashlib
import logging
import os
import time

import numpy as np
import torch
from tsfm_public.toolkit.get_model import get_model

log = logging.getLogger("trademaster.ttm")


class TTMForecaster:
    def __init__(self, model_repo: str, context_length: int, prediction_length: int, device: str):
        self.model_repo = model_repo
        self.context_length = context_length
        self.prediction_length = prediction_length
        self.device = torch.device(device)
        self.model = None
        self.weights_hash: str = ""

    def load(self) -> None:
        log.info(
            "loading TTM model repo=%s context=%d horizon=%d device=%s",
            self.model_repo, self.context_length, self.prediction_length, self.device,
        )
        t0 = time.perf_counter()
        # granite-tsfm picks the right config from the repo
        model = get_model(
            self.model_repo,
            context_length=self.context_length,
            prediction_length=self.prediction_length,
        )
        model.eval()
        model.to(self.device)
        self.model = model

        # Build a content-derived hash to stamp every forecast — answers the
        # audit question "which weights produced this prediction?" without
        # depending on commit hashes.
        self.weights_hash = self._hash_state_dict(model)

        log.info(
            "TTM loaded in %.1fs · weights=%s",
            time.perf_counter() - t0, self.weights_hash[:16],
        )

    @staticmethod
    def _hash_state_dict(model: torch.nn.Module) -> str:
        h = hashlib.sha256()
        for name, p in model.state_dict().items():
            h.update(name.encode())
            h.update(p.detach().cpu().contiguous().numpy().tobytes())
        return f"sha256:{h.hexdigest()}"

    def forecast(self, quotes: np.ndarray) -> dict:
        """Run inference on a window of close-prices.

        Returns dict with:
          p50: float[prediction_length]   point forecast
          p10: float[prediction_length]   = p50 - z*std (informal band)
          p90: float[prediction_length]   = p50 + z*std
          direction: 'up'|'down'|'flat'
          confidence: float in [0,1]      heuristic, see below
          latency_ms: float
        """
        assert self.model is not None, "model not loaded"
        assert quotes.shape[0] >= self.context_length, "not enough context"

        ctx = quotes[-self.context_length :].astype(np.float32)

        t0 = time.perf_counter()
        with torch.inference_mode():
            x = torch.from_numpy(ctx).to(self.device)
            # TTM expects shape (batch, channels, context_length) where the
            # channel dim is the number of input features. Univariate close
            # → channels=1.
            x = x.reshape(1, self.context_length, 1)
            out = self.model(past_values=x)
            # PredictionOutput object; .prediction_outputs has shape
            # (batch, prediction_length, channels)
            y = out.prediction_outputs.squeeze(0).squeeze(-1).cpu().numpy()
        latency_ms = (time.perf_counter() - t0) * 1000.0

        # Confidence band from recent returns std. z=1.28 ≈ 80% band.
        returns = np.diff(ctx) / np.maximum(np.abs(ctx[:-1]), 1e-9)
        # Std of returns over the last min(256, ctx_len-1) steps.
        recent = returns[-min(256, returns.shape[0]) :]
        sigma_ret = float(np.std(recent)) if recent.size else 0.0
        last_price = float(ctx[-1])

        # Band widens with sqrt(horizon-step) — diffusion-style scaling.
        z = 1.28
        steps = np.arange(1, self.prediction_length + 1, dtype=np.float32)
        band_pct = z * sigma_ret * np.sqrt(steps)
        p50 = y.astype(np.float64)
        p10 = p50 * (1.0 - band_pct)
        p90 = p50 * (1.0 + band_pct)

        # Direction + confidence: where does p50[-1] land vs current price,
        # scaled by how many sigmas of move that is.
        delta = float(p50[-1] - last_price)
        if sigma_ret > 0:
            move_in_sigma = abs(delta) / (sigma_ret * last_price * np.sqrt(self.prediction_length) + 1e-9)
        else:
            move_in_sigma = 0.0
        confidence = float(min(1.0, move_in_sigma / 2.0))  # cap at 1.0
        if abs(delta) < 1e-9:
            direction = "flat"
        else:
            direction = "up" if delta > 0 else "down"

        return {
            "p50": p50.tolist(),
            "p10": p10.tolist(),
            "p90": p90.tolist(),
            "direction": direction,
            "confidence": confidence,
            "latency_ms": latency_ms,
        }


def _detect_device(want: str) -> str:
    """Pick a torch device. We accept the configured value but downgrade to
    CPU silently if CUDA/MPS isn't available — important on M1 Docker where
    MPS is invisible to Linux containers."""
    if want == "cuda" and torch.cuda.is_available():
        return "cuda"
    if want == "mps" and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def make_default_forecaster() -> TTMForecaster:
    from app.config import settings
    return TTMForecaster(
        model_repo=settings.model_repo,
        context_length=settings.context_length,
        prediction_length=settings.prediction_length,
        device=_detect_device(settings.device),
    )


# Silence noisy huggingface tokenizer warnings — we don't use a tokenizer here.
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
