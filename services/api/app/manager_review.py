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
import contextvars
import json
import logging
from uuid import UUID

# Set inside `_run_one_on_one` so the `hold_meeting_with_employee`
# tool can refuse to recurse — without this guard a manager that's
# already in a meeting can keep scheduling more meetings, spawning
# unbounded background tasks.
in_meeting_with: contextvars.ContextVar[UUID | None] = contextvars.ContextVar(
    "in_meeting_with", default=None,
)

from app.db import acquire
from app.llm import LLMMessage, get_adapter_for_company
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
is to review the team and make small, targeted adjustments to keep
each employee improving — by tuning parameters, swapping strategies,
restricting assets, or pausing them when things go wrong.

What you can change on each employee (via tools):
* Numeric knobs: min_confidence_threshold, kelly_fraction,
  min_payoff_ratio, max_position_size_usd, max_trades_per_day,
  target_holding_secs, allocated_balance_usd, daily_profit_target_usd
  → use `adjust_employee`.
* Their strategies list (trend_following, breakout, mean_reversion,
  support_resistance, price_action) → call `get_available_strategies`
  to read the catalog, then `set_employee_strategies` to replace.
* Their forecasting model (TTM vs Kronos) → `get_available_forecasting_models`
  then `set_employee_forecasting_model`.
* Their allowed assets → `get_available_assets` then
  `set_employee_allowed_assets`.
* Their trade_mode (autonomous / approve_each / approve_above_threshold)
  → `set_employee_trade_mode` — tighten oversight on a losing employee
  by moving them to approve_each; relax it again once they recover.
* Their custom playbook of (strategy, asset, contract) combinations
  → `add_strategy_combination` / `clear_strategy_combinations`. This
  is how you build a "winning strategy": narrow an employee to the
  specific intersections that have worked.

Research tools available to you:
* `get_company_goals` — read the CEO's daily profit target.
* `get_upcoming_economic_events` — calendar windows that affect risk.
* `web_search` — search the live internet (Tavily / DuckDuckGo) for
  news, central-bank statements, market regimes. USE THIS BEFORE
  proposing a strategy change you're not 100% sure about. The CEO
  pays a small per-search cost; spend it on queries that change the
  decision.

Decision principles:

* DO NOT adjust an employee that hasn't traded much (n < 20 over 7d).
* If hit-rate is high (>55%) but P&L is negative, fix sizing/payoff.
* If hit-rate is low (<48%), tighten min_confidence_threshold OR drop
  a losing strategy from their list / asset from their allowed list.
* If an employee is bleeding (P&L < -10% of allocation) and the cause
  isn't obvious, PAUSE them. The CEO will investigate.
* Prefer small reversible changes over big ones. Examples of "small":
  ±0.05 on a threshold, ±0.1 on Kelly, removing one strategy, removing
  one asset.
* Always include a 1-sentence `reason` for every action.

Workflow:

1. Call `get_team_status` first.
2. (Optional) Call `web_search` if you want fresh context for a thesis
   — e.g. "ECB rate decision impact on EURUSD this week".
3. Decide which employees (if any) need action — 0 to 3 total.
4. Take the actions.
5. End with a short text summary of what you changed and why."""

REVIEW_USER_PROMPT_BASE = (
    "Please run your scheduled team review now. Read the team status, "
    "decide if anything needs adjusting, take 0-3 actions, then summarize."
)


async def _pending_requests_for_company(company_id: UUID) -> list[dict]:
    """Returns pending employee_meeting_requests for the company,
    oldest first. Used to surface the queue in the review prompt."""
    async with acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT r.id, r.reason, r.created_at, a.id AS employee_id, a.name AS employee_name
            FROM employee_meeting_requests r
            JOIN agents a ON a.id = r.employee_agent_id
            WHERE r.company_id = $1 AND r.status = 'pending'
            ORDER BY r.created_at ASC
            """,
            company_id,
        )
    return [
        {
            "request_id": str(r["id"]),
            "employee_id": str(r["employee_id"]),
            "employee_name": r["employee_name"],
            "reason": r["reason"],
            "asked_at": r["created_at"].isoformat(),
        }
        for r in rows
    ]


