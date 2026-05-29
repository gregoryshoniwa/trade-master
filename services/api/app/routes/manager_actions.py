"""Manager actions: audit feed for what the Manager Agent did to whom.

Read-only. The Manager Agent writes via app.tools / app.manager_review;
these endpoints just surface what landed."""

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

router = APIRouter(prefix="/companies/{company_id}", tags=["manager_actions"])


class ManagerAction(BaseModel):
    id: UUID
    company_id: UUID
    manager_agent_id: UUID
    manager_name: str | None
    employee_agent_id: UUID | None
    employee_name: str | None
    action_kind: str
    field_name: str | None
    before_value: Any
    after_value: Any
    reason: str | None
    llm_narrative: str | None
    created_at: datetime


class ManagerActionList(BaseModel):
    actions: list[ManagerAction]
    total: int
    limit: int
    offset: int


async def _ensure_member(conn: asyncpg.Connection, company_id: UUID, account_id: UUID) -> str:
    role = await conn.fetchval(
        "SELECT role FROM company_members WHERE company_id=$1 AND account_id=$2",
        company_id, account_id,
    )
    if role is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "company not found")
    return role


def _j(v):
    if v is None:
        return None
    return json.loads(v) if isinstance(v, str) else v


def _row(r: asyncpg.Record) -> ManagerAction:
    return ManagerAction(
        id=r["id"],
        company_id=r["company_id"],
        manager_agent_id=r["manager_agent_id"],
        manager_name=r["manager_name"],
        employee_agent_id=r["employee_agent_id"],
        employee_name=r["employee_name"],
        action_kind=r["action_kind"],
        field_name=r["field_name"],
        before_value=_j(r["before_value"]),
        after_value=_j(r["after_value"]),
        reason=r["reason"],
        llm_narrative=r["llm_narrative"],
        created_at=r["created_at"],
    )


_SELECT = """
    SELECT ma.*,
           mgr.name AS manager_name,
           emp.name AS employee_name
    FROM manager_actions ma
    LEFT JOIN agents mgr ON mgr.id = ma.manager_agent_id
    LEFT JOIN agents emp ON emp.id = ma.employee_agent_id
"""


@router.get("/manager-actions", response_model=ManagerActionList)
async def list_manager_actions(
    company_id: UUID,
    account_id: CurrentAccount,
    employee_id: Annotated[UUID | None, Query()] = None,
    action_kind: Annotated[Literal["review", "adjust", "pause", "resume"] | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 25,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    clauses: list[str] = ["ma.company_id = $1"]
    args: list[Any] = [company_id]
    if employee_id is not None:
        args.append(employee_id)
        clauses.append(f"ma.employee_agent_id = ${len(args)}")
    if action_kind is not None:
        args.append(action_kind)
        clauses.append(f"ma.action_kind = ${len(args)}")
    where = " AND ".join(clauses)

    page_sql = _SELECT + f"""
        WHERE {where}
        ORDER BY ma.created_at DESC
        LIMIT ${len(args) + 1} OFFSET ${len(args) + 2}
    """
    count_sql = f"SELECT count(*) FROM manager_actions ma WHERE {where}"

    async with acquire() as conn:
        await _ensure_member(conn, company_id, account_id)
        total = await conn.fetchval(count_sql, *args)
        rows = await conn.fetch(page_sql, *args, limit, offset)

    return ManagerActionList(
        actions=[_row(r) for r in rows],
        total=int(total or 0),
        limit=limit,
        offset=offset,
    )
