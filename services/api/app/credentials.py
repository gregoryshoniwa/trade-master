"""Per-company credential storage with Fernet encryption at rest.

We never round-trip a customer's broker token or LLM key through plain
JSON in the database. Every value is encrypted with a key from
`CREDENTIALS_KEY` and stored as BYTEA. The api process is the only
holder of the key — the database admin can read the BYTEA blobs and
they're useless without it.

Read paths used by runtime code:
  - `get_llm_key(company_id, provider)` — returns the customer's API
    key if set, else the system env fallback. Used by `app.llm.factory`.
  - `get_deriv_token(company_id)` — returns the active token (demo or
    real, based on `deriv_environment`) for trade execution. Returns
    None if the company hasn't configured one yet.

Write paths used by the Settings UI route:
  - `set_credentials(company_id, **updates)` — partial update; only
    fields present in kwargs are touched, others kept. Pass `None`
    explicitly to clear a value.
"""

from __future__ import annotations

import base64
import logging
import os
from typing import Literal

from cryptography.fernet import Fernet, InvalidToken

from app.config import settings
from app.db import acquire

log = logging.getLogger("trademaster.credentials")

# Field-name → env-var-fallback map for LLM providers. The runtime
# `get_llm_key` reads from the company's row first; if empty, falls
# through to the env var so the system owner's keys still work for
# the free tier.
_LLM_ENV_FALLBACK: dict[str, str] = {
    "anthropic_api_key":  "ANTHROPIC_API_KEY",
    "openai_api_key":     "OPENAI_API_KEY",
    "gemini_api_key":     "GEMINI_API_KEY",
    "openrouter_api_key": "OPENROUTER_API_KEY",
    "groq_api_key":       "GROQ_API_KEY",
}

LLMProvider = Literal["anthropic", "openai", "gemini", "openrouter", "groq"]

_PROVIDER_TO_COL: dict[str, str] = {
    "anthropic":  "anthropic_api_key",
    "openai":     "openai_api_key",
    "gemini":     "gemini_api_key",
    "openrouter": "openrouter_api_key",
    "groq":       "groq_api_key",
}


def _fernet() -> Fernet:
    """Build a Fernet instance from the configured key. Accepts both a
    pre-formatted Fernet key (44-byte url-safe base64) and a raw 32-byte
    secret which we'll pad/encode ourselves — easier on the operator."""
    raw = settings.credentials_key.encode()
    # Real Fernet keys are 44 chars and url-safe base64. If we got a
    # shorter or non-base64 string (i.e. the dev default), derive a
    # deterministic Fernet key from it so the api still boots.
    try:
        Fernet(raw)
        return Fernet(raw)
    except (ValueError, Exception):
        pass
    # Pad/truncate to 32 bytes then base64-encode for Fernet.
    seed = (settings.credentials_key * 4).encode()[:32]
    return Fernet(base64.urlsafe_b64encode(seed))


def encrypt(value: str | None) -> bytes | None:
    if value is None or value == "":
        return None
    return _fernet().encrypt(value.encode())


def decrypt(value: bytes | None) -> str | None:
    if value is None:
        return None
    try:
        return _fernet().decrypt(bytes(value)).decode()
    except InvalidToken:
        log.warning("decrypt failed — credentials key may have rotated without re-encrypt")
        return None


# ─── Reads (runtime hot paths) ───────────────────────────────────


async def get_llm_key(company_id, provider: str) -> str | None:
    """Per-company key if present, else env fallback. Returns None when
    neither is set (caller treats as 'provider not configured')."""
    col = _PROVIDER_TO_COL.get(provider.lower())
    if col is None:
        return None
    async with acquire() as conn:
        enc = await conn.fetchval(
            f"SELECT {col} FROM company_credentials WHERE company_id = $1",
            company_id,
        )
    plain = decrypt(enc)
    if plain:
        return plain
    return os.getenv(_LLM_ENV_FALLBACK[col]) or None


