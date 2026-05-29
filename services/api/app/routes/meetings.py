"""CEO-triggered manager meetings.

Two endpoints:
  - POST /companies/{cid}/manager/run-review  → "Run review now" button
  - POST /companies/{cid}/manager/meetings    → "Hold 1:1 with <employee>"

Both fire the actual LLM work as a background task — the response
returns immediately with `{accepted: true}` so the UI doesn't have to
wait 10+ seconds for the model. The transcript surfaces via the
activity feed once it lands.
"""

from __future__ import annotations

import asyncio
from uuid import UUID

import asyncpg
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from app.auth import CurrentAccount
from app.db import acquire
from app.manager_review import (
    trigger_meeting_followup,
    trigger_one_on_one,
    trigger_review_for_company,
)

router = APIRouter(prefix="/companies/{company_id}/manager", tags=["manager"])


class TriggerResponse(BaseModel):
    accepted: bool
    note: str | None = None


class MeetingRequest(BaseModel):
    employee_agent_id: UUID
    agenda: str | None = None


class MeetingFollowUp(BaseModel):
    message: str


async def _ensure_owner_or_admin(
    conn: asyncpg.Connection, company_id: UUID, account_id: UUID,
) -> None:
    role = await conn.fetchval(
        "SELECT role FROM company_members WHERE company_id=$1 AND account_id=$2",
        company_id, account_id,
    )
    if role is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "company not found")
    if role not in ("owner", "admin"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "owner/admin only")


@router.post("/run-review", response_model=TriggerResponse)
async def run_review_now(company_id: UUID, account_id: CurrentAccount):
    """Trigger an immediate team review by the company's manager agent."""
    async with acquire() as conn:
        await _ensure_owner_or_admin(conn, company_id, account_id)
        has_mgr = await conn.fetchval(
            "SELECT 1 FROM agents WHERE company_id=$1 AND role='manager' AND is_active",
            company_id,
        )
    if not has_mgr:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "no active manager agent on this company",
        )
    # Fire-and-forget — the review writes its own transcript and
    # manager_actions audit row when done.
    asyncio.create_task(trigger_review_for_company(company_id))
    return TriggerResponse(accepted=True, note="review running in background")


@router.post("/meetings", response_model=TriggerResponse)
async def schedule_meeting(
    company_id: UUID, body: MeetingRequest, account_id: CurrentAccount,
):
    """CEO-scheduled 1:1 between the manager and a specific employee."""
    async with acquire() as conn:
        await _ensure_owner_or_admin(conn, company_id, account_id)
        emp = await conn.fetchrow(
            """
            SELECT name, role FROM agents
            WHERE id = $1 AND company_id = $2
            """,
            body.employee_agent_id, company_id,
        )
        if emp is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "employee not found")
        if emp["role"] == "manager":
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "can't schedule the manager into a 1:1 with itself",
            )
    asyncio.create_task(trigger_one_on_one(
        company_id=company_id,
        employee_agent_id=body.employee_agent_id,
        agenda=body.agenda,
    ))
    return TriggerResponse(
        accepted=True,
        note=f"1:1 with {emp['name']} running in background",
    )


@router.post("/meetings/{meeting_id}/follow-up", response_model=TriggerResponse)
async def follow_up_meeting(
    company_id: UUID, meeting_id: UUID,
    body: MeetingFollowUp, account_id: CurrentAccount,
):
    """CEO is replying on the meeting detail page.

    Appends the message to the existing conversation and re-runs the
    manager with the full transcript as context. Background task; the
    UI shows a notification when the reply lands."""
    text = (body.message or "").strip()
    if not text:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "message is required")
    async with acquire() as conn:
        await _ensure_owner_or_admin(conn, company_id, account_id)
        exists = await conn.fetchval(
            """
            SELECT 1 FROM manager_actions
            WHERE id = $1 AND company_id = $2
              AND action_kind IN ('review', 'meeting')
              AND conversation_id IS NOT NULL
            """,
            meeting_id, company_id,
        )
    if not exists:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            "meeting not found, or it has no transcript to continue",
        )
    asyncio.create_task(trigger_meeting_followup(
        company_id=company_id, meeting_id=meeting_id, ceo_message=text,
    ))
    return TriggerResponse(accepted=True, note="manager is replying")
