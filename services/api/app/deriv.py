"""Per-company Deriv account state — keeps the most recent balance update
in memory, keyed by company_id.

The gateway maintains one authorized Deriv connection per company (one
per customer's API token) and publishes balance polls to
`deriv.balance.{company_id}`. We subscribe with a wildcard, cache the
latest per company, and expose it via the api so the dashboard renders
the right number for the logged-in user's company.

No DB write — balance changes too fast and the value is a transient view,
not history. The cache is rebuilt on api restart (gateway re-publishes
every 5s).
"""

from __future__ import annotations

import json
import logging
from typing import Any
from uuid import UUID

from app import bus

log = logging.getLogger("trademaster.deriv")

# Map[company_id_str → balance_snapshot_dict]
_state: dict[str, dict[str, Any]] = {}
_sub = None


def _company_from_subject(subject: str) -> str | None:
    if not subject.startswith("deriv.balance."):
        return None
    tail = subject[len("deriv.balance."):]
    return tail or None


async def _on_balance(msg) -> None:
    cid = _company_from_subject(msg.subject)
    if not cid:
        return
    try:
        b = json.loads(msg.data)
    except Exception:
        return
    if "balance" not in b:
        return
    new_balance = float(b["balance"])
    prev_state = _state.get(cid)
    prev_balance = prev_state.get("balance") if prev_state else None
    _state[cid] = {
        "loginid": b.get("loginid"),
        "currency": b.get("currency") or "USD",
        "balance": new_balance,
        "is_virtual": int(b.get("is_virtual") or 0) == 1,
    }
    if prev_balance is None or abs(new_balance - float(prev_balance)) > 0.005:
        log.info(
            "balance updated company=%s: %s %.2f (was %s)",
            cid, _state[cid].get("currency"), new_balance,
            f"{prev_balance:.2f}" if prev_balance is not None else "n/a",
        )


async def start() -> None:
    global _sub
    nc = bus.nc()
    if nc is None:
        log.warning("deriv cache: no nats connection")
        return
    _sub = await nc.subscribe("deriv.balance.>", cb=_on_balance)
    log.info("deriv balance cache subscribed to deriv.balance.>")


async def stop() -> None:
    global _sub
    if _sub is not None:
        try:
            await _sub.unsubscribe()
        except Exception:
            pass
        _sub = None


def latest(company_id: UUID | str | None) -> dict[str, Any] | None:
    """Latest balance snapshot for the given company, or None if we
    haven't seen one yet (gateway not warmed for this company)."""
    if company_id is None:
        return None
    cid = str(company_id)
    snap = _state.get(cid)
    if not snap:
        return None
    return dict(snap)
