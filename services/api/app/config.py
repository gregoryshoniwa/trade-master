"""Settings — read from environment via pydantic-settings."""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", case_sensitive=False, extra="ignore")

    # Database
    database_url: str = "postgresql://trademaster:dev_change_me@postgres:5432/trademaster"

    # Auth
    auth_secret: str = "dev_change_me_to_a_long_random_string"
    jwt_issuer: str = "trademaster-local"
    jwt_audience: str = "trademaster-web"
    jwt_ttl_hours: int = 24 * 7
    magic_link_ttl_minutes: int = 15

    # CORS — Phase 0 dev permissive
    cors_origins: str = "http://localhost:3000"

    # Cookie
    cookie_name: str = "tm_session"
    cookie_secure: bool = False  # Phase 0 dev = http
    cookie_samesite: str = "lax"

    # External — wired in later phases
    nats_url: str = "nats://nats:4222"
    redis_url: str = "redis://redis:6379/0"

    # Branding
    app_name: str = "TradeMaster"


settings = Settings()
