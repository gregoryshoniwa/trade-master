"""Per-agent activity feed.

Merges every meaningful thing the agent (or the CEO, or the manager)
did with this agent — intents created/closed/rejected, manager
adjustments, chat exchanges — into one chronological stream the UI
can poll.

This is the single shared answer to "what is Kronny doing right now?"
and "what did Alpha change about Trendy this afternoon?". The data
all already exists; this endpoint just unions it and sorts."""

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

router = APIRouter(prefix="/companies/{company_id}/agents/{agent_id}", tags=["activity"])

EventKind = Literal[
    "intent_opened",        # an intent was created (any status)
    "intent_executed",      # broker filled — actually trading now
    "intent_closed",        # position closed; uses postmortem if available
    "intent_rejected",      # rejected_by_risk / rejected_by_user / expired
    "manager_action",       # manager adjusted / paused / resumed / reviewed
    "chat_message",         # user or assistant turn in conversation
]
Tone = Literal["bull", "bear", "accent", "muted"]


class ActivityEvent(BaseModel):
    ts: datetime
    kind: EventKind
    title: str
    detail: str | None = None
    tone: Tone = "muted"
    refs: dict[str, Any] = {}


class ActivityFeed(BaseModel):
    events: list[ActivityEvent]
    fetched_at: datetime


async def _ensure_member(conn: asyncpg.Connection, company_id: UUID, account_id: UUID) -> None:
    role = await conn.fetchval(
        "SELECT role FROM company_members WHERE company_id=$1 AND account_id=$2",
        company_id, account_id,
    )
    if role is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "company not found")


@router.get("/activity", response_model=ActivityFeed)
async def get_activity(
    company_id: UUID, agent_id: UUID, account_id: CurrentAccount,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
):
    """Latest `limit` events affecting this agent, newest first."""
    async with acquire() as conn:
        await _ensure_member(conn, company_id, account_id)
        # Confirm the agent belongs to the company before we trust the
        # caller's path params (defense in depth — the member check
        # already gates the company).
        exists = await conn.fetchval(
            "SELECT 1 FROM agents WHERE id=$1 AND company_id=$2",
            agent_id, company_id,
        )
        if not exists:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "agent not found")

        intents = await conn.fetch(
            """
            SELECT id, asset, contract_type, direction, status, stake_usd,
                   confidence, realized_pnl_usd, exit_reason,
                   risk_verdict, executed_at, closed_at, created_at, updated_at
            FROM trade_intents
            WHERE agent_id = $1
            ORDER BY created_at DESC
            LIMIT $2
            """,
            agent_id, limit,
        )
        postmortems = await conn.fetch(
            """
            SELECT p.id, p.intent_id, p.outcome, p.pnl_usd, p.generated_at,
                   i.asset, i.contract_type, i.direction
            FROM trade_postmortems p
            JOIN trade_intents i ON i.id = p.intent_id
            WHERE p.agent_id = $1
            ORDER BY p.generated_at DESC
            LIMIT $2
            """,
            agent_id, limit,
        )
        manager_acts = await conn.fetch(
            """
            SELECT id, action_kind, field_name, before_value, after_value,
                   reason, llm_narrative, created_at, manager_agent_id
            FROM manager_actions
            WHERE employee_agent_id = $1 OR manager_agent_id = $1
            ORDER BY created_at DESC
            LIMIT $2
            """,
            agent_id, limit,
        )
        messages = await conn.fetch(
            """
            SELECT m.id, m.role, m.content, m.tool_calls, m.created_at,
                   c.title AS conversation_title
            FROM conversation_messages m
            JOIN conversations c ON c.id = m.conversation_id
            WHERE c.agent_id = $1
              AND m.role IN ('user', 'assistant')
            ORDER BY m.created_at DESC
            LIMIT $2
            """,
            agent_id, limit,
        )

    events: list[ActivityEvent] = []
    for r in intents:
        events.extend(_intent_events(r))
    for r in postmortems:
        events.append(_postmortem_event(r))
    for r in manager_acts:
        events.append(_manager_action_event(r, agent_id))
    for r in messages:
        events.append(_message_event(r))

    events.sort(key=lambda e: e.ts, reverse=True)
    return ActivityFeed(events=events[:limit], fetched_at=datetime.utcnow())


# ─────────────────────────── builders ───────────────────────────


def _j(v: Any) -> dict | list:
    if v is None:
        return {}
    return json.loads(v) if isinstance(v, str) else v


