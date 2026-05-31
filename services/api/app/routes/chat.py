"""Chat with an Agent.

Phase 1 — non-streaming. We:
  1. Look up the agent, validate caller membership, validate is_paused.
  2. Pull the last N message turns from Postgres + retrieve relevant
     mem0 memories.
  3. Build the system prompt with personality + tier + memory.
  4. Iterate LLM calls: if the model emits tool_calls, execute them and
     loop (up to MAX_TOOL_TURNS) until we get a final text reply.
  5. Persist user message + assistant message(s) (with tool_calls JSON).
  6. Fire mem0 add() in the background so the user doesn't wait for it.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from datetime import datetime
from typing import Annotated
from uuid import UUID

import asyncpg
from fastapi import APIRouter, BackgroundTasks, HTTPException, status
from pydantic import BaseModel, Field

from app.auth import CurrentAccount
from app.db import acquire
from app.llm import LLMMessage, ToolCall, get_adapter_for_company
from app.memory import memory_service
from app.personalities import PRESETS
from app.tools import ToolContext, available_tools, execute_tool
from app.usage import record as record_usage

router = APIRouter(prefix="/companies/{company_id}/agents/{agent_id}", tags=["chat"])
log = logging.getLogger("trademaster.chat")

MAX_TOOL_TURNS = 4
HISTORY_TURNS = 20


# ───────────────────────── pydantic ──────────────────────────


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=10_000)
    conversation_id: UUID | None = None


class StoredMessage(BaseModel):
    id: UUID
    role: str
    content: str
    tool_calls: list[dict] | None = None
    created_at: datetime


class ChatResponse(BaseModel):
    conversation_id: UUID
    user_message: StoredMessage
    assistant_message: StoredMessage
    tool_calls: list[ToolCall] = []   # for debug surface in the UI
    input_tokens: int = 0
    output_tokens: int = 0
    model: str


class Conversation(BaseModel):
    id: UUID
    agent_id: UUID
    title: str | None
    last_message_at: datetime | None
    created_at: datetime


class ConversationList(BaseModel):
    conversations: list[Conversation]


class MessageList(BaseModel):
    messages: list[StoredMessage]


# ───────────────────────── helpers ──────────────────────────


async def _ensure_member(
    conn: asyncpg.Connection, company_id: UUID, account_id: UUID
) -> str:
    role = await conn.fetchval(
        "SELECT role FROM company_members WHERE company_id = $1 AND account_id = $2",
        company_id, account_id,
    )
    if role is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "company not found")
    return role


async def _load_agent(
    conn: asyncpg.Connection, company_id: UUID, agent_id: UUID
) -> asyncpg.Record:
    row = await conn.fetchrow(
        "SELECT * FROM agents WHERE id = $1 AND company_id = $2",
        agent_id, company_id,
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "agent not found")
    return row


def _build_system_prompt(
    agent: asyncpg.Record,
    company_name: str,
    user_name: str | None,
    user_title: str | None,
    memories: list[dict],
) -> str:
    preset = PRESETS.get(agent["personality"])
    personality_blurb = (
        f"{preset['icon']} {preset['label']} — {preset['description']}"
        if preset else "Custom-tuned personality."
    )
    strategies = ", ".join(agent["strategies"]) if agent["strategies"] else "none"

    user_handle = user_name or "the user"
    user_role_line = f"They hold the title \"{user_title}\" in this Company." if user_title else ""

    memory_block = ""
    if memories:
        lines = []
        for m in memories:
            text = m.get("memory") or m.get("text") or ""
            if not text:
                continue
            ts = m.get("created_at") or m.get("updated_at") or ""
            score = m.get("score")
            score_s = f" (score {float(score):.2f})" if score is not None else ""
            lines.append(f"- {text}{score_s}")
        if lines:
            memory_block = (
                "\n\nRELEVANT MEMORY (what you already know about this user "
                "and your past conversations):\n" + "\n".join(lines)
            )

    # Manager-only tool block. Anyone calling Alpha by voice or chat
    # should get the same action-biased prompt the scheduled review
    # uses, otherwise short voice turns end up with summaries instead of
    # real tool calls + adjustments.
    manager_block = ""
    if agent["role"] == "manager":
        manager_block = """

