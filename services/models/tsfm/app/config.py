"""Settings for the TSFM.ai client service.

Wraps TSFM.ai's hosted REST API (`POST /v1/forecast/ensemble`) and
publishes the result onto the same NATS subject (`signals.{label}.{sym}`)
the existing TTM/Kronos services use, so the api decision loop matches
agents to it without any new wiring."""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", case_sensitive=False, extra="ignore")

    # NATS
    nats_url: str = "nats://nats:4222"

    # TSFM.ai
    tsfm_api_base: str = "https://api.tsfm.ai"
    tsfm_api_key: str = ""           # required; service refuses to start without it
    # Models the ensemble runs across. IDs come from TSFM.ai's catalog
    # (GET /api/models). Chronos-2 is Amazon's broadest-tested TSFM with
    # native multivariate; moirai-2.0-R-small is Salesforce's strongest
    # multi-asset model. The ensemble endpoint runs both, scores each on
    # a holdout backtest, and returns a weighted result.
    ensemble_models: list[str] = ["amazon/chronos-2", "Salesforce/moirai-2.0-R-small"]
    # Frequency code passed in `parameters.freq`. TSFM.ai accepts pandas
    # offset aliases — "1min" matches our 60s candle granularity.
    freq: str = "1min"
    request_timeout_secs: float = 12.0
    # We retry on 5xx and timeouts only; 4xx (auth, bad-request) fails fast.
    max_retries: int = 2

    # Label used on the NATS subject AND as agents.forecasting_model.
    # Must match the entry registered in app.forecasting.registry on
    # the api side.
    model_label: str = "tsfm-ensemble"

    # Candle aggregation + context
    granularity: int = 60          # seconds per bar
    context_length: int = 256      # last N bars sent as the inputs[0].series
    prediction_length: int = 12    # horizon

    # Warm-start: seed each symbol from Deriv history so we can forecast
    # immediately instead of waiting hours to accumulate live bars.
    warmup_count: int = 360

    # Inference cadence
    forecast_every_secs: float = 5.0
    # Cost gate: minimum gap between TSFM.ai calls per symbol. Default
    # 180s = one call per 3 minutes — covers typical 1-min trading
    # without burning credits at the same rate as the local kronos.
    min_secs_between_forecasts: float = 180.0

    # Service
    port: int = 8083
    log_level: str = "info"


settings = Settings()
