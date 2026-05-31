"""Meetings list + detail.

Source-of-truth is `manager_actions` rows where `action_kind` is
`review` or `meeting`. Each row optionally references a `conversations`
row whose `conversation_messages` are the full transcript.

Routes:
  GET /companies/{cid}/meetings           list (review + 1:1)
  GET /companies/{cid}/meetings/{id}      detail with transcript
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Annotated, Any, Literal
from uuid import UUID

import asyncpg
from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel

from app.auth import CurrentAccount
from app.db import acquire

router = APIRouter(prefix="/companies/{company_id}/meetings", tags=["meetings"])


class MeetingSummary(BaseModel):
    id: UUID
    kind: Literal["review", "meeting"]
    manager_agent_id: UUID | None
    manager_name: str | None
    employee_name: str | None
    employee_agent_id: UUID | None
    agenda: str | None
    narrative_preview: str | None
    has_transcript: bool
    created_at: datetime


class MeetingsPage(BaseModel):
    """Paginated envelope. `total` is the count under the same filters
    (kind, employee_id) — drives the page indicator without a second
    round trip from the frontend."""
    items: list[MeetingSummary]
    total: int


class MeetingTranscriptTurn(BaseModel):
    role: str
    content: str
    tool_calls: Any
    created_at: datetime


class MeetingDetail(MeetingSummary):
    narrative: str | None
    transcript: list[MeetingTranscriptTurn]


async def _ensure_member(conn: asyncpg.Connection, company_id: UUID, account_id: UUID) -> None:
    role = await conn.fetchval(
        "SELECT role FROM company_members WHERE company_id=$1 AND account_id=$2",
        company_id, account_id,
    )
    if role is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "company not found")


def _preview(text: str | None, length: int = 240) -> str | None:
    if not text:
        return None
    t = text.strip()
    if len(t) <= length:
        return t
    return t[:length].rsplit(" ", 1)[0] + "…"


def _agenda_from_reason(reason: str | None) -> str | None:
    """`_log_meeting` stores the agenda inside `reason` prefixed with
    '1:1 agenda: '. Strip that prefix when surfacing to the UI."""
    if not reason:
        return None
    prefix = "1:1 agenda: "
    return reason[len(prefix):] if reason.startswith(prefix) else reason


@router.get("", response_model=MeetingsPage)
async def list_meetings(
    company_id: UUID, account_id: CurrentAccount,
    kind: Annotated[Literal["review", "meeting"] | None, Query()] = None,
    employee_id: Annotated[UUID | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 20,
    offset: Annotated[int, Query(ge=0, le=100_000)] = 0,
):
    """Paginated list of reviews + 1:1 meetings, filterable by kind and
    by the employee an agent met with. Returns `total` so the UI can
    render a "page X of Y" without a second roundtrip."""
    clauses = ["ma.company_id = $1", "ma.action_kind IN ('review', 'meeting')"]
    args: list[Any] = [company_id]
    if kind is not None:
        args.append(kind)
        clauses.append(f"ma.action_kind = ${len(args)}")
    if employee_id is not None:
        args.append(employee_id)
        clauses.append(f"ma.employee_agent_id = ${len(args)}")
    where = " AND ".join(clauses)

    async with acquire() as conn:
        await _ensure_member(conn, company_id, account_id)
        total = await conn.fetchval(
            f"SELECT COUNT(*) FROM manager_actions ma WHERE {where}",
            *args,
        )
        # Tack on limit + offset for the paged query — fresh positional
        # slots so we don't reorder the filter args above.
        args.append(limit)
        args.append(offset)
        rows = await conn.fetch(
            f"""
            SELECT ma.id, ma.action_kind, ma.reason, ma.llm_narrative,
                   ma.conversation_id, ma.created_at,
                   ma.employee_agent_id, ma.manager_agent_id,
                   mgr.name AS manager_name,
                   emp.name AS employee_name
            FROM manager_actions ma
            LEFT JOIN agents mgr ON mgr.id = ma.manager_agent_id
            LEFT JOIN agents emp ON emp.id = ma.employee_agent_id
            WHERE {where}
            ORDER BY ma.created_at DESC
            LIMIT ${len(args) - 1} OFFSET ${len(args)}
            """,
            *args,
        )
    return MeetingsPage(
        total=int(total or 0),
        items=[
            MeetingSummary(
                id=r["id"],
                kind=r["action_kind"],
                manager_agent_id=r["manager_agent_id"],
                manager_name=r["manager_name"],
                employee_name=r["employee_name"],
                employee_agent_id=r["employee_agent_id"],
                agenda=_agenda_from_reason(r["reason"]),
                narrative_preview=_preview(r["llm_narrative"]),
                has_transcript=r["conversation_id"] is not None,
                created_at=r["created_at"],
            )
            for r in rows
        ],
    )


@router.get("/{meeting_id}", response_model=MeetingDetail)
async def get_meeting(
    company_id: UUID, meeting_id: UUID, account_id: CurrentAccount,
):
    async with acquire() as conn:
        await _ensure_member(conn, company_id, account_id)
        row = await conn.fetchrow(
            """
            SELECT ma.id, ma.action_kind, ma.reason, ma.llm_narrative,
                   ma.conversation_id, ma.created_at,
                   ma.employee_agent_id, ma.manager_agent_id,
                   mgr.name AS manager_name,
                   emp.name AS employee_name
            FROM manager_actions ma
            LEFT JOIN agents mgr ON mgr.id = ma.manager_agent_id
            LEFT JOIN agents emp ON emp.id = ma.employee_agent_id
            WHERE ma.id = $1 AND ma.company_id = $2
              AND ma.action_kind IN ('review', 'meeting')
            """,
            meeting_id, company_id,
        )
        if row is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "meeting not found")
        transcript: list[MeetingTranscriptTurn] = []
        if row["conversation_id"]:
            msgs = await conn.fetch(
                """
                SELECT role, content, tool_calls, created_at
                FROM conversation_messages
                WHERE conversation_id = $1
                ORDER BY created_at ASC
                """,
                row["conversation_id"],
            )
            for m in msgs:
                tc: Any = m["tool_calls"]
                if isinstance(tc, str):
                    try:
                        tc = json.loads(tc)
                    except Exception:
                        tc = None
                transcript.append(MeetingTranscriptTurn(
                    role=m["role"], content=m["content"] or "",
                    tool_calls=tc, created_at=m["created_at"],
                ))
    return MeetingDetail(
        id=row["id"],
        kind=row["action_kind"],
        manager_agent_id=row["manager_agent_id"],
        manager_name=row["manager_name"],
        employee_name=row["employee_name"],
        employee_agent_id=row["employee_agent_id"],
        agenda=_agenda_from_reason(row["reason"]),
        narrative=row["llm_narrative"],
        narrative_preview=_preview(row["llm_narrative"]),
        has_transcript=row["conversation_id"] is not None,
        created_at=row["created_at"],
        transcript=transcript,
    )
