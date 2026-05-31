"""Member management — list, create directly, change role/name, reset
password, remove. The legacy invite endpoints are kept for backward
compatibility with any pending invite links but the UI no longer uses
them; the supported path is now direct create with an initial password."""

import os
import secrets
import string
from uuid import UUID

import asyncpg
from fastapi import APIRouter, HTTPException, status

from app.auth import (
    CurrentAccount,
    create_invite_token,
    hash_password,
    password_strong_enough,
)
from app.db import acquire
from app.schemas import (
    CompanyMember,
    CompanyMemberList,
    CreateMemberRequest,
    InviteCreate,
    InviteCreated,
    ResetMemberPasswordResponse,
    UpdateMemberRoleRequest,
)

router = APIRouter(prefix="/companies/{company_id}", tags=["members"])

WEB_ORIGIN = os.getenv("WEB_ORIGIN", "http://localhost:3000")
ALLOWED_INVITE_ROLES = {"admin", "trader", "viewer"}
WRITE_ROLES = {"owner", "admin"}


async def _caller_role(conn: asyncpg.Connection, company_id: UUID, account_id: UUID) -> str:
    role = await conn.fetchval(
        "SELECT role FROM company_members WHERE company_id = $1 AND account_id = $2",
        company_id, account_id,
    )
    if role is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "company not found")
    return role


@router.get("/members", response_model=CompanyMemberList)
async def list_members(company_id: UUID, account_id: CurrentAccount):
    async with acquire() as conn:
        await _caller_role(conn, company_id, account_id)
        rows = await conn.fetch(
            """
            SELECT a.id AS account_id, a.email, a.full_name,
                   m.role, m.title, m.joined_at
            FROM company_members m
            JOIN accounts a ON a.id = m.account_id
            WHERE m.company_id = $1
            ORDER BY
                CASE m.role
                    WHEN 'owner'  THEN 0
                    WHEN 'admin'  THEN 1
                    WHEN 'trader' THEN 2
                    WHEN 'viewer' THEN 3
                END,
                m.joined_at
            """,
            company_id,
        )
    return CompanyMemberList(members=[CompanyMember(**dict(r)) for r in rows])


@router.post("/invites", response_model=InviteCreated, status_code=status.HTTP_201_CREATED)
async def create_invite(
    company_id: UUID, body: InviteCreate, account_id: CurrentAccount,
):
    if body.role not in ALLOWED_INVITE_ROLES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "invalid invite role")

    email = body.email.lower()

    async with acquire() as conn:
        role = await _caller_role(conn, company_id, account_id)
        if role not in WRITE_ROLES:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "insufficient role")

        # Already a member?
        already = await conn.fetchval(
            """
            SELECT 1 FROM company_members m
            JOIN accounts a ON a.id = m.account_id
            WHERE m.company_id = $1 AND a.email = $2
            """,
            company_id, email,
        )
        if already:
            raise HTTPException(status.HTTP_409_CONFLICT, "user is already a member")

        # Pending invite for the same email?
        pending = await conn.fetchval(
            """
            SELECT id FROM invite_tokens
            WHERE company_id = $1 AND email = $2
              AND consumed_at IS NULL AND expires_at > now()
            """,
            company_id, email,
        )
        if pending:
            raise HTTPException(status.HTTP_409_CONFLICT, "an invite is already pending for this email")

    raw_token = await create_invite_token(
        email=email,
        company_id=company_id,
        role=body.role,
        title=body.title,
        invited_by_account_id=account_id,
    )

    # Fetch back the row to grab id + expiry for the response.
    async with acquire() as conn:
        row = await conn.fetchrow(
            "SELECT id, expires_at FROM invite_tokens WHERE token_hash = encode(sha256($1::bytea), 'hex')",
            raw_token.encode(),
        )

    accept_url = f"{WEB_ORIGIN}/auth/accept?token={raw_token}"
    return InviteCreated(
        invite_id=row["id"],
        email=email,
        role=body.role,
        title=body.title,
        expires_at=row["expires_at"],
        accept_url=accept_url,
    )