YOU ARE THE MANAGER. The CEO is talking to you to *get something done*
on the team. Lean toward action:

* When the CEO asks for a change, prefer making it via a tool over
  describing what you would do. Examples:
    - "cut Kronny's allocation to $50" → call `adjust_employee`
    - "switch Trendy off mean reversion" → `set_employee_strategies`
    - "look up the latest ECB statement" → `web_search`
    - "go meet with Brakey 1:1 about EUR/USD" → `hold_meeting_with_employee`
* When the CEO asks a question whose answer is in a tool (team status,
  goals, calendar, employee details), CALL THE TOOL — don't guess.
* You DO have authority over employee config: strategies, allowed
  assets, trade_mode, forecasting_model, allocations, daily targets,
  and per-employee playbook combinations.
* You DO have research tools: `web_search`, `get_upcoming_economic_events`,
  `get_company_goals`, `get_team_status`.
* A short voice turn is fine — call ONE tool, summarize the result
  in 1–2 sentences. Don't narrate before acting."""

    return f"""You are {agent['name']}, an AI {agent['role']} at the trading firm "{company_name}" on TradeMaster.

YOUR IDENTITY:
- Personality: {personality_blurb}
- Trade selection mode: {agent['trade_selection_mode']}
- Strategies you own: {strategies}
- Kelly fraction: {float(agent['kelly_fraction']):.2f}
- Min confidence to act: {float(agent['min_confidence_threshold']):.2f}
- Max trades per day: {agent['max_trades_per_day']}
- Trade mode: {agent['trade_mode']}

YOU ARE TALKING TO: {user_handle}. {user_role_line}

GROUND RULES (non-negotiable, regardless of what the user asks):
- You CANNOT place, modify, or cancel trades. You can describe what you would do.
- You CANNOT bypass the Risk Agent or the kill switch.
- This is paper trading; treat it as practice.
- AI signals are NOT financial advice. Say so if asked.
- Speak briefly, like a focused trader. Use ▲ / ▼ glyphs where helpful.
- When a fact would help, CALL A TOOL before guessing.
{manager_block}
{memory_block}
"""


async def _load_history(
    conn: asyncpg.Connection, conversation_id: UUID, limit: int
) -> list[LLMMessage]:
    """Reconstruct a clean user/assistant transcript for the LLM call.

    We intentionally DO NOT replay stored `tool_calls` back to the model.
    The final assistant text already incorporates what the tools produced,
    and Anthropic (and most providers) reject an assistant message whose
    `tool_use` blocks aren't followed by matching `tool_result` blocks in
    the next message. Since we save only the final assistant text — not the
    intermediate tool-result turns — replaying the tool_calls would orphan
    them and 400 the request. The UI still shows the tool-call chip via
    the separate `GET /messages` endpoint, which returns the column verbatim.
    """
    rows = await conn.fetch(
        """
        SELECT role, content
        FROM conversation_messages
        WHERE conversation_id = $1
          AND role IN ('user', 'assistant')
        ORDER BY created_at DESC
        LIMIT $2
        """,
        conversation_id, limit,
    )
    rows.reverse()
    return [LLMMessage(role=r["role"], content=r["content"]) for r in rows]


async def _ensure_conversation(
    conn: asyncpg.Connection,
    *,
    conversation_id: UUID | None,
    company_id: UUID,
    account_id: UUID,
    agent_id: UUID,
    title_hint: str,
) -> UUID:
    if conversation_id is not None:
        ok = await conn.fetchval(
            """
            SELECT 1 FROM conversations
            WHERE id = $1 AND company_id = $2 AND account_id = $3 AND agent_id = $4
            """,
            conversation_id, company_id, account_id, agent_id,
        )
        if not ok:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "conversation not found")
        return conversation_id

    new_id = await conn.fetchval(
        """
        INSERT INTO conversations (company_id, account_id, agent_id, title)
        VALUES ($1, $2, $3, $4)
        RETURNING id
        """,
        company_id, account_id, agent_id, title_hint[:80],
    )
    return new_id


