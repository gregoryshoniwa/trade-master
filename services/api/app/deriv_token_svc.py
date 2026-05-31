"""NATS request/reply: hand the gateway a company's Deriv API token.

The Go gateway needs to authorize one WebSocket per paying customer.
It can't read company_credentials directly — the Fernet encryption key
lives only in the api process. So when the gateway sees an approved
trade (or a statement / sell / balance poll) for a company it doesn't
yet have a client for, it RPCs us:

    request("deriv.token.req", {"company_id": "<uuid>"}, timeout=5)
    →     {"token": "abc...", "environment": "demo"}
    or    {"token": null,     "environment": "demo"}   ← no token configured

We never expose this subject outside the internal NATS bus. There is no
HTTP wrapper. Gateway-only consumer.
"""

from __future__ import annotations

import json
import logging
from uuid import UUID

from app import bus
from app.credentials import get_deriv_token

log = logging.getLogger("trademaster.deriv_token_svc")

_sub = None


async def _on_request(msg) -> None:
    try:
        body = json.loads(msg.data) if msg.data else {}
        cid_raw = body.get("company_id")
        if not cid_raw:
            await msg.respond(json.dumps({"error": "company_id required"}).encode())
            return
        try:
            cid = UUID(str(cid_raw))
        except ValueError:
            await msg.respond(json.dumps({"error": "company_id not a uuid"}).encode())
            return
        token, env = await get_deriv_token(cid)
        await msg.respond(
            json.dumps({"token": token, "environment": env}).encode()
        )
    except Exception as e:
        log.exception("deriv.token.req handler failed")
        try:
            await msg.respond(json.dumps({"error": str(e)}).encode())
        except Exception:
            pass


async def start() -> None:
    global _sub
    nc = bus.nc()
    if nc is None:
        log.warning("deriv_token_svc: no nats connection — gateway will get no tokens")
        return
    _sub = await nc.subscribe("deriv.token.req", cb=_on_request)
    log.info("deriv_token_svc subscribed to deriv.token.req")


async def stop() -> None:
    global _sub
    if _sub is not None:
        try:
            await _sub.unsubscribe()
        except Exception:
            pass
        _sub = None