@router.post("/members", response_model=CompanyMember, status_code=status.HTTP_201_CREATED)
async def create_member(
    company_id: UUID, body: CreateMemberRequest, account_id: CurrentAccount,
):
    """Direct create — replaces the email-invite flow. Admin enters
    the new user's email + password and tells them out-of-band; the
    user can sign in immediately. If the email already has an account,
    we just attach them to this company (still requires admin to know
    the user's email; the password field is ignored when the account
    already exists)."""
    if body.role not in ALLOWED_INVITE_ROLES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "invalid role")
    ok, why = password_strong_enough(body.password)
    if not ok:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, why or "weak password")

    # Tier seat-cap — fail fast before we hash a password we won't keep.
    from app import tiers as _tiers
    await _tiers.gate_add_user(company_id)

    email = body.email.lower()
    async with acquire() as conn:
        async with conn.transaction():
            role = await _caller_role(conn, company_id, account_id)
            if role not in WRITE_ROLES:
                raise HTTPException(status.HTTP_403_FORBIDDEN, "insufficient role")

            existing = await conn.fetchrow(
                "SELECT id, full_name FROM accounts WHERE email = $1",
                email,
            )
            if existing:
                target_id = existing["id"]
                full_name = existing["full_name"] or body.full_name
                # Already a member of this company?
                dup = await conn.fetchval(
                    "SELECT 1 FROM company_members WHERE company_id=$1 AND account_id=$2",
                    company_id, target_id,
                )
                if dup:
                    raise HTTPException(status.HTTP_409_CONFLICT, "user is already a member")
            else:
                target_id = await conn.fetchval(
                    """
                    INSERT INTO accounts (email, full_name, password_hash, jurisdiction)
                    VALUES ($1, $2, $3, 'ZW')
                    RETURNING id
                    """,
                    email, body.full_name, hash_password(body.password),
                )
                full_name = body.full_name

            joined_at = await conn.fetchval(
                """
                INSERT INTO company_members (company_id, account_id, role, title)
                VALUES ($1, $2, $3, $4)
                RETURNING joined_at
                """,
                company_id, target_id, body.role, body.title,
            )

    return CompanyMember(
        account_id=target_id, email=email, full_name=full_name,
        role=body.role, title=body.title, joined_at=joined_at,
    )


def _gen_temp_password(length: int = 14) -> str:
    """Url-safe-ish temp password: 14 chars from a deliberately limited
    alphabet (no ambiguous characters) so the admin can verbally
    dictate it without confusion."""
    alphabet = "".join(c for c in (string.ascii_letters + string.digits)
                       if c not in "Il1O0o")
    return "".join(secrets.choice(alphabet) for _ in range(length))


@router.post("/members/{target_account_id}/reset-password", response_model=ResetMemberPasswordResponse)
async def reset_member_password(
    company_id: UUID, target_account_id: UUID, account_id: CurrentAccount,
):
    """Admin-initiated password reset. Generates a temp password,
    writes it to the account, and returns the plaintext to the calling
    admin to share with the user out-of-band. The user can change it
    themselves once they sign in."""
    async with acquire() as conn:
        async with conn.transaction():
            role = await _caller_role(conn, company_id, account_id)
            if role not in WRITE_ROLES:
                raise HTTPException(status.HTTP_403_FORBIDDEN, "insufficient role")
            target = await conn.fetchrow(
                """
                SELECT a.id, a.email, m.role
                FROM company_members m JOIN accounts a ON a.id = m.account_id
                WHERE m.company_id = $1 AND m.account_id = $2
                """,
                company_id, target_account_id,
            )
            if target is None:
                raise HTTPException(status.HTTP_404_NOT_FOUND, "member not found")
            # Admins can't reset owners (only an owner can).
            if target["role"] == "owner" and role != "owner":
                raise HTTPException(
                    status.HTTP_403_FORBIDDEN, "only an owner can reset another owner's password",
                )
            temp = _gen_temp_password()
            await conn.execute(
                "UPDATE accounts SET password_hash = $2 WHERE id = $1",
                target_account_id, hash_password(temp),
            )
    return ResetMemberPasswordResponse(
        account_id=target_account_id, email=target["email"], temp_password=temp,
    )


