"""LLM usage recording — writes one llm_usage row per provider call.

Always best-effort: a write failure must never break the chat. We log
and continue. Aggregations live in routes/payroll.py.
"""

from __future__ import annotations

import logging
from uuid import UUID

from app.db import acquire
from app.llm import estimate_cost_usd

log = logging.getLogger("trademaster.usage")


async def record(
    *,
    company_id: UUID,
    account_id: UUID | None,
    agent_id: UUID | None,
    provider: str,
    model: str,
    input_tokens: int,
    output_tokens: int,
    latency_ms: int | None = None,
    kind: str = "chat",
) -> None:
    cost = estimate_cost_usd(provider, model, input_tokens, output_tokens)
    try:
        async with acquire() as conn:
            await conn.execute(
                """
                INSERT INTO llm_usage
                    (company_id, account_id, agent_id, provider, model,
                     input_tokens, output_tokens, estimated_cost_usd,
                     latency_ms, kind)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                """,
                company_id, account_id, agent_id, provider, model,
                input_tokens, output_tokens, cost,
                latency_ms, kind,
            )
    except Exception:
        log.exception("llm_usage write failed (will keep chat working anyway)")
