"""Deriv account state — keeps the most recent balance update in memory.

The gateway publishes every `balance` push from Deriv to NATS subject
`deriv.balance`. We subscribe here, cache the latest, and expose it via the
api so the dashboard can render it. No DB write — the value changes too
fast and is a transient view, not history.

Phase 1 has a SINGLE shared Deriv token (DERIV_API_TOKEN) so this is
global state, not per-company. When per-company tokens land in Phase 7,
this becomes a dict keyed by company.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from app import bus

log = logging.getLogger("trademaster.deriv")

_state: dict[str, Any] = {}
_sub = None


async def _on_balance(msg) -> None:
    try:
        b = json.loads(msg.data)
    except Exception:
        return
    # Server sometimes pushes both the snapshot and the subscription marker;
    # we only care about rows that carry a numeric balance.
    if "balance" not in b:
        return
    new_balance = float(b["balance"])
    # Heartbeat republishes the same value every 5s — only log when it
    # actually moves so the log stays signal-only.
    prev = _state.get("balance")
    _state.update({
        "loginid": b.get("loginid"),
        "currency": b.get("currency") or "USD",
        "balance": new_balance,
        "is_virtual": int(b.get("is_virtual") or 0) == 1,
    })
    if prev is None or abs(new_balance - float(prev)) > 0.005:
        log.info(
            "balance updated: %s %.2f (was %s)",
            _state.get("currency"), new_balance,
            f"{prev:.2f}" if prev is not None else "n/a",
        )


async def start() -> None:
    global _sub
    nc = bus.nc()
    if nc is None:
        log.warning("deriv cache: no nats connection")
        return
    _sub = await nc.subscribe("deriv.balance", cb=_on_balance)
    log.info("deriv balance cache subscribed to deriv.balance")


async def stop() -> None:
    global _sub
    if _sub is not None:
        try:
            await _sub.unsubscribe()
        except Exception:
            pass
        _sub = None


def latest() -> dict[str, Any] | None:
    if not _state:
        return None
    return dict(_state)