async def get_deriv_token(company_id) -> tuple[str | None, str]:
    """Returns (token, environment) for the company's active Deriv
    account. Falls back to env DERIV_API_TOKEN + 'demo' when no
    company-level token is configured."""
    async with acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT deriv_token_demo, deriv_token_real, deriv_environment
            FROM company_credentials WHERE company_id = $1
            """,
            company_id,
        )
    env = "demo"
    if row is not None:
        env = row["deriv_environment"]
        col = row["deriv_token_real"] if env == "real" else row["deriv_token_demo"]
        plain = decrypt(col)
        if plain:
            return plain, env
    return (os.getenv("DERIV_API_TOKEN") or None), env


# ─── Status (for UI — never returns plaintext) ───────────────────


async def get_credentials_status(company_id) -> dict:
    """Returns booleans for which keys are configured, plus
    `deriv_environment`. NEVER returns plaintext values."""
    async with acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT deriv_token_demo, deriv_token_real, deriv_environment,
                   anthropic_api_key, openai_api_key, gemini_api_key,
                   openrouter_api_key, groq_api_key, updated_at
            FROM company_credentials WHERE company_id = $1
            """,
            company_id,
        )
    if row is None:
        return {
            "deriv_demo_configured": False,
            "deriv_real_configured": False,
            "deriv_environment": "demo",
            "anthropic_configured": False,
            "openai_configured": False,
            "gemini_configured": False,
            "openrouter_configured": False,
            "groq_configured": False,
            "updated_at": None,
        }
    return {
        "deriv_demo_configured": row["deriv_token_demo"] is not None,
        "deriv_real_configured": row["deriv_token_real"] is not None,
        "deriv_environment": row["deriv_environment"],
        "anthropic_configured": row["anthropic_api_key"] is not None,
        "openai_configured": row["openai_api_key"] is not None,
        "gemini_configured": row["gemini_api_key"] is not None,
        "openrouter_configured": row["openrouter_api_key"] is not None,
        "groq_configured": row["groq_api_key"] is not None,
        "updated_at": row["updated_at"].isoformat() if row["updated_at"] else None,
    }


# ─── Writes (Settings UI) ────────────────────────────────────────


_ALL_COLS = {
    "deriv_token_demo", "deriv_token_real",
    "anthropic_api_key", "openai_api_key", "gemini_api_key",
    "openrouter_api_key", "groq_api_key",
}

# Use a sentinel for "leave the value unchanged" so the route can
# distinguish None (clear it) from absent (don't touch it).
class _Unchanged:
    pass

UNCHANGED = _Unchanged()


async def set_credentials(
    company_id,
    *,
    deriv_token_demo=UNCHANGED,
    deriv_token_real=UNCHANGED,
    deriv_environment: str | None = None,
    anthropic_api_key=UNCHANGED,
    openai_api_key=UNCHANGED,
    gemini_api_key=UNCHANGED,
    openrouter_api_key=UNCHANGED,
    groq_api_key=UNCHANGED,
) -> None:
    """Partial update of a company's credentials. Pass plaintext
    strings — they're encrypted before write. Pass None to clear a
    field; omit (leave UNCHANGED) to leave it untouched."""
    sets: list[str] = []
    args: list = [company_id]

    def _add(col: str, val):
        if isinstance(val, _Unchanged):
            return
        if col not in _ALL_COLS:
            raise ValueError(f"unknown col {col}")
        args.append(encrypt(val))
        sets.append(f"{col} = ${len(args)}")

    _add("deriv_token_demo", deriv_token_demo)
    _add("deriv_token_real", deriv_token_real)
    _add("anthropic_api_key", anthropic_api_key)
    _add("openai_api_key", openai_api_key)
    _add("gemini_api_key", gemini_api_key)
    _add("openrouter_api_key", openrouter_api_key)
    _add("groq_api_key", groq_api_key)
    if deriv_environment is not None:
        if deriv_environment not in ("demo", "real"):
            raise ValueError("deriv_environment must be 'demo' or 'real'")
        args.append(deriv_environment)
        sets.append(f"deriv_environment = ${len(args)}")

    if not sets:
        return  # nothing to write
    sets.append("updated_at = now()")
    sql = (
        "INSERT INTO company_credentials (company_id) VALUES ($1) "
        "ON CONFLICT (company_id) DO NOTHING"
    )
    update_sql = (
        f"UPDATE company_credentials SET {', '.join(sets)} "
        "WHERE company_id = $1"
    )
    async with acquire() as conn:
        async with conn.transaction():
            await conn.execute(sql, company_id)
            await conn.execute(update_sql, *args)
