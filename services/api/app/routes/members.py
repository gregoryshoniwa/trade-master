"""Member management — list, invite, change role, remove."""

import os
from uuid import UUID

import asyncpg
from fastapi import APIRouter, HTTPException, status

from app.auth import CurrentAccount, create_invite_token
from app.db import acquire
from app.schemas import (
    CompanyMember,
    CompanyMemberList,
    InviteCreate,
    InviteCreated,
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


@router.patch("/members/{target_account_id}", response_model=CompanyMember)
async def update_member(
    company_id: UUID, target_account_id: UUID,
    body: UpdateMemberRoleRequest, account_id: CurrentAccount,
):
    async with acquire() as conn:
        async with conn.transaction():
            role = await _caller_role(conn, company_id, account_id)
            if role not in WRITE_ROLES:
                raise HTTPException(status.HTTP_403_FORBIDDEN, "insufficient role")

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

            # Don't let admins demote/promote owners — only an owner can do
            # owner-level changes.
            if (target["role"] == "owner" or body.role == "owner") and role != "owner":
                raise HTTPException(
                    status.HTTP_403_FORBIDDEN,
                    "only an owner can change ownership-level roles",
                )

            # Don't let the last owner demote themselves.
            if target["role"] == "owner" and body.role != "owner":
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
                company_id, target_account_id, body.role, body.title,
            )
    return CompanyMember(
        account_id=target["account_id"],
        email=target["email"],
        full_name=target["full_name"],
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