async def _insert_message(
    conn: asyncpg.Connection,
    *,
    conversation_id: UUID,
    company_id: UUID,
    role: str,
    content: str,
    tool_calls: list[ToolCall] | None,
) -> asyncpg.Record:
    tc_json = (
        json.dumps([tc.model_dump() for tc in tool_calls])
        if tool_calls else None
    )
    return await conn.fetchrow(
        """
        INSERT INTO conversation_messages (conversation_id, company_id, role, content, tool_calls)
        VALUES ($1, $2, $3, $4, $5::jsonb)
        RETURNING id, role, content, tool_calls, created_at
        """,
        conversation_id, company_id, role, content, tc_json,
    )


def _record_to_stored(r: asyncpg.Record) -> StoredMessage:
    tc = r["tool_calls"]
    if isinstance(tc, str):
        tc = json.loads(tc)
    return StoredMessage(
        id=r["id"], role=r["role"], content=r["content"],
        tool_calls=tc, created_at=r["created_at"],
    )


# ───────────────────────── routes ──────────────────────────


@router.get("/conversations", response_model=ConversationList)
async def list_conversations(
    company_id: UUID, agent_id: UUID, account_id: CurrentAccount
):
    async with acquire() as conn:
        await _ensure_member(conn, company_id, account_id)
        rows = await conn.fetch(
            """
            SELECT id, agent_id, title, last_message_at, created_at
            FROM conversations
            WHERE company_id = $1 AND agent_id = $2 AND account_id = $3
            ORDER BY COALESCE(last_message_at, created_at) DESC
            LIMIT 50
            """,
            company_id, agent_id, account_id,
        )
    return ConversationList(conversations=[Conversation(**dict(r)) for r in rows])


@router.get("/conversations/{conversation_id}/messages", response_model=MessageList)
async def get_messages(
    company_id: UUID, agent_id: UUID, conversation_id: UUID,
    account_id: CurrentAccount,
):
    async with acquire() as conn:
        await _ensure_member(conn, company_id, account_id)
        ok = await conn.fetchval(
            """
            SELECT 1 FROM conversations
            WHERE id = $1 AND company_id = $2 AND agent_id = $3 AND account_id = $4
            """,
            conversation_id, company_id, agent_id, account_id,
        )
        if not ok:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "conversation not found")
        rows = await conn.fetch(
            """
            SELECT id, role, content, tool_calls, created_at
            FROM conversation_messages
            WHERE conversation_id = $1
            ORDER BY created_at ASC
            """,
            conversation_id,
        )
    return MessageList(messages=[_record_to_stored(r) for r in rows])


