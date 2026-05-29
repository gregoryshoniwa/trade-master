"""WebAuthn / passkey routes (PLAN Phase 7).

Today we use a single gate: flipping an agent's `trade_mode` away from
`paper` requires the user to sign a fresh challenge with a registered
passkey. The api stamps a short-lived `passkey_unlock_token` cookie on
successful assertion; the agents route checks it on PATCH.

Four endpoints:

  POST /auth/passkey/register/options  — start enrollment, returns the
                                          PublicKeyCredentialCreationOptions
                                          (minus the bits the browser
                                          must compute itself).
  POST /auth/passkey/register/verify   — finish enrollment, store the
                                          credential. body: registration response.
  POST /auth/passkey/assert/options    — start an assertion challenge.
  POST /auth/passkey/assert/verify     — verify; on success set
                                          `tm_passkey_unlock` cookie.

The `tm_passkey_unlock` cookie is a 5-minute JWT — same secret/issuer as
the session JWT but with a different audience. Just enough room for the
user to click the trade-mode toggle, confirm, and have the PATCH go
through.
"""

from __future__ import annotations

import base64
import datetime as dt
import logging
import os
from typing import Any
from uuid import UUID

import jwt
from fastapi import APIRouter, HTTPException, Response, status
from pydantic import BaseModel
from webauthn import (
    generate_authentication_options,
    generate_registration_options,
    options_to_json,
    verify_authentication_response,
    verify_registration_response,
)
from webauthn.helpers.structs import (
    AuthenticatorSelectionCriteria,
    PublicKeyCredentialDescriptor,
    UserVerificationRequirement,
)

from app.auth import CurrentAccount
from app.config import settings
from app.db import acquire

log = logging.getLogger("trademaster.passkey")

router = APIRouter(prefix="/auth/passkey", tags=["passkey"])

# Relying-Party config. Localhost dev maps RP_ID to "localhost"; production
# overrides via env. Origin includes the scheme + port the browser used.
RP_ID = os.getenv("WEBAUTHN_RP_ID", "localhost")
RP_NAME = "TradeMaster"
EXPECTED_ORIGINS = [
    o.strip() for o in os.getenv("WEBAUTHN_ORIGINS", "http://localhost:3000").split(",")
    if o.strip()
]

CHALLENGE_TTL_SECS = 5 * 60         # how long a registration / assertion option lives
UNLOCK_TOKEN_TTL_SECS = 5 * 60      # how long the "go live" token is valid
UNLOCK_COOKIE = "tm_passkey_unlock"
UNLOCK_AUDIENCE = "trademaster-passkey"


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _b64url_decode(s: str) -> bytes:
    pad = "=" * (-len(s) % 4)
    return base64.urlsafe_b64decode((s + pad).encode())


# ───────────────────────── schemas ──────────────────────────


class RegisterOptionsResponse(BaseModel):
    options_json: str  # raw JSON — browser hands straight to navigator.credentials.create


class RegisterVerifyRequest(BaseModel):
    # The full PublicKeyCredential the browser produced, as JSON.
    credential_json: str
    name: str | None = None


class AssertOptionsResponse(BaseModel):
    options_json: str


class AssertVerifyRequest(BaseModel):
    credential_json: str


class HasPasskey(BaseModel):
    has_passkey: bool
    count: int


# ───────────────────────── helpers ──────────────────────────


async def _store_challenge(account_id: UUID, challenge: bytes, purpose: str) -> None:
    expires = dt.datetime.utcnow() + dt.timedelta(seconds=CHALLENGE_TTL_SECS)
    async with acquire() as conn:
        await conn.execute(
            """
            INSERT INTO webauthn_challenges (account_id, challenge, purpose, expires_at)
            VALUES ($1, $2, $3, $4)
            """,
            account_id, challenge, purpose, expires,
        )
        # Prune anything stale for this account so the table stays small.
        await conn.execute(
            "DELETE FROM webauthn_challenges WHERE account_id = $1 AND expires_at < now()",
            account_id,
        )


async def _consume_challenge(account_id: UUID, purpose: str) -> bytes:
    async with acquire() as conn:
        row = await conn.fetchrow(
            """
            DELETE FROM webauthn_challenges
            WHERE id = (
                SELECT id FROM webauthn_challenges
                WHERE account_id = $1 AND purpose = $2 AND expires_at > now()
                ORDER BY created_at DESC LIMIT 1
            )
            RETURNING challenge
            """,
            account_id, purpose,
        )
    if row is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "no live challenge — restart the passkey flow",
        )
    return bytes(row["challenge"])


def _issue_unlock_jwt(account_id: UUID) -> str:
    now = dt.datetime.utcnow()
    return jwt.encode(
        {
            "iss": settings.jwt_issuer,
            "aud": UNLOCK_AUDIENCE,
            "sub": str(account_id),
            "iat": int(now.timestamp()),
            "exp": int((now + dt.timedelta(seconds=UNLOCK_TOKEN_TTL_SECS)).timestamp()),
        },
        settings.auth_secret, algorithm="HS256",
    )


def decode_unlock_jwt(token: str) -> UUID:
    """Used by routes/agents.py to verify the trade-mode flip cookie."""
    try:
        payload = jwt.decode(
            token, settings.auth_secret, algorithms=["HS256"],
            audience=UNLOCK_AUDIENCE, issuer=settings.jwt_issuer,
        )
        return UUID(payload["sub"])
    except jwt.PyJWTError as e:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid passkey unlock") from e


