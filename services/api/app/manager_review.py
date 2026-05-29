"""Manager review cron (PLAN §10).

Once every few hours we walk every Company that has at least one
manager agent. For each, we:

  1. Build a team digest (delegated to the `get_team_status` tool the
     manager would have called).
  2. Call the manager's LLM with a focused review prompt + the manager
     tools enabled.
  3. Let the LLM call `adjust_employee` / `pause_employee` /
     `resume_employee` 0–3 times. Every action lands in
     `manager_actions` so the audit trail is intact.
  4. Always log a `review` action, even when the LLM didn't act, so the
     operator can tell "did the manager see the data?".

The tool runner already enforces role='manager' so this background task
just needs to pretend to be the manager agent — and it does, by setting
the ToolContext's agent_id to the manager's id.
"""

from __future__ import annotations

import asyncio
import json
import logging
from uuid import UUID

from app.db import acquire
from app.llm import LLMMessage, get_adapter
from app.tools import (
    MANAGER_TOOLS,
    ToolContext,
    available_tools,
    execute_tool,
)

log = logging.getLogger("trademaster.manager_review")

# How often to review. Fast enough to react to a bad streak, slow enough
# that we're not spending LLM budget every minute. Tunable per-company
# later.
REVIEW_INTERVAL_SECS = 4 * 60 * 60   # every 4 hours
# Cap how much work the manager can do in one pass — protects against a
# runaway LLM trying to "fix" everything at once.
MAX_TOOL_ROUNDS_PER_REVIEW = 4

_task: asyncio.Task | None = None


async def start() -> None:
    global _task
    if _task is not None:
        return
    _task = asyncio.create_task(_loop(), name="manager-review")
    log.info("manager review loop started — interval=%ss", REVIEW_INTERVAL_SECS)


async def stop() -> None:
    global _task
    if _task is None:
        return
    _task.cancel()
    try:
        await _task
    except (asyncio.CancelledError, Exception):
        pass
    _task = None


async def _loop() -> None:
    # 90 s head-start so the rest of startup settles. The review doesn't
    # need to fire at second 0.
    await asyncio.sleep(90)
    while True:
        try:
            n = await _review_once()
            if n:
                log.info("manager review completed for %d companies", n)
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("manager review pass failed; will retry")
        await asyncio.sleep(REVIEW_INTERVAL_SECS)


SYSTEM_PROMPT = """You are the Manager of an AI trading firm. Your job
is to review the team and make small, targeted adjustments to each
employee's tunable parameters to improve their accuracy and risk.

Decision principles:

* DO NOT adjust an employee that hasn't traded much (n < 20 over 7 days).
* If hit-rate is high (>55%) but P&L is negative, the issue is sizing
  or payoff ratio — raise `min_payoff_ratio` or lower `kelly_fraction`.
* If hit-rate is low (<48%), the issue is signal quality — raise
  `min_confidence_threshold` so they wait for better signals.
* If an employee is bleeding badly (P&L < -10% of allocation) and the
  fix isn't obvious, pause them. The CEO will investigate.
* Make at most ONE adjustment per employee per review. Tiny moves
  beat big ones. Examples of "tiny": +/- 0.05 on a threshold, +/- 0.1
  on Kelly.
* Always give a one-sentence `reason` for each action so the audit
  trail is readable.

Workflow:

1. Call `get_team_status` to see all employees.
2. Decide which (if any) need adjusting.
3. Call `adjust_employee` / `pause_employee` / `resume_employee` for
   each — at most 3 actions total.
4. End with a short text summary of what you changed and why."""

REVIEW_USER_PROMPT = (
    "Please run your scheduled team review now. Read the team status, "
    "decide if anything needs adjusting, take 0-3 actions, then summarize."
)


async def _review_once() -> int:
    """One pass over every company that has a manager agent."""
    async with acquire() as conn:
        managers = await conn.fetch(
            """
            SELECT a.id AS manager_id, a.company_id, a.name AS manager_name,
                   a.llm_provider, a.llm_model, a.system_prompt_addendum,
                   c.created_by AS owner_account_id
            FROM agents a
            JOIN companies c ON c.id = a.company_id
            WHERE a.role = 'manager' AND a.is_active = TRUE AND a.is_paused = FALSE
            """,
        )
    if not managers:
        return 0

    for m in managers:
        try:
            await _review_one_company(m)
        except Exception:
            log.exception("manager review failed for company=%s", m["company_id"])
    return len(managers)


