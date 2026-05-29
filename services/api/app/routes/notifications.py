"""In-app notifications inbox.

Per-account list of items the topbar bell reads from. Currently
written by manager_review.py on meeting completion; future writers
can use the same shape (kind/title/body/link)."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel

from app.auth import CurrentAccount
from app.db import acquire

router = APIRouter(prefix="/notifications", tags=["notifications"])


class Notification(BaseModel):
    id: UUID
    kind: str
    title: str
    body: str | None
    link: str | None
    read_at: datetime | None
    created_at: datetime


class NotificationList(BaseModel):
    items: list[Notification]
    unread: int


@router.get("", response_model=NotificationList)
async def list_notifications(
    account_id: CurrentAccount,
    limit: Annotated[int, Query(ge=1, le=100)] = 30,
):
    async with acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT id, kind, title, body, link, read_at, created_at
            FROM notifications
            WHERE account_id = $1
            ORDER BY created_at DESC
            LIMIT $2
            """,
            account_id, limit,
        )
        unread = await conn.fetchval(
            "SELECT count(*) FROM notifications WHERE account_id=$1 AND read_at IS NULL",
            account_id,
        ) or 0
    return NotificationList(
        items=[
            Notification(
                id=r["id"], kind=r["kind"], title=r["title"],
                body=r["body"], link=r["link"],
                read_at=r["read_at"], created_at=r["created_at"],
            )
            for r in rows
        ],
        unread=int(unread),
    )


@router.post("/{notification_id}/read")
async def mark_read(notification_id: UUID, account_id: CurrentAccount):
    async with acquire() as conn:
        res = await conn.execute(
            """
            UPDATE notifications
            SET read_at = COALESCE(read_at, now())
            WHERE id = $1 AND account_id = $2
            """,
            notification_id, account_id,
        )
    if res.endswith(" 0"):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "notification not found")
    return {"ok": True}


@router.post("/read-all")
async def mark_all_read(account_id: CurrentAccount):
    async with acquire() as conn:
        res = await conn.execute(
            "UPDATE notifications SET read_at = now() WHERE account_id = $1 AND read_at IS NULL",
            account_id,
        )
    # res is like "UPDATE N" — pull the count for the response so the
    # UI knows how many were affected without re-fetching.
    try:
        n = int(res.split()[-1])
    except Exception:
        n = 0
    return {"ok": True, "marked": n}