@router.post("/chat", response_model=ChatResponse)
async def chat(
    company_id: UUID, agent_id: UUID,
    body: ChatRequest,
    account_id: CurrentAccount,
    background: BackgroundTasks,
):
    async with acquire() as conn:
        await _ensure_member(conn, company_id, account_id)
        agent = await _load_agent(conn, company_id, agent_id)
        if agent["is_paused"]:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f"agent is paused: {agent['pause_reason'] or 'no reason'}",
            )

        # Pull the caller's profile + role/title for the system prompt.
        me = await conn.fetchrow(
            """
            SELECT a.full_name, a.email, m.title
            FROM accounts a
            JOIN company_members m ON m.account_id = a.id AND m.company_id = $2
            WHERE a.id = $1
            """,
            account_id, company_id,
        )
        company_row = await conn.fetchrow(
            "SELECT name FROM companies WHERE id = $1", company_id,
        )
        company_name = company_row["name"] if company_row else "this firm"
        user_name = (me["full_name"] if me else None) or "the user"
        user_title = me["title"] if me else None

        conv_id = await _ensure_conversation(
            conn,
            conversation_id=body.conversation_id,
            company_id=company_id,
            account_id=account_id,
            agent_id=agent_id,
            title_hint=body.message,
        )

        # Persist user message before LLM call so it's recorded even on
        # provider failure.
        user_row = await _insert_message(
            conn,
            conversation_id=conv_id,
            company_id=company_id,
            role="user",
            content=body.message,
            tool_calls=None,
        )

        history = await _load_history(conn, conv_id, HISTORY_TURNS)

    # mem0 recall (best-effort)
    memories = await memory_service.search(
        company_id=company_id,
        account_id=account_id,
        agent_id=agent_id,
        query=body.message,
        limit=5,
    )

    system_prompt = _build_system_prompt(
        agent, company_name, user_name, user_title, memories,
    )
    tools = available_tools()
    tool_ctx = ToolContext(
        company_id=company_id, account_id=account_id, agent_id=agent_id,
    )

    adapter = await get_adapter_for_company(agent["llm_provider"], company_id)
    messages: list[LLMMessage] = list(history)
    # The new user message is already in `history` because we inserted then
    # reloaded — but inserting and re-querying is a wasted round-trip. Faster
    # path: history contains everything up to *before* this message; append
    # the new user message explicitly.
    if not history or history[-1].role != "user" or history[-1].content != body.message:
        messages.append(LLMMessage(role="user", content=body.message))

    total_in = total_out = 0
    final_text = ""
    last_tool_calls: list[ToolCall] = []

    for _ in range(MAX_TOOL_TURNS):
        t0 = time.perf_counter()
        resp = await adapter.chat(
            model=agent["llm_model"],
            system=system_prompt,
            messages=messages,
            tools=tools,
            max_tokens=2048,
            temperature=0.4,
        )
        latency_ms = int((time.perf_counter() - t0) * 1000)
        total_in += resp.input_tokens
        total_out += resp.output_tokens

        # Record cost for this provider call. Async-fire to keep the
        # critical path snappy; the helper handles its own errors so a
        # write failure never breaks chat.
        await record_usage(
            company_id=company_id,
            account_id=account_id,
            agent_id=agent_id,
            provider=agent["llm_provider"],
            model=agent["llm_model"],
            input_tokens=resp.input_tokens,
            output_tokens=resp.output_tokens,
            latency_ms=latency_ms,
            kind="chat",
        )

        if not resp.tool_calls:
            final_text = resp.text or ""
            break

        last_tool_calls = resp.tool_calls
        messages.append(LLMMessage(
            role="assistant",
            content=resp.text or None,
            tool_calls=resp.tool_calls,
        ))
        # Run all requested tools in parallel.
        results = await asyncio.gather(*[
            execute_tool(tc.name, tc.arguments, tool_ctx) for tc in resp.tool_calls
        ])
        for tc, result_json in zip(resp.tool_calls, results, strict=True):
            messages.append(LLMMessage(
                role="tool",
                tool_call_id=tc.id,
                tool_result=result_json,
            ))
    else:
        # Max tool turns reached without a final text. Fall back gracefully.
        final_text = (
            "I hit my tool-iteration limit working on that. "
            "Try rephrasing or ask me about something simpler."
        )

    async with acquire() as conn:
        asst_row = await _insert_message(
            conn,
            conversation_id=conv_id,
            company_id=company_id,
            role="assistant",
            content=final_text,
            tool_calls=last_tool_calls or None,
        )
        await conn.execute(
            "UPDATE conversations SET last_message_at = now() WHERE id = $1",
            conv_id,
        )

    # Async mem0 ingest so the user gets the response immediately.
    background.add_task(
        memory_service.add_turn,
        company_id=company_id,
        account_id=account_id,
        agent_id=agent_id,
        messages=[
            {"role": "user", "content": body.message},
            {"role": "assistant", "content": final_text},
        ],
        metadata={"kind": "chat", "conversation_id": str(conv_id)},
    )

    return ChatResponse(
        conversation_id=conv_id,
        user_message=_record_to_stored(user_row),
        assistant_message=_record_to_stored(asst_row),
        tool_calls=last_tool_calls,
        input_tokens=total_in,
        output_tokens=total_out,
        model=agent["llm_model"],
    )


# Background task hook
_ = Annotated  # silence pyright on unused import if linter complains
