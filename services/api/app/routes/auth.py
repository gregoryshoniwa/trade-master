"""Auth routes: signup, login, logout, accept-invite.

Magic-link login was removed in Phase 1. Existing dev accounts need to
set a password via the SQL backfill script or by re-signing-up with the
same email (signup is idempotent — see below)."""

import logging
import os
from typing import Annotated
from uuid import UUID

import asyncpg
from fastapi import APIRouter, HTTPException, Query, Response, status
from slugify import slugify

from app.auth import (
    InvitePayload,
    clear_session_cookie,
    consume_invite_token,
    hash_password,
    password_strong_enough,
    peek_invite_token,
    set_session_cookie,
    verify_password,
)
from app.db import acquire
from app.personalities import STARTER_AGENTS, apply_preset
from app.schemas import (
    AcceptInviteRequest,
    AuthResponse,
    InvitePeekResponse,
    LoginRequest,
    SignupRequest,
)

router = APIRouter(prefix="/auth", tags=["auth"])
log = logging.getLogger("trademaster.auth")

WEB_ORIGIN = os.getenv("WEB_ORIGIN", "http://localhost:3000")


# ───────────────────────── signup / login ─────────────────────────


@router.post("/signup", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
async def signup(body: SignupRequest, response: Response):
    ok, why = password_strong_enough(body.password)
    if not ok:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, why or "weak password")

    pw_hash = hash_password(body.password)
    email = body.email.lower()

    async with acquire() as conn:
        async with conn.transaction():
            # Reject if the email already has a password set. (Accounts
            # created via the legacy magic-link flow have no password and
            # can adopt one here — same email, signup completes the setup.)
            existing = await conn.fetchrow(
                """
                SELECT id, password_hash, full_name FROM accounts
                WHERE email = $1
                FOR UPDATE
                """,
                email,
            )
            is_new_account = False
            if existing is None:
                row = await conn.fetchrow(
                    """
                    INSERT INTO accounts
                        (email, full_name, jurisdiction, password_hash, password_updated_at)
                    VALUES ($1, $2, $3, $4, now())
                    RETURNING id, email, full_name
                    """,
                    email, body.full_name, body.jurisdiction.upper(), pw_hash,
                )
                is_new_account = True
            elif existing["password_hash"] is None:
                # Legacy account from magic-link days — finish enrollment.
                row = await conn.fetchrow(
                    """
                    UPDATE accounts
                    SET password_hash = $1, password_updated_at = now(),
                        full_name = COALESCE(full_name, $2)
                    WHERE id = $3
                    RETURNING id, email, full_name
                    """,
                    pw_hash, body.full_name, existing["id"],
                )
                is_new_account = True  # first password = first real signup
            else:
                raise HTTPException(
                    status.HTTP_409_CONFLICT,
                    "an account with this email already exists; log in instead",
                )

            account_id: UUID = row["id"]
            full_name = row["full_name"]

            # Optional: create their first Company in the same transaction.
            company_id: UUID | None = None
            if body.company_name:
                company_id = await _create_company_with_seed(
                    conn, account_id=account_id, name=body.company_name,
                )

    set_session_cookie(response, account_id)
    return AuthResponse(
        account_id=account_id,
        email=row["email"],
        full_name=full_name,
        is_new_account=is_new_account,
        company_id=company_id,
    )


@router.post("/login", response_model=AuthResponse)
async def login(body: LoginRequest, response: Response):
    email = body.email.lower()
    async with acquire() as conn:
        row = await conn.fetchrow(
            "SELECT id, email, full_name, password_hash FROM accounts WHERE email = $1",
            email,
        )
    if row is None or row["password_hash"] is None:
        # Don't reveal whether the email exists.
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid email or password")
    if not verify_password(body.password, row["password_hash"]):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid email or password")

    set_session_cookie(response, row["id"])
    return AuthResponse(
        account_id=row["id"],
        email=row["email"],
        full_name=row["full_name"],
        is_new_account=False,
    )


@router.post("/logout")
async def logout(response: Response):
    clear_session_cookie(response)
    return {"ok": True}


# ───────────────────────── invite acceptance ─────────────────────────


@router.get("/invite", response_model=InvitePeekResponse)
async def peek_invite(token: Annotated[str, Query(min_length=8)]):
    """Pre-fill the accept-invite form. Returns 404 on any invalidity so
    we don't leak which invites are real."""
    data = await peek_invite_token(token)
    if data is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "invite not found or expired")
    return InvitePeekResponse(**data)


