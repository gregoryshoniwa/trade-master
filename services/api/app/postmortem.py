"""Trade postmortems (PLAN §13.11/§13.12).

Generated when a trade settles. Builds a structured entry trace (from the
intent's entry_context snapshot + risk verdict), an exit trace, a
per-employee rating, and a plain-language narrative via a cheap LLM.

Phase 1 simplification vs the full plan: one employee decides each trade
(no manager synthesis, no multi-employee ensemble yet), so the rating
covers Direction + Calibration but not Information Value (which needs a
counterfactual across multiple voting employees). The shape is forward-
compatible — IV slots in when the ensemble lands.
"""

from __future__ import annotations

import json
import logging
from uuid import UUID

from app.db import acquire
from app.llm import LLMMessage, get_adapter
from app.usage import record as record_usage

log = logging.getLogger("trademaster.postmortem")

NARRATIVE_PROVIDER = "google"
NARRATIVE_MODEL = "gemini-2.5-flash"


def _rating(confidence: float, pnl: float) -> dict:
    """Per-employee rating for a single-decider trade.

    direction_score: did the agent's call match the outcome? It always
      proposed a directional MULTUP/MULTDOWN, so win → +1, loss → -1.
    calibration_score: Brier-style honesty of the stated confidence.
      outcome_indicator = 1 (win) or 0 (loss); 1 - (conf - ind)^2.
    composite: 0.6·direction + 0.4·calibration, scaled to [-1, 1].
    """
    win = pnl > 0
    outcome_ind = 1.0 if win else 0.0
    direction_score = 1.0 if win else -1.0
    calibration_score = 1.0 - (confidence - outcome_ind) ** 2  # [0,1]
    # Map calibration to [-1,1] so it can pull the composite both ways.
    calib_signed = calibration_score * 2 - 1
    composite = 0.6 * direction_score + 0.4 * calib_signed
    return {
        "direction_score": round(direction_score, 4),
        "calibration_score": round(calibration_score, 4),
        "information_value_score": None,  # needs multi-employee ensemble
        "composite_rating": round(composite, 4),
    }


async def _narrative(intent: dict, entry_trace: dict, exit_trace: dict, rating: dict) -> tuple[str, int, int]:
    """Generate a 2–3 paragraph plain-language summary. Returns
    (text, in_tokens, out_tokens). Falls back to a templated summary if the
    LLM call fails."""
    agent = entry_trace.get("agent", {})
    fc = entry_trace.get("forecast", {})
    sys = (
        "You are writing a concise trade postmortem for the CEO of an AI "
        "trading firm. 2-3 short paragraphs, plain language, trader tone. "
        "State what was decided and why, what happened, and one honest line "
        "on whether the agent's confidence was justified. No preamble."
    )
    facts = {
        "agent": agent.get("name"),
        "personality": agent.get("personality"),
        "strategies": agent.get("strategies"),
        "asset": intent["asset"],
        "contract_type": intent["contract_type"],
        "direction": intent["direction"],
        "stake_usd": float(intent["stake_usd"]),
        "model": fc.get("model"),
        "confidence": fc.get("confidence"),
        "entry_price": float(intent["entry_price"]),
        "exit": exit_trace,
        "realized_pnl_usd": float(intent["realized_pnl_usd"]) if intent["realized_pnl_usd"] is not None else None,
        "rating": rating,
    }
    user = "Write the postmortem from these facts:\n" + json.dumps(facts, default=str, indent=2)
    try:
        adapter = get_adapter(NARRATIVE_PROVIDER)
        resp = await adapter.chat(
            model=NARRATIVE_MODEL,
            system=sys,
            messages=[LLMMessage(role="user", content=user)],
            max_tokens=500,
            temperature=0.5,
        )
        return resp.text or _fallback_narrative(facts), resp.input_tokens, resp.output_tokens
    except Exception:
        log.exception("postmortem narrative LLM failed; using fallback")
        return _fallback_narrative(facts), 0, 0


