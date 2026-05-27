"""Settings."""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", case_sensitive=False, extra="ignore")

    # NATS
    nats_url: str = "nats://nats:4222"

    # Model
    model_repo: str = "ibm-granite/granite-timeseries-ttm-r2"
    model_label: str = "ttm-granite-r2"
    context_length: int = 512    # ticks
    prediction_length: int = 96  # ticks ahead
    device: str = "cpu"          # Docker on Mac can't pass MPS

    # Inference cadence
    forecast_every_secs: float = 5.0
    min_secs_between_forecasts: float = 1.0

    # Service
    port: int = 8081
    log_level: str = "info"


settings = Settings()