@router.post("/accept-invite", response_model=AuthResponse)
async def accept_invite(body: AcceptInviteRequest, response: Response):
    async with acquire() as conn:
        async with conn.transaction():
            invite: InvitePayload = await consume_invite_token(conn, body.token)

            existing = await conn.fetchrow(
                "SELECT id, email, full_name, password_hash FROM accounts WHERE email = $1",
                invite.email,
            )
            is_new_account = False

            if existing is None:
                # New user — must supply password + name.
                if not body.password or not body.full_name:
                    raise HTTPException(
                        status.HTTP_400_BAD_REQUEST,
                        "password and full_name required for first-time signup",
                    )
                ok, why = password_strong_enough(body.password)
                if not ok:
                    raise HTTPException(status.HTTP_400_BAD_REQUEST, why or "weak password")
                pw_hash = hash_password(body.password)
                row = await conn.fetchrow(
                    """
                    INSERT INTO accounts
                        (email, full_name, jurisdiction, password_hash, password_updated_at)
                    VALUES ($1, $2, 'ZW', $3, now())
                    RETURNING id, email, full_name
                    """,
                    invite.email, body.full_name, pw_hash,
                )
                account_id = row["id"]
                is_new_account = True
            else:
                account_id = existing["id"]
                # Caller can optionally set a password on a legacy/passwordless
                # account during invite acceptance.
                if existing["password_hash"] is None and body.password:
                    ok, why = password_strong_enough(body.password)
                    if not ok:
                        raise HTTPException(status.HTTP_400_BAD_REQUEST, why or "weak password")
                    await conn.execute(
                        "UPDATE accounts SET password_hash=$1, password_updated_at=now() WHERE id=$2",
                        hash_password(body.password), account_id,
                    )

                # Already a member? Just no-op the membership insert below.
                row = existing

            await conn.execute(
                """
                INSERT INTO company_members
                    (company_id, account_id, role, title, invited_by)
                VALUES ($1, $2, $3, $4,
                        (SELECT invited_by_account_id FROM invite_tokens WHERE id = $5))
                ON CONFLICT (company_id, account_id) DO NOTHING
                """,
                invite.company_id, account_id, invite.role, invite.title, invite.token_id,
            )

    set_session_cookie(response, account_id)
    return AuthResponse(
        account_id=account_id,
        email=row["email"],
        full_name=row["full_name"],
        is_new_account=is_new_account,
        company_id=invite.company_id,
    )


# ───────────────────────── helpers ──────────────────────────


async def _create_company_with_seed(
    conn: asyncpg.Connection, *, account_id: UUID, name: str,
) -> UUID:
    """Create a Company + owner membership + seeded Agents. Kept in this
    module so signup can create-and-join atomically without crossing the
    routes/companies.py boundary."""
    slug = await _unique_slug(conn, name)
    row = await conn.fetchrow(
        """
        INSERT INTO companies (name, slug, ceo_account_id, created_by)
        VALUES ($1, $2, $3, $3)
        RETURNING id
        """,
        name, slug, account_id,
    )
    cid: UUID = row["id"]

    await conn.execute(
        """
        INSERT INTO company_members (company_id, account_id, role, title)
        VALUES ($1, $2, 'owner', 'CEO')
        """,
        cid, account_id,
    )

    manager_id = None
    for spec in STARTER_AGENTS:
        preset = apply_preset(spec["personality"])
        reports_to = manager_id if spec["role"] != "manager" else None
        inserted = await conn.fetchval(
            """
            INSERT INTO agents (
                company_id, name, role, reports_to_agent_id,
                llm_provider, llm_model, voice_id, strategies,
                personality, trade_selection_mode,
                kelly_fraction, min_confidence_threshold, min_payoff_ratio,
                max_trades_per_day, target_holding_secs,
                trade_mode, created_by
            )
            VALUES (
                $1, $2, $3, $4,
                $5, $6, $7, $8,
                $9, 'balanced',
                $10, $11, $12,
                $13, $14,
                'approve_each', $15
            )
            RETURNING id
            """,
            cid, spec["name"], spec["role"], reports_to,
            spec["llm_provider"], spec["llm_model"], spec["voice_id"], spec["strategies"],
            spec["personality"],
            preset["kelly_fraction"], preset["min_confidence_threshold"], preset["min_payoff_ratio"],
            preset["max_trades_per_day"], preset["target_holding_secs"],
            account_id,
        )
        if spec["role"] == "manager":
            manager_id = inserted
    return cid


async def _unique_slug(conn: asyncpg.Connection, name: str) -> str:
    base = slugify(name) or "company"
    candidate = base
    n = 2
    while await conn.fetchval("SELECT 1 FROM companies WHERE slug = $1", candidate):
        candidate = f"{base}-{n}"
        n += 1
        if n > 1000:
            raise HTTPException(status.HTTP_409_CONFLICT, "slug exhaustion")
    return candidate
