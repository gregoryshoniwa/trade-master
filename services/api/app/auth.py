"""Magic-link tokens + JWT session cookies + the get_account dependency."""

import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from typing import Annotated
from uuid import UUID

import asyncpg
import jwt
from fastapi import Cookie, Depends, HTTPException, Response, status

from app.config import settings
from app.db import acquire


# ─────────────────────── magic-link tokens ───────────────────────


def _hash_token(token: str) -> str:
    """SHA-256 of the raw token — what we store in the DB so a DB leak
    doesn't compromise unused magic links."""
    return hashlib.sha256(token.encode()).hexdigest()


async def create_magic_link(email: str, full_name: str | None) -> str:
    """Issue a magic-link token, store its hash + the requesting email.
    Returns the *raw* token (to be sent to the user)."""
    raw_token = secrets.token_urlsafe(32)
    token_hash = _hash_token(raw_token)
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=settings.magic_link_ttl_minutes)

    async with acquire() as conn:
        await conn.execute(
            """
            INSERT INTO magic_link_tokens (email, full_name, token_hash, expires_at)
            VALUES ($1, $2, $3, $4)
            """,
            email.lower(),
            full_name,
            token_hash,
            expires_at,
        )
    return raw_token


async def consume_magic_link(raw_token: str) -> tuple[UUID, str, str | None, bool]:
    """Validate + consume a magic-link token. Creates the account on first use.
    Returns (account_id, email, full_name, is_new)."""
    token_hash = _hash_token(raw_token)

    async with acquire() as conn:
        async with conn.transaction():
            row = await conn.fetchrow(
                """
                SELECT id, email, full_name, expires_at, consumed_at
                FROM magic_link_tokens
                WHERE token_hash = $1
                FOR UPDATE
                """,
                token_hash,
            )
            if row is None:
                raise HTTPException(status.HTTP_400_BAD_REQUEST, "invalid token")
            if row["consumed_at"] is not None:
                raise HTTPException(status.HTTP_400_BAD_REQUEST, "token already used")
            if row["expires_at"] < datetime.now(timezone.utc):
                raise HTTPException(status.HTTP_400_BAD_REQUEST, "token expired")

            await conn.execute(
                "UPDATE magic_link_tokens SET consumed_at = now() WHERE id = $1",
                row["id"],
            )

            account, is_new = await _upsert_account(conn, row["email"], row["full_name"])
            return account["id"], account["email"], account["full_name"], is_new


async def _upsert_account(
    conn: asyncpg.Connection, email: str, full_name: str | None
) -> tuple[asyncpg.Record, bool]:
    """Find or create the account. Returns (record, is_new)."""
    existing = await conn.fetchrow(
        "SELECT id, email, full_name FROM accounts WHERE email = $1", email
    )
    if existing is not None:
        return existing, False
    new = await conn.fetchrow(
        """
        INSERT INTO accounts (email, full_name, jurisdiction)
        VALUES ($1, $2, $3)
        RETURNING id, email, full_name
        """,
        email,
        full_name,
        "ZW",  # default for Phase 0; user can change later
    )
    return new, True


# ──────────────────────────── JWT ────────────────────────────


def issue_session_jwt(account_id: UUID) -> str:
    now = datetime.now(timezone.utc)
    exp = now + timedelta(hours=settings.jwt_ttl_hours)
    payload = {
        "iss": settings.jwt_issuer,
        "aud": settings.jwt_audience,
        "sub": str(account_id),
        "iat": int(now.timestamp()),
        "exp": int(exp.timestamp()),
    }
    return jwt.encode(payload, settings.auth_secret, algorithm="HS256")


def decode_session_jwt(token: str) -> UUID:
    try:
        payload = jwt.decode(
            token,
            settings.auth_secret,
            algorithms=["HS256"],
            audience=settings.jwt_audience,
            issuer=settings.jwt_issuer,
        )
        return UUID(payload["sub"])
    except jwt.PyJWTError as e:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid session") from e


def set_session_cookie(response: Response, account_id: UUID) -> None:
    token = issue_session_jwt(account_id)
    response.set_cookie(
        key=settings.cookie_name,
        value=token,
        max_age=settings.jwt_ttl_hours * 3600,
        httponly=True,
        secure=settings.cookie_secure,
        samesite=settings.cookie_samesite,
        path="/",
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(settings.cookie_name, path="/")


# ─────────────────────── FastAPI dependency ───────────────────────


async def current_account_id(
    tm_session: Annotated[str | None, Cookie(alias="tm_session")] = None,
) -> UUID:
    if tm_session is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "not authenticated")
    return decode_session_jwt(tm_session)


# Alias to make route signatures shorter
CurrentAccount = Annotated[UUID, Depends(current_account_id)]