async def _mark_pending_addressed(
    company_id: UUID, action_id: UUID | None = None,
) -> int:
    """Mark all currently-pending requests as addressed after a review
    completes. We're not tracking which specific actions resolved which
    requests — the conversation transcript is the audit. Returns the
    count marked."""
    async with acquire() as conn:
        res = await conn.execute(
            """
            UPDATE employee_meeting_requests
            SET status = 'addressed',
                addressed_at = now(),
                addressed_action_id = $2
            WHERE company_id = $1 AND status = 'pending'
            """,
            company_id, action_id,
        )
    try:
        return int(res.split()[-1])
    except Exception:
        return 0

# 1:1 meeting prompts — narrower scope, deeper context. The manager
# pulls the specific employee's recent trades + calibration before
# deciding on an adjustment. Tool budget is smaller because the scope
# is fixed.
ONE_ON_ONE_SYSTEM_PROMPT = """You are the Manager of an AI trading firm,
holding a focused 1:1 meeting with one specific employee.

Unlike a broad team review, this is a deeper conversation about ONE
employee. Read their full picture (config, recent trades, calibration
quality, win/loss streaks) and decide whether anything needs to change.

Tools available (use whichever fit this employee's situation):
* Read: `get_team_status`, `get_company_goals`, `get_upcoming_economic_events`,
  `get_available_strategies`, `get_available_forecasting_models`,
  `get_available_assets`, `web_search` (live internet — use it when
  you need news / context for a decision; the CEO pays per search).
* Write: `adjust_employee` (numeric knobs incl. allocation + daily
  target), `set_employee_strategies`, `set_employee_trade_mode`,
  `set_employee_allowed_assets`, `set_employee_forecasting_model`,
  `add_strategy_combination`, `clear_strategy_combinations`,
  `pause_employee`, `resume_employee`.

Style of this meeting:

* Treat the employee like a colleague. Acknowledge what they're doing
  well before pointing out problems.
* Take at most ONE write action total — small reversible step.
  Bigger problems get a `pause_employee` and a note for the CEO.
* If there's no real issue, say so and end the meeting briefly.
* Stay on this one employee — don't review the rest of the team.

Workflow:

1. Call `get_team_status` (the digest includes this employee).
2. If the conversation needs current information you don't have —
   news, calendar, regime — call `web_search` (1-2 queries max).
3. Decide. Take 0 or 1 write actions.
4. End with 1-3 sentences of meeting notes — what you discussed,
   what you decided, what you'd want to see by next meeting."""

MAX_TOOL_ROUNDS_PER_MEETING = 3


