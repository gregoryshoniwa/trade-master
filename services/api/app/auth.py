"""Password auth + invite-token flow + JWT session cookies.

Phase 1 (this rework) replaces magic-link login with email + Argon2id
password. The old magic_link_tokens table is repurposed as invite_tokens —
issued by Owner/Admin members to bring new humans into a Company. An
invite token carries the target email + company_id + intended role + an
optional title (e.g. "Risk Officer"); accepting one either signs the
user up (if no account) or just joins the Company (if they already have
an account).
"""

import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from typing import Annotated
from uuid import UUID

import asyncpg
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from fastapi import Cookie, Depends, HTTPException, Response, status
import jwt

from app.config import settings
from app.db import acquire


_hasher = PasswordHasher()  # OWASP-recommended Argon2id defaults


# ────────────────────────── passwords ───────────────────────────


def hash_password(plain: str) -> str:
    return _hasher.hash(plain)


def verify_password(plain: str, encoded: str) -> bool:
    try:
        _hasher.verify(encoded, plain)
        return True
    except VerifyMismatchError:
        return False
    except Exception:
        return False


def password_strong_enough(plain: str) -> tuple[bool, str | None]:
    if len(plain) < 10:
        return False, "password must be at least 10 characters"
    if plain.lower() in {plain, plain.upper()}:
        return False, "password must mix upper and lowercase letters"
    if not any(c.isdigit() for c in plain):
        return False, "password must include a digit"
    return True, None


# ───────────────────────── invite tokens ─────────────────────────


def _hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


async def create_invite_token(
    *,
    email: str,
    company_id: UUID,
    role: str,
    title: str | None,
    invited_by_account_id: UUID,
) -> str:
    """Issue a one-time invite token. Returns the raw token."""
    raw = secrets.token_urlsafe(32)
    expires_at = datetime.now(timezone.utc) + timedelta(days=7)
    async with acquire() as conn:
        await conn.execute(
            """
            INSERT INTO invite_tokens
                (email, token_hash, expires_at, company_id, role,
                 invited_by_account_id, title)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            """,
            email.lower(),
            _hash_token(raw),
            expires_at,
            company_id,
            role,
            invited_by_account_id,
            title,
        )
    return raw


class InvitePayload:
    """Validated, consumed invite. Use under a transaction so the caller
    can join the user to the company atomically."""

    def __init__(self, token_id, email, company_id, role, title):
        self.token_id = token_id
        self.email = email
        self.company_id = company_id
        self.role = role
        self.title = title


async def consume_invite_token(
    conn: asyncpg.Connection, raw_token: str
) -> InvitePayload:
    row = await conn.fetchrow(
        """
        SELECT id, email, company_id, role, title, expires_at, consumed_at
        FROM invite_tokens
        WHERE token_hash = $1
        FOR UPDATE
        """,
        _hash_token(raw_token),
    )
    if row is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "invalid invite")
    if row["consumed_at"] is not None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "invite already used")
    if row["expires_at"] < datetime.now(timezone.utc):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "invite expired")
    if row["company_id"] is None:
        # Legacy magic-link rows (pre-Phase 1) have no company_id and aren't
        # invites. Reject — the user should sign up directly instead.
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "this token is from the legacy magic-link flow; please sign up",
        )

    await conn.execute(
        "UPDATE invite_tokens SET consumed_at = now() WHERE id = $1",
        row["id"],
    )
    return InvitePayload(
        token_id=row["id"],
        email=row["email"],
        company_id=row["company_id"],
        role=row["role"],
        title=row["title"],
    )


async def peek_invite_token(raw_token: str) -> dict | None:
    """Return safe-to-display fields for an invite without consuming it.
    Used by the signup page to pre-fill the email + show which Company you're
    joining. Returns None on any invalidity (don't leak which way)."""
    async with acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT i.email, i.role, i.title, i.expires_at, i.consumed_at,
                   c.id AS company_id, c.name AS company_name
            FROM invite_tokens i
            LEFT JOIN companies c ON c.id = i.company_id
            WHERE i.token_hash = $1
            """,
            _hash_token(raw_token),
        )
    if row is None:
        return None
    if row["consumed_at"] is not None or row["company_id"] is None:
        return None
    if row["expires_at"] < datetime.now(timezone.utc):
        return None
    return {
        "email": row["email"],
        "company_id": str(row["company_id"]),
        "company_name": row["company_name"],
        "role": row["role"],
        "title": row["title"],
    }


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


CurrentAccount = Annotated[UUID, Depends(current_account_id)]


async def current_company_id(account_id: CurrentAccount) -> UUID:
    """The caller's most-recently-joined company. Used by endpoints that
    are conceptually per-tenant but don't take an explicit company in the
    URL (e.g. live broker balance, statement). When the user belongs to
    multiple companies, the most-recent one wins — the frontend can move
    to explicit /companies/{id}/deriv/... paths if it needs to switch."""
    from app.db import acquire  # local to avoid circular import
    async with acquire() as conn:
        cid = await conn.fetchval(
            """
            SELECT company_id
            FROM company_members
            WHERE account_id = $1
            ORDER BY joined_at DESC
            LIMIT 1
            """,
            account_id,
        )
    if cid is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "no company membership")
    return cid


CurrentCompanyId = Annotated[UUID, Depends(current_company_id)]
