"""Settings for the Kronos forecaster service."""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", case_sensitive=False, extra="ignore")

    # NATS
    nats_url: str = "nats://nats:4222"

    # Model — Kronos-base (102M) + the shared Kronos-Tokenizer-base. Label
    # MUST equal the api's forecasting registry key and agents.forecasting_model.
    # We tried -small first to cut latency ~10× on CPU; signal quality
    # collapsed (Kronny's win rate dropped below break-even on real fills).
    # Back to -base — slower inference, the only thing on this machine that
    # actually outperforms TTM in live trading.
    model_repo: str = "NeoQuasar/Kronos-base"
    tokenizer_repo: str = "NeoQuasar/Kronos-Tokenizer-base"
    model_label: str = "kronos-base"
    device: str = "cpu"            # Docker on Mac can't pass MPS/CUDA

    # Candle aggregation + context
    granularity: int = 60          # seconds per OHLCV bar
    context_length: int = 256      # bars fed to the model (<= max_context 512)
    prediction_length: int = 12    # bars ahead
    # Per-sample paths for the honest confidence (predict() averages internally,
    # so we draw this many sampled futures ourselves). Keep modest on CPU.
    sample_count: int = 8
    temperature: float = 1.0
    top_p: float = 0.9

    # Warm-start: seed each symbol from Deriv history so we can forecast
    # immediately instead of waiting hours to accumulate live bars.
    warmup_count: int = 360        # historical bars (<= 5000 Deriv cap)

    # Inference cadence
    forecast_every_secs: float = 5.0
    min_secs_between_forecasts: float = 60.0   # ~one forecast per closed bar

    # Service
    port: int = 8082
    log_level: str = "info"


settings = Settings()
