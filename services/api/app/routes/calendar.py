"""Economic calendar — global event list.

Events are not per-company; this route just requires a signed-in user
(any authenticated account can see the calendar).
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Query
from pydantic import BaseModel

from app.auth import CurrentAccount
from app.db import acquire

router = APIRouter(prefix="/calendar", tags=["calendar"])


class EconomicEvent(BaseModel):
    event_id: str
    ts: datetime
    country: str
    name: str
    impact: str
    category: str | None
    previous: str | None
    forecast: str | None
    actual: str | None
    affected_currencies: list[str]
    affected_assets: list[str]
    source: str


class EventList(BaseModel):
    events: list[EconomicEvent]


@router.get("", response_model=EventList)
async def list_events(
    account_id: CurrentAccount,
    impact: Annotated[
        Literal["all", "high", "medium", "low"], Query()
    ] = "all",
    horizon_hours: Annotated[int, Query(ge=1, le=720)] = 168,
    limit: Annotated[int, Query(ge=1, le=500)] = 200,
):
    """Upcoming events within `horizon_hours` from now. Default = next week."""
    _ = account_id  # auth gate; we don't filter by company
    where_extra = "" if impact == "all" else "AND impact = $2"
    args: list = [horizon_hours]
    if impact != "all":
        args.append(impact)
    args.append(limit)
    sql = f"""
        SELECT event_id, ts, country, name, impact, category,
               previous, forecast, actual,
               affected_currencies, affected_assets, source
        FROM economic_events
        WHERE ts BETWEEN now() - interval '2 hours'
                     AND now() + (interval '1 hour' * $1)
          {where_extra}
        ORDER BY ts ASC
        LIMIT ${len(args)}
    """
    async with acquire() as conn:
        rows = await conn.fetch(sql, *args)
    return EventList(events=[EconomicEvent(**dict(r)) for r in rows])
