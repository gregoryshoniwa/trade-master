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

    # Per-company credentials at rest are Fernet-encrypted. The key MUST
    # be set in production (any 32-byte url-safe base64 string); the
    # dev default lets you boot without thinking about it, but rotating
    # this in prod requires re-encrypting all rows.
    credentials_key: str = "dev_change_me_dev_change_me_dev_change_me="

    # Stripe billing (Phase 4). Operator can leave these blank to
    # disable billing entirely — the api still works; the pricing CTAs
    # just become signup-form links instead of checkout redirects.
    # In production fill in:
    #   STRIPE_SECRET_KEY        sk_live_... (or sk_test_... for staging)
    #   STRIPE_WEBHOOK_SECRET    whsec_... (from the webhook endpoint config)
    #   STRIPE_PRICE_STARTER     price_... (lookup_key='starter' on the Stripe Price)
    #   STRIPE_PRICE_PRO         price_... (lookup_key='pro')
    #   STRIPE_BILLING_RETURN_URL  fully-qualified URL the customer comes
    #                              back to from checkout / customer portal
    stripe_secret_key: str = ""
    stripe_webhook_secret: str = ""
    stripe_price_starter: str = ""
    stripe_price_pro: str = ""
    stripe_billing_return_url: str = "http://localhost:3000/settings"

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
