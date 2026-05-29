"""Pending employee → manager meeting requests.

Read-only endpoint surfacing the queue. Writes happen via the
`request_meeting_with_manager` tool the employee LLM calls; the
manager resolves them as part of the next review."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

import asyncpg
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from app.auth import CurrentAccount
from app.db import acquire

router = APIRouter(prefix="/companies/{company_id}", tags=["meetings"])


class PendingRequest(BaseModel):
    id: UUID
    employee_agent_id: UUID
    employee_name: str | None
    reason: str
    status: str
    created_at: datetime
    addressed_at: datetime | None
    addressed_action_id: UUID | None


async def _ensure_member(conn: asyncpg.Connection, company_id: UUID, account_id: UUID) -> None:
    role = await conn.fetchval(
        "SELECT role FROM company_members WHERE company_id=$1 AND account_id=$2",
        company_id, account_id,
    )
    if role is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "company not found")


@router.get("/meeting-requests", response_model=list[PendingRequest])
async def list_pending_requests(
    company_id: UUID, account_id: CurrentAccount,
):
    async with acquire() as conn:
        await _ensure_member(conn, company_id, account_id)
        rows = await conn.fetch(
            """
            SELECT r.id, r.employee_agent_id, r.reason, r.status,
                   r.created_at, r.addressed_at, r.addressed_action_id,
                   a.name AS employee_name
            FROM employee_meeting_requests r
            LEFT JOIN agents a ON a.id = r.employee_agent_id
            WHERE r.company_id = $1
            ORDER BY (r.status = 'pending') DESC, r.created_at DESC
            LIMIT 50
            """,
            company_id,
        )
    return [
        PendingRequest(
            id=r["id"],
            employee_agent_id=r["employee_agent_id"],
            employee_name=r["employee_name"],
            reason=r["reason"],
            status=r["status"],
            created_at=r["created_at"],
            addressed_at=r["addressed_at"],
            addressed_action_id=r["addressed_action_id"],
        )
        for r in rows
    ]