async def _review_once() -> int:
    """One pass over every Pro/Enterprise company that has a manager
    agent. Free/Starter tiers don't include the manager loop — the
    SQL filter is the cheapest way to skip them at scale."""
    from app.tiers import manager_loop_allowed
    async with acquire() as conn:
        managers = await conn.fetch(
            """
            SELECT a.id AS manager_id, a.company_id, a.name AS manager_name,
                   a.llm_provider, a.llm_model, a.system_prompt_addendum,
                   c.created_by AS owner_account_id, c.tier_name
            FROM agents a
            JOIN companies c ON c.id = a.company_id
            WHERE a.role = 'manager' AND a.is_active = TRUE AND a.is_paused = FALSE
            """,
        )
    if not managers:
        return 0

    eligible = [m for m in managers if manager_loop_allowed(m["tier_name"])]
    skipped = len(managers) - len(eligible)
    if skipped:
        log.info("manager review: skipped %d companies on a tier without the loop", skipped)

    for m in eligible:
        try:
            await _review_one_company(m)
        except Exception:
            log.exception("manager review failed for company=%s", m["company_id"])
    return len(eligible)


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
        adapter = await get_adapter_for_company(provider, company_id)
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

    # Pull pending employee requests and inline them into the prompt
    # so the manager addresses them in the same pass.
    pending = await _pending_requests_for_company(company_id)
    pending_block = ""
    if pending:
        lines = [
            f"- {p['employee_name']} (id {p['employee_id']}): {p['reason']}"
            for p in pending
        ]
        pending_block = (
            "\n\nThe following employees have pending requests for you. "
            "Address each one — call `get_team_status` to see the data, "
            "then make a small adjustment, hold a 1:1, or note no action "
            "needed (mention them by name in your summary either way):\n"
            + "\n".join(lines)
        )

    messages: list[LLMMessage] = [
        LLMMessage(role="user", content=REVIEW_USER_PROMPT_BASE + pending_block),
    ]

    # Open a transcript conversation up-front so individual rounds land
    # immediately — useful for the activity feed which polls.
    conversation_id = await _open_review_conversation(
        company_id=company_id, account_id=owner_id, agent_id=manager_id,
    )
    await _append_message(
        conversation_id, company_id, "user",
        REVIEW_USER_PROMPT_BASE + pending_block, None,
    )

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

    action_id = await _log_review(
        company_id=company_id, manager_id=manager_id,
        narrative=final_text, conversation_id=conversation_id,
    )
    # Resolve any pending requests we surfaced — even if the manager
    # decided no action was needed for a specific employee, the
    # request has now been "seen" and addressed.
    if pending:
        n = await _mark_pending_addressed(company_id, action_id)
        log.info("resolved %d pending employee request(s) on review %s", n, action_id)
    await _notify_review_done(
        company_id=company_id, account_id=owner_id,
        manager_name=m["manager_name"], action_id=action_id,
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


async def _log_review(
    *, company_id: UUID, manager_id: UUID, narrative: str,
    conversation_id: UUID | None,
) -> UUID:
    async with acquire() as conn:
        return await conn.fetchval(
            """
            INSERT INTO manager_actions
                (company_id, manager_agent_id, action_kind,
                 llm_narrative, conversation_id)
            VALUES ($1, $2, 'review', $3, $4)
            RETURNING id
            """,
            company_id, manager_id, (narrative or "").strip()[:8000],
            conversation_id,
        )


# ─────────────────── on-demand triggers (CEO / API) ────────────────────


async def trigger_review_for_company(company_id: UUID) -> bool:
    """Synchronously run a team review for the given company's manager.

    Returns False if the company has no active manager. Used by the
    "Run review now" CEO button and by self-tests. Callers that don't
    want to block (e.g. an HTTP handler) should `asyncio.create_task`
    this — we do not spawn the task ourselves so the caller controls
    lifetime."""
    async with acquire() as conn:
        m = await conn.fetchrow(
            """
            SELECT a.id AS manager_id, a.company_id, a.name AS manager_name,
                   a.llm_provider, a.llm_model, a.system_prompt_addendum,
                   c.created_by AS owner_account_id
            FROM agents a
            JOIN companies c ON c.id = a.company_id
            WHERE a.role = 'manager' AND a.is_active = TRUE
              AND a.company_id = $1
            ORDER BY a.created_at DESC
            LIMIT 1
            """,
            company_id,
        )
    if m is None:
        return False
    await _review_one_company(m)
    return True


async def trigger_one_on_one(
    *, company_id: UUID, employee_agent_id: UUID, agenda: str | None = None,
) -> bool:
    """Run a focused 1:1 meeting between the company's manager and the
    named employee. Same return semantics as `trigger_review_for_company`."""
    async with acquire() as conn:
        manager = await conn.fetchrow(
            """
            SELECT a.id AS manager_id, a.company_id, a.name AS manager_name,
                   a.llm_provider, a.llm_model, a.system_prompt_addendum,
                   c.created_by AS owner_account_id
            FROM agents a
            JOIN companies c ON c.id = a.company_id
            WHERE a.role = 'manager' AND a.is_active = TRUE
              AND a.company_id = $1
            ORDER BY a.created_at DESC
            LIMIT 1
            """,
            company_id,
        )
        if manager is None:
            return False
        emp = await conn.fetchrow(
            """
            SELECT id, name, role
            FROM agents
            WHERE id = $1 AND company_id = $2
            """,
            employee_agent_id, company_id,
        )
    if emp is None or emp["role"] == "manager":
        return False
    await _run_one_on_one(manager, emp, agenda)
    return True


async def _run_one_on_one(m, employee, agenda: str | None) -> None:
    """Hold a focused 1:1 with `employee`. Persists every turn as a
    conversation_messages thread titled with the employee's name, and
    logs a 'meeting' row in manager_actions for the audit feed."""
    company_id: UUID = m["company_id"]
    manager_id: UUID = m["manager_id"]
    owner_id: UUID = m["owner_account_id"]
    provider = m["llm_provider"]
    model = m["llm_model"]

    try:
        adapter = await get_adapter_for_company(provider, company_id)
    except Exception as e:
        log.warning("manager %s on %s/%s — adapter unavailable: %s",
                    manager_id, provider, model, e)
        return

    ctx = ToolContext(
        company_id=company_id, account_id=owner_id, agent_id=manager_id,
    )

    all_tools = available_tools()
    manager_addendum = (m.get("system_prompt_addendum") or "").strip()
    system = ONE_ON_ONE_SYSTEM_PROMPT + (
        f"\n\n--- agent addendum ---\n{manager_addendum}" if manager_addendum else ""
    )

    emp_name = employee["name"]
    emp_id = employee["id"]
    user_prompt = (
        f"You are holding a 1:1 meeting with {emp_name} (agent id "
        f"{emp_id}). " +
        (f"The CEO's agenda for this meeting: {agenda.strip()}. " if agenda else
         "No specific agenda from the CEO — focus on whatever stands out. ") +
        f"Stay on {emp_name} only. Take at most one action. Finish with "
        "your meeting notes."
    )

    messages: list[LLMMessage] = [LLMMessage(role="user", content=user_prompt)]

    # Each meeting gets its own conversation row so the activity feed
    # treats it as a separate thread from scheduled reviews.
    conversation_id = await _open_meeting_conversation(
        company_id=company_id, account_id=owner_id,
        agent_id=manager_id, employee_name=emp_name,
    )
    await _append_message(conversation_id, company_id, "user", user_prompt, None)

    # Flag the current async context so `hold_meeting_with_employee`
    # called from within this meeting refuses (otherwise the manager
    # can recurse and spawn meetings indefinitely). Reset on exit.
    token = in_meeting_with.set(emp_id)
    try:
        final_text = ""
        round_no = 0
        for round_no in range(MAX_TOOL_ROUNDS_PER_MEETING):
            resp = await adapter.chat(
                model=model, system=system, messages=messages,
                tools=all_tools, max_tokens=1500, temperature=0.3,
            )
            await _append_message(
                conversation_id, company_id, "assistant",
                resp.text or "",
                [tc.model_dump() for tc in resp.tool_calls] if resp.tool_calls else None,
            )
            # Capture the latest non-empty assistant text — the model
            # may say its "meeting notes" alongside the final tool call
            # rather than in a tool-free closing turn, so `final_text`
            # tracks the last thing it actually said.
            if resp.text:
                final_text = resp.text
            if resp.tool_calls:
                messages.append(LLMMessage(
                    role="assistant", content=resp.text or None,
                    tool_calls=resp.tool_calls,
                ))
                for tc in resp.tool_calls:
                    result_json = await execute_tool(tc.name, tc.arguments, ctx)
                    await _append_message(
                        conversation_id, company_id, "tool", result_json,
                        [{"id": tc.id, "name": tc.name}],
                    )
                    messages.append(LLMMessage(
                        role="tool", tool_call_id=tc.id, tool_result=result_json,
                    ))
                continue
            break
    finally:
        in_meeting_with.reset(token)

    action_id = await _log_meeting(
        company_id=company_id, manager_id=manager_id,
        employee_id=emp_id, narrative=final_text, agenda=agenda,
        conversation_id=conversation_id,
    )
    await _notify_meeting_done(
        company_id=company_id, account_id=owner_id,
        manager_name=m["manager_name"], employee_name=emp_name,
        action_id=action_id,
    )
    log.info("manager %s held 1:1 with %s — %d round(s)",
             m["manager_name"], emp_name, round_no + 1)


async def _open_meeting_conversation(
    *, company_id: UUID, account_id: UUID, agent_id: UUID, employee_name: str,
) -> UUID:
    async with acquire() as conn:
        cid = await conn.fetchval(
            """
            INSERT INTO conversations (company_id, account_id, agent_id, title, last_message_at)
            VALUES ($1, $2, $3, $4, now())
            RETURNING id
            """,
            company_id, account_id, agent_id,
            f"1:1 with {employee_name}",
        )
    return cid


async def _log_meeting(
    *, company_id: UUID, manager_id: UUID, employee_id: UUID,
    narrative: str, agenda: str | None,
    conversation_id: UUID | None,
) -> UUID:
    reason = f"1:1 agenda: {agenda}" if agenda else None
    async with acquire() as conn:
        return await conn.fetchval(
            """
            INSERT INTO manager_actions
                (company_id, manager_agent_id, employee_agent_id,
                 action_kind, reason, llm_narrative, conversation_id)
            VALUES ($1, $2, $3, 'meeting', $4, $5, $6)
            RETURNING id
            """,
            company_id, manager_id, employee_id,
            (reason or "")[:8000] or None,
            (narrative or "").strip()[:8000],
            conversation_id,
        )


# ───────────────────── notifications ─────────────────────


async def _notify_review_done(
    *, company_id: UUID, account_id: UUID,
    manager_name: str, action_id: UUID,
) -> None:
    """Drop an inbox note when a scheduled / CEO-triggered review lands."""
    async with acquire() as conn:
        await conn.execute(
            """
            INSERT INTO notifications
                (account_id, company_id, kind, title, body, link)
            VALUES ($1, $2, 'manager_review', $3, NULL, $4)
            """,
            account_id, company_id,
            f"{manager_name} finished a team review",
            f"/meetings/{action_id}",
        )


async def _notify_meeting_done(
    *, company_id: UUID, account_id: UUID,
    manager_name: str, employee_name: str, action_id: UUID,
) -> None:
    async with acquire() as conn:
        await conn.execute(
            """
            INSERT INTO notifications
                (account_id, company_id, kind, title, body, link)
            VALUES ($1, $2, 'manager_meeting', $3, NULL, $4)
            """,
            account_id, company_id,
            f"{manager_name} held a 1:1 with {employee_name}",
            f"/meetings/{action_id}",
        )


# ───────────────────── follow-up on existing meeting ─────────────────────


MAX_TOOL_ROUNDS_PER_FOLLOWUP = 3


async def trigger_meeting_followup(
    *, company_id: UUID, meeting_id: UUID, ceo_message: str,
) -> bool:
    """CEO is replying to a meeting from the detail page.

    Appends the CEO's message to the existing conversation, runs the
    manager again with the full transcript as context, persists new
    turns, and drops a notification. Any actions the manager takes
    land via the existing tool dispatch (`_log_action` etc.)."""
    ceo_message = (ceo_message or "").strip()
    if not ceo_message:
        return False
    async with acquire() as conn:
        meeting = await conn.fetchrow(
            """
            SELECT ma.id, ma.action_kind, ma.conversation_id,
                   ma.manager_agent_id, ma.employee_agent_id, ma.company_id,
                   mgr.name AS manager_name, mgr.llm_provider, mgr.llm_model,
                   mgr.system_prompt_addendum,
                   emp.name AS employee_name,
                   c.created_by AS owner_account_id
            FROM manager_actions ma
            JOIN agents mgr ON mgr.id = ma.manager_agent_id
            LEFT JOIN agents emp ON emp.id = ma.employee_agent_id
            JOIN companies c ON c.id = ma.company_id
            WHERE ma.id = $1 AND ma.company_id = $2
              AND ma.action_kind IN ('review', 'meeting')
              AND ma.conversation_id IS NOT NULL
            """,
            meeting_id, company_id,
        )
    if meeting is None:
        return False
    await _run_meeting_followup(meeting, ceo_message)
    return True


async def _run_meeting_followup(meeting, ceo_message: str) -> None:
    company_id: UUID = meeting["company_id"]
    manager_id: UUID = meeting["manager_agent_id"]
    owner_id: UUID = meeting["owner_account_id"]
    conversation_id: UUID = meeting["conversation_id"]
    is_one_on_one = meeting["action_kind"] == "meeting"
    employee_name = meeting["employee_name"]
    employee_id = meeting["employee_agent_id"]
    provider = meeting["llm_provider"]
    model = meeting["llm_model"]

    try:
        adapter = await get_adapter_for_company(provider, company_id)
    except Exception as e:
        log.warning("followup adapter unavailable: %s", e)
        return

    ctx = ToolContext(
        company_id=company_id, account_id=owner_id, agent_id=manager_id,
    )

    # Reuse the original system prompt — the rules haven't changed.
    base_system = ONE_ON_ONE_SYSTEM_PROMPT if is_one_on_one else SYSTEM_PROMPT
    addendum = (meeting["system_prompt_addendum"] or "").strip()
    system = base_system + (f"\n\n--- agent addendum ---\n{addendum}" if addendum else "")
    system += (
        "\n\n--- this is a follow-up turn ---\n"
        "The CEO is replying to your earlier message. Read the full "
        "transcript above and respond directly to what they said. "
        "Take at most one action; finish with a short response."
    )

    # Replay the existing transcript into the LLMMessage shape so the
    # model has full context (assistant turns with tool calls + tool
    # results both rendered correctly).
    messages: list[LLMMessage] = await _rebuild_messages(conversation_id)
    messages.append(LLMMessage(role="user", content=ceo_message))
    await _append_message(conversation_id, company_id, "user", ceo_message, None)

    # Set the in_meeting flag if the original was a 1:1 so the
    # follow-up can't spawn a new nested 1:1.
    token = in_meeting_with.set(employee_id) if is_one_on_one else None
    try:
        for round_no in range(MAX_TOOL_ROUNDS_PER_FOLLOWUP):
            resp = await adapter.chat(
                model=model, system=system, messages=messages,
                tools=available_tools(), max_tokens=1500, temperature=0.3,
            )
            await _append_message(
                conversation_id, company_id, "assistant",
                resp.text or "",
                [tc.model_dump() for tc in resp.tool_calls] if resp.tool_calls else None,
            )
            if resp.tool_calls:
                messages.append(LLMMessage(
                    role="assistant", content=resp.text or None,
                    tool_calls=resp.tool_calls,
                ))
                for tc in resp.tool_calls:
                    result_json = await execute_tool(tc.name, tc.arguments, ctx)
                    await _append_message(
                        conversation_id, company_id, "tool", result_json,
                        [{"id": tc.id, "name": tc.name}],
                    )
                    messages.append(LLMMessage(
                        role="tool", tool_call_id=tc.id, tool_result=result_json,
                    ))
                continue
            break
    finally:
        if token is not None:
            in_meeting_with.reset(token)

    # Notify the CEO so they see the manager's reply.
    await _notify_followup_done(
        company_id=company_id, account_id=owner_id,
        manager_name=meeting["manager_name"],
        employee_name=employee_name,
        meeting_id=meeting["id"],
    )
    log.info("manager %s sent follow-up on meeting %s",
             meeting["manager_name"], meeting["id"])


async def _rebuild_messages(conversation_id: UUID) -> list[LLMMessage]:
    """Read the existing conversation back into a list of LLMMessage so
    the LLM sees the full thread before responding to the new CEO turn.

    We faithfully reconstruct tool calls / tool results — the assistant's
    earlier reasoning isn't useful without them."""
    async with acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT role, content, tool_calls, created_at
            FROM conversation_messages
            WHERE conversation_id = $1
            ORDER BY created_at ASC
            """,
            conversation_id,
        )
    out: list[LLMMessage] = []
    pending_tool_id: str | None = None
    for r in rows:
        role = r["role"]
        content = r["content"] or ""
        tc_raw = r["tool_calls"]
        if isinstance(tc_raw, str):
            try:
                tc_raw = json.loads(tc_raw)
            except Exception:
                tc_raw = None
        if role == "user":
            out.append(LLMMessage(role="user", content=content))
        elif role == "assistant":
            tool_calls = None
            if tc_raw and isinstance(tc_raw, list):
                tool_calls = []
                for tc in tc_raw:
                    if not isinstance(tc, dict):
                        continue
                    tid = tc.get("id") or ""
                    name = tc.get("name") or "?"
                    args = tc.get("arguments") or {}
                    tool_calls.append({"id": tid, "name": name, "arguments": args})
                    pending_tool_id = tid
            from app.llm import ToolCall as _ToolCall
            out.append(LLMMessage(
                role="assistant",
                content=content or None,
                tool_calls=[_ToolCall(**tc) for tc in tool_calls] if tool_calls else None,
            ))
        elif role == "tool":
            # The minimal metadata we stored was {id, name}. We use the
            # id to attach to the right previous tool call.
            tid = ""
            if tc_raw and isinstance(tc_raw, list) and tc_raw:
                tid = (tc_raw[0] or {}).get("id") or pending_tool_id or ""
            out.append(LLMMessage(
                role="tool", tool_call_id=tid or "tool_call",
                tool_result=content,
            ))
    return out


async def _notify_followup_done(
    *, company_id: UUID, account_id: UUID,
    manager_name: str, employee_name: str | None, meeting_id: UUID,
) -> None:
    who = f" with {employee_name}" if employee_name else ""
    async with acquire() as conn:
        await conn.execute(
            """
            INSERT INTO notifications
                (account_id, company_id, kind, title, body, link)
            VALUES ($1, $2, 'meeting_followup', $3, NULL, $4)
            """,
            account_id, company_id,
            f"{manager_name} replied on the meeting{who}",
            f"/meetings/{meeting_id}",
        )