async def _review_one_company(m) -> None:
    """Run the review for a single manager. Manager tool calls go through
    the shared execute_tool — same code path the chat agent uses — so
    the role guard, audit, and `manager_actions` writes are all reused.

    Each round of the review is also persisted as a `conversation` +
    `conversation_messages` thread, so the CEO can scroll back through
    what the manager actually thought and said. Activity timelines pick
    these up automatically."""
    company_id: UUID = m["company_id"]
    manager_id: UUID = m["manager_id"]
    owner_id: UUID = m["owner_account_id"]
    provider = m["llm_provider"]
    model = m["llm_model"]

    try:
        adapter = get_adapter(provider)
    except Exception as e:
        log.warning("manager %s on %s/%s — adapter unavailable: %s",
                    manager_id, provider, model, e)
        return

    # ToolContext spoofs the manager — the role guard in tools.py reads
    # agent_id from this and confirms role='manager' before letting the
    # call land. Tools that touch the DB use it for scoping.
    ctx = ToolContext(
        company_id=company_id, account_id=owner_id, agent_id=manager_id,
    )

    all_tools = available_tools()
    manager_addendum = (m.get("system_prompt_addendum") or "").strip()
    system = SYSTEM_PROMPT + (f"\n\n--- agent addendum ---\n{manager_addendum}" if manager_addendum else "")

    messages: list[LLMMessage] = [
        LLMMessage(role="user", content=REVIEW_USER_PROMPT),
    ]

    # Open a transcript conversation up-front so individual rounds land
    # immediately — useful for the activity feed which polls.
    conversation_id = await _open_review_conversation(
        company_id=company_id, account_id=owner_id, agent_id=manager_id,
    )
    await _append_message(conversation_id, company_id, "user", REVIEW_USER_PROMPT, None)

    final_text = ""
    round_no = 0
    for round_no in range(MAX_TOOL_ROUNDS_PER_REVIEW):
        resp = await adapter.chat(
            model=model, system=system, messages=messages,
            tools=all_tools, max_tokens=1500, temperature=0.3,
        )
        # Persist the assistant turn (text + any tool calls).
        await _append_message(
            conversation_id, company_id, "assistant",
            resp.text or "", [tc.model_dump() for tc in resp.tool_calls] if resp.tool_calls else None,
        )
        if resp.tool_calls:
            messages.append(LLMMessage(
                role="assistant", content=resp.text or None,
                tool_calls=resp.tool_calls,
            ))
            for tc in resp.tool_calls:
                # Only let manager tools land via this scheduled review —
                # the chat tools (get_pnl etc.) are fine to call too,
                # but the role guard already filters MANAGER_TOOLS.
                result_json = await execute_tool(tc.name, tc.arguments, ctx)
                # Persist the tool result so the transcript is complete.
                await _append_message(
                    conversation_id, company_id, "tool", result_json,
                    [{"id": tc.id, "name": tc.name}],
                )
                messages.append(LLMMessage(
                    role="tool", tool_call_id=tc.id, tool_result=result_json,
                ))
            continue
        final_text = resp.text
        break

    await _log_review(
        company_id=company_id, manager_id=manager_id, narrative=final_text,
    )
    log.info("manager %s reviewed company %s — %d round(s)",
             m["manager_name"], company_id, round_no + 1)


async def _open_review_conversation(
    *, company_id: UUID, account_id: UUID, agent_id: UUID,
) -> UUID:
    """Create a new conversation row to hold this review's transcript.

    Title is set up-front so the chat-history list shows something
    meaningful before the manager has responded."""
    async with acquire() as conn:
        cid = await conn.fetchval(
            """
            INSERT INTO conversations (company_id, account_id, agent_id, title, last_message_at)
            VALUES ($1, $2, $3, $4, now())
            RETURNING id
            """,
            company_id, account_id, agent_id, "Scheduled team review",
        )
    return cid


async def _append_message(
    conversation_id: UUID,
    company_id: UUID,
    role: str,
    content: str,
    tool_calls: list[dict] | None,
) -> None:
    import json as _json
    async with acquire() as conn:
        await conn.execute(
            """
            INSERT INTO conversation_messages
                (conversation_id, company_id, role, content, tool_calls, metadata)
            VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)
            """,
            conversation_id, company_id, role, content,
            _json.dumps(tool_calls) if tool_calls else None,
            _json.dumps({"source": "manager_review"}),
        )
        await conn.execute(
            "UPDATE conversations SET last_message_at = now() WHERE id = $1",
            conversation_id,
        )


async def _log_review(*, company_id: UUID, manager_id: UUID, narrative: str) -> None:
    async with acquire() as conn:
        await conn.execute(
            """
            INSERT INTO manager_actions
                (company_id, manager_agent_id, action_kind, llm_narrative)
            VALUES ($1, $2, 'review', $3)
            """,
            company_id, manager_id, (narrative or "").strip()[:8000],
        )