# ───────────────────────── routes ──────────────────────────


@router.get("/status", response_model=HasPasskey)
async def has_passkey(account_id: CurrentAccount):
    async with acquire() as conn:
        n = await conn.fetchval(
            "SELECT count(*) FROM webauthn_credentials WHERE account_id = $1",
            account_id,
        )
    return HasPasskey(has_passkey=bool(n), count=int(n or 0))


@router.post("/register/options", response_model=RegisterOptionsResponse)
async def register_options(account_id: CurrentAccount):
    async with acquire() as conn:
        existing = await conn.fetch(
            "SELECT credential_id FROM webauthn_credentials WHERE account_id = $1",
            account_id,
        )
        full_name = await conn.fetchval(
            "SELECT full_name FROM accounts WHERE id = $1", account_id,
        )
    exclude = [
        PublicKeyCredentialDescriptor(id=bytes(r["credential_id"])) for r in existing
    ]
    opts = generate_registration_options(
        rp_id=RP_ID, rp_name=RP_NAME,
        user_id=str(account_id).encode(),
        user_name=str(account_id),
        user_display_name=full_name or "TradeMaster user",
        exclude_credentials=exclude,
        authenticator_selection=AuthenticatorSelectionCriteria(
            user_verification=UserVerificationRequirement.REQUIRED,
        ),
    )
    await _store_challenge(account_id, opts.challenge, "register")
    return RegisterOptionsResponse(options_json=options_to_json(opts))


@router.post("/register/verify")
async def register_verify(
    account_id: CurrentAccount, body: RegisterVerifyRequest,
):
    challenge = await _consume_challenge(account_id, "register")
    try:
        result = verify_registration_response(
            credential=body.credential_json,
            expected_challenge=challenge,
            expected_origin=EXPECTED_ORIGINS,
            expected_rp_id=RP_ID,
            require_user_verification=True,
        )
    except Exception as e:
        log.warning("registration verify failed: %s", e)
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"verify failed: {e}")

    async with acquire() as conn:
        await conn.execute(
            """
            INSERT INTO webauthn_credentials
                (account_id, credential_id, public_key, sign_count, name)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (credential_id) DO UPDATE SET
                public_key = EXCLUDED.public_key,
                sign_count = EXCLUDED.sign_count
            """,
            account_id, result.credential_id, result.credential_public_key,
            int(result.sign_count or 0), body.name or "Passkey",
        )
    return {"ok": True}


@router.post("/assert/options", response_model=AssertOptionsResponse)
async def assert_options(account_id: CurrentAccount):
    async with acquire() as conn:
        creds = await conn.fetch(
            "SELECT credential_id FROM webauthn_credentials WHERE account_id = $1",
            account_id,
        )
    if not creds:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, "no passkey registered for this account",
        )
    allow = [PublicKeyCredentialDescriptor(id=bytes(r["credential_id"])) for r in creds]
    opts = generate_authentication_options(
        rp_id=RP_ID,
        allow_credentials=allow,
        user_verification=UserVerificationRequirement.REQUIRED,
    )
    await _store_challenge(account_id, opts.challenge, "assert")
    return AssertOptionsResponse(options_json=options_to_json(opts))


@router.post("/assert/verify")
async def assert_verify(
    account_id: CurrentAccount, body: AssertVerifyRequest, response: Response,
):
    challenge = await _consume_challenge(account_id, "assert")
    # We need the stored public key + counter for the matching credential.
    # The browser tells us which credential it used inside credential_json.
    import json as _json
    cred = _json.loads(body.credential_json)
    raw_id_b64 = cred.get("rawId") or cred.get("id")
    if not raw_id_b64:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "rawId missing")
    credential_id = _b64url_decode(raw_id_b64)
    async with acquire() as conn:
        stored = await conn.fetchrow(
            """
            SELECT public_key, sign_count
            FROM webauthn_credentials
            WHERE account_id = $1 AND credential_id = $2
            """,
            account_id, credential_id,
        )
    if stored is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "credential not registered")
    try:
        result = verify_authentication_response(
            credential=body.credential_json,
            expected_challenge=challenge,
            expected_origin=EXPECTED_ORIGINS,
            expected_rp_id=RP_ID,
            credential_public_key=bytes(stored["public_key"]),
            credential_current_sign_count=int(stored["sign_count"] or 0),
            require_user_verification=True,
        )
    except Exception as e:
        log.warning("assertion verify failed: %s", e)
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"verify failed: {e}")

    async with acquire() as conn:
        await conn.execute(
            """
            UPDATE webauthn_credentials
            SET sign_count = $2, last_used_at = now()
            WHERE account_id = $1 AND credential_id = $3
            """,
            account_id, int(result.new_sign_count or 0), credential_id,
        )

    # Mint the short-lived unlock JWT and set as a separate cookie. Owners
    # use it on the very next PATCH /agents/{id} to flip to autonomous.
    unlock = _issue_unlock_jwt(account_id)
    response.set_cookie(
        key=UNLOCK_COOKIE, value=unlock,
        max_age=UNLOCK_TOKEN_TTL_SECS,
        httponly=True, secure=settings.cookie_secure,
        samesite=settings.cookie_samesite, path="/",
    )
    return {"ok": True, "expires_in": UNLOCK_TOKEN_TTL_SECS}