@router.patch("/members/{target_account_id}", response_model=CompanyMember)
async def update_member(
    company_id: UUID, target_account_id: UUID,
    body: UpdateMemberRoleRequest, account_id: CurrentAccount,
):
    """Partial update: role, title, or display name. Self-edit is
    allowed for `title` and `full_name` only; role changes require
    owner/admin."""
    self_edit = target_account_id == account_id
    async with acquire() as conn:
        async with conn.transaction():
            role = await _caller_role(conn, company_id, account_id)
            if not self_edit and role not in WRITE_ROLES:
                raise HTTPException(status.HTTP_403_FORBIDDEN, "insufficient role")
            if self_edit and body.role is not None:
                raise HTTPException(
                    status.HTTP_403_FORBIDDEN,
                    "can't change your own role — ask another owner/admin",
                )

            target = await conn.fetchrow(
                """
                SELECT a.id AS account_id, a.email, a.full_name,
                       m.role, m.title, m.joined_at
                FROM company_members m
                JOIN accounts a ON a.id = m.account_id
                WHERE m.company_id = $1 AND m.account_id = $2
                """,
                company_id, target_account_id,
            )
            if target is None:
                raise HTTPException(status.HTTP_404_NOT_FOUND, "member not found")

            new_role = body.role if body.role is not None else target["role"]
            new_title = body.title if body.title is not None else target["title"]
            new_full_name = body.full_name if body.full_name is not None else target["full_name"]

            # Don't let admins demote/promote owners — only an owner can do
            # owner-level changes.
            if body.role is not None and (target["role"] == "owner" or body.role == "owner") and role != "owner":
                raise HTTPException(
                    status.HTTP_403_FORBIDDEN,
                    "only an owner can change ownership-level roles",
                )

            # Don't let the last owner demote themselves.
            if target["role"] == "owner" and new_role != "owner":
                remaining_owners = await conn.fetchval(
                    """
                    SELECT count(*) FROM company_members
                    WHERE company_id = $1 AND role = 'owner' AND account_id <> $2
                    """,
                    company_id, target_account_id,
                )
                if remaining_owners == 0:
                    raise HTTPException(
                        status.HTTP_400_BAD_REQUEST,
                        "cannot demote the only remaining owner",
                    )

            updated = await conn.fetchrow(
                """
                UPDATE company_members
                SET role = $3, title = $4
                WHERE company_id = $1 AND account_id = $2
                RETURNING role, title, joined_at
                """,
                company_id, target_account_id, new_role, new_title,
            )
            if body.full_name is not None and new_full_name != target["full_name"]:
                await conn.execute(
                    "UPDATE accounts SET full_name = $2 WHERE id = $1",
                    target_account_id, new_full_name,
                )
    return CompanyMember(
        account_id=target["account_id"],
        email=target["email"],
        full_name=new_full_name,
        role=updated["role"],
        title=updated["title"],
        joined_at=updated["joined_at"],
    )


@router.delete("/members/{target_account_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_member(
    company_id: UUID, target_account_id: UUID, account_id: CurrentAccount,
):
    async with acquire() as conn:
        async with conn.transaction():
            role = await _caller_role(conn, company_id, account_id)
            if role not in WRITE_ROLES:
                raise HTTPException(status.HTTP_403_FORBIDDEN, "insufficient role")

            target_role = await conn.fetchval(
                "SELECT role FROM company_members WHERE company_id=$1 AND account_id=$2",
                company_id, target_account_id,
            )
            if target_role is None:
                raise HTTPException(status.HTTP_404_NOT_FOUND, "member not found")

            if target_role == "owner":
                # Owners can only be removed by other owners, and never the last one.
                if role != "owner":
                    raise HTTPException(
                        status.HTTP_403_FORBIDDEN,
                        "only an owner can remove another owner",
                    )
                others = await conn.fetchval(
                    """
                    SELECT count(*) FROM company_members
                    WHERE company_id = $1 AND role = 'owner' AND account_id <> $2
                    """,
                    company_id, target_account_id,
                )
                if others == 0:
                    raise HTTPException(
                        status.HTTP_400_BAD_REQUEST,
                        "cannot remove the only remaining owner",
                    )

            await conn.execute(
                "DELETE FROM company_members WHERE company_id=$1 AND account_id=$2",
                company_id, target_account_id,
            )
