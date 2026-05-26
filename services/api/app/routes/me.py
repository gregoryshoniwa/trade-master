"""GET /api/v1/me — current user profile."""

from fastapi import APIRouter, HTTPException, status

from app.auth import CurrentAccount
from app.db import acquire
from app.schemas import Me

router = APIRouter(tags=["me"])


@router.get("/me", response_model=Me)
async def me(account_id: CurrentAccount):
    async with acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT id, email, full_name, jurisdiction, created_at
            FROM accounts
            WHERE id = $1
            """,
            account_id,
        )
        if row is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "account not found")

        # Active company: most recently joined; will be made explicit when we
        # add a server-side cookie / client-side preference. For Phase 0 this
        # is a sensible default the frontend can override.
        active = await conn.fetchval(
            """
            SELECT company_id
            FROM company_members
            WHERE account_id = $1
            ORDER BY joined_at DESC
            LIMIT 1
            """,
            account_id,
        )

    return Me(
        account_id=row["id"],
        email=row["email"],
        full_name=row["full_name"],
        jurisdiction=row["jurisdiction"],
        created_at=row["created_at"],
        active_company_id=active,
    )