def _fallback_narrative(f: dict) -> str:
    pnl = f.get("realized_pnl_usd")
    verb = "won" if (pnl or 0) > 0 else "lost"
    return (
        f"{f['agent']} opened a {f['direction']} {f['contract_type']} on "
        f"{f['asset']} staking ${f['stake_usd']:.2f}, driven by {f['model']} "
        f"at {float(f['confidence'] or 0)*100:.0f}% confidence. The trade "
        f"{verb} ${abs(pnl or 0):.2f} ({f['exit'].get('exit_reason','closed')})."
    )


async def generate(intent_id: UUID) -> None:
    """Build + persist the postmortem for a settled intent. Idempotent —
    skips if one already exists. Best-effort; never raises."""
    try:
        async with acquire() as conn:
            row = await conn.fetchrow(
                """
                SELECT i.*, a.name AS agent_name
                FROM trade_intents i
                LEFT JOIN agents a ON a.id = i.agent_id
                WHERE i.id = $1
                """,
                intent_id,
            )
            if row is None or row["closed_at"] is None:
                return
            exists = await conn.fetchval(
                "SELECT 1 FROM trade_postmortems WHERE intent_id = $1", intent_id
            )
            if exists:
                return

        intent = dict(row)
        ec = intent.get("entry_context")
        if isinstance(ec, str):
            ec = json.loads(ec)
        entry_context = ec or {}
        rv = intent.get("risk_verdict")
        if isinstance(rv, str):
            rv = json.loads(rv)

        pnl = float(intent["realized_pnl_usd"]) if intent["realized_pnl_usd"] is not None else 0.0
        confidence = float(intent["confidence"])
        outcome = "win" if pnl > 0 else "loss" if pnl < 0 else "break_even"

        # Holding time
        holding_secs = None
        if intent["executed_at"] and intent["closed_at"]:
            holding_secs = int((intent["closed_at"] - intent["executed_at"]).total_seconds())

        entry_trace = {
            **entry_context,
            "risk_verdict": rv,
            "rationale": intent["rationale"],
            "expected_payoff_ratio": float(intent["expected_payoff_ratio"]) if intent["expected_payoff_ratio"] else None,
            "expected_value_usd": float(intent["expected_value_usd"]) if intent["expected_value_usd"] else None,
        }
        exit_trace = {
            "exit_reason": intent["exit_reason"],
            "entry_price": float(intent["entry_price"]),
            "stop_loss": float(intent["stop_loss"]) if intent["stop_loss"] else None,
            "take_profit": float(intent["take_profit"]) if intent["take_profit"] else None,
            "buy_price_usd": float(intent["buy_price_usd"]) if intent["buy_price_usd"] else None,
            "realized_pnl_usd": pnl,
            "holding_secs": holding_secs,
            "broker_contract_id": intent["broker_contract_id"],
        }
        rating = _rating(confidence, pnl)

        narrative, in_tok, out_tok = await _narrative(intent, entry_trace, exit_trace, rating)

        async with acquire() as conn:
            await conn.execute(
                """
                INSERT INTO trade_postmortems
                    (intent_id, company_id, agent_id, outcome, pnl_usd,
                     entry_trace, exit_trace, employee_rating, narrative)
                VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9)
                ON CONFLICT (intent_id) DO NOTHING
                """,
                intent_id, intent["company_id"], intent["agent_id"],
                outcome, pnl,
                json.dumps(entry_trace, default=str),
                json.dumps(exit_trace, default=str),
                json.dumps(rating),
                narrative,
            )

        # Account the narrative's LLM cost (attributed to the agent).
        if in_tok or out_tok:
            await record_usage(
                company_id=intent["company_id"],
                account_id=None,
                agent_id=intent["agent_id"],
                provider=NARRATIVE_PROVIDER,
                model=NARRATIVE_MODEL,
                input_tokens=in_tok,
                output_tokens=out_tok,
                kind="postmortem",
            )
        log.info("postmortem generated intent=%s outcome=%s pnl=%.2f", intent_id, outcome, pnl)
    except Exception:
        log.exception("postmortem generate failed intent=%s", intent_id)