def _intent_events(r: asyncpg.Record) -> list[ActivityEvent]:
    """An intent yields up to three events: created, executed, terminal.

    The terminal event (closed/rejected/expired) is preferred over the
    'opened' event if there's not enough room in the feed — the UI
    cares more about what happened than what was attempted."""
    intent_id = r["id"]
    asset = r["asset"]
    ct = r["contract_type"]
    direction = r["direction"]
    stake = float(r["stake_usd"])
    status = r["status"]
    out: list[ActivityEvent] = []

    arrow = "▲" if direction == "up" else "▼"
    base_title = f"{arrow} {ct} {asset} · ${stake:.2f}"

    # Always emit a "considered" event at creation time so the timeline
    # shows the agent thinking, not just acting.
    if status in ("rejected_by_risk", "rejected_by_user", "expired"):
        verdict = _j(r["risk_verdict"]) or {}
        reason = verdict.get("reason") or status.replace("_", " ")
        # Surface the specific failed check when there is one.
        failed = next(
            (c for c in (verdict.get("checks") or []) if c.get("passed") is False),
            None,
        )
        if failed and failed.get("detail"):
            reason = f"{failed.get('name')}: {failed['detail']}"
        out.append(ActivityEvent(
            ts=r["created_at"], kind="intent_rejected",
            title=f"declined {base_title}",
            detail=reason,
            tone="muted",
            refs={"intent_id": str(intent_id)},
        ))
        return out

    out.append(ActivityEvent(
        ts=r["created_at"], kind="intent_opened",
        title=f"intended {base_title}",
        detail=f"confidence {float(r['confidence']):.2f}, status={status}",
        tone="accent",
        refs={"intent_id": str(intent_id)},
    ))
    if r["executed_at"] is not None:
        out.append(ActivityEvent(
            ts=r["executed_at"], kind="intent_executed",
            title=f"filled {base_title}",
            tone="accent",
            refs={"intent_id": str(intent_id)},
        ))
    if r["closed_at"] is not None:
        pnl = float(r["realized_pnl_usd"]) if r["realized_pnl_usd"] is not None else 0.0
        win = pnl > 0
        out.append(ActivityEvent(
            ts=r["closed_at"], kind="intent_closed",
            title=f"closed {base_title} · {'+' if pnl >= 0 else ''}${pnl:.2f}",
            detail=r["exit_reason"],
            tone="bull" if win else ("bear" if pnl < 0 else "muted"),
            refs={"intent_id": str(intent_id)},
        ))
    return out


def _postmortem_event(r: asyncpg.Record) -> ActivityEvent:
    pnl = float(r["pnl_usd"])
    outcome = r["outcome"]
    tone: Tone = "bull" if outcome == "win" else ("bear" if outcome == "loss" else "muted")
    return ActivityEvent(
        ts=r["generated_at"], kind="intent_closed",
        title=f"postmortem · {outcome} {'+' if pnl >= 0 else ''}${pnl:.2f}",
        detail=f"{r['contract_type']} {r['asset']} {r['direction']}",
        tone=tone,
        refs={"intent_id": str(r["intent_id"]), "postmortem_id": str(r["id"])},
    )


def _format_val(v: Any) -> str:
    v = _j(v) if isinstance(v, (str, bytes)) and v not in ("", None) else v
    if v is None:
        return "—"
    if isinstance(v, (int, float)):
        return str(v)
    if isinstance(v, str):
        return v
    return json.dumps(v)


def _manager_action_event(r: asyncpg.Record, agent_id: UUID) -> ActivityEvent:
    kind = r["action_kind"]
    field = r["field_name"]
    reason = r["reason"] or ""
    is_about_me = r["manager_agent_id"] != agent_id
    actor = "manager" if is_about_me else "I (as manager)"
    title_parts: list[str] = []
    if kind == "adjust" and field:
        title_parts.append(
            f"{actor} adjusted {field} "
            f"{_format_val(r['before_value'])} → {_format_val(r['after_value'])}"
        )
    elif kind == "pause":
        title_parts.append(f"{actor} paused this agent")
    elif kind == "resume":
        title_parts.append(f"{actor} resumed this agent")
    else:
        title_parts.append(f"{actor} reviewed the team")
    tone: Tone = (
        "bear" if kind == "pause"
        else "bull" if kind == "resume"
        else "accent" if kind == "adjust"
        else "muted"
    )
    return ActivityEvent(
        ts=r["created_at"], kind="manager_action",
        title=" ".join(title_parts),
        detail=reason or r["llm_narrative"],
        tone=tone,
        refs={"manager_action_id": str(r["id"])},
    )


def _message_event(r: asyncpg.Record) -> ActivityEvent:
    role = r["role"]
    content = (r["content"] or "").strip()
    # Truncate so the feed stays scannable.
    preview = content[:140] + ("…" if len(content) > 140 else "")
    tools = _j(r["tool_calls"]) or []
    tool_names = ", ".join(t.get("name", "?") for t in tools) if isinstance(tools, list) else ""
    if role == "user":
        title = "CEO asked"
    elif tool_names:
        title = f"agent called {tool_names}"
    else:
        title = "agent replied"
    return ActivityEvent(
        ts=r["created_at"], kind="chat_message",
        title=title,
        detail=preview or None,
        tone="muted",
        refs={"message_id": str(r["id"])},
    )
