"""Billing routes — checkout, customer portal, Stripe webhook.

Per-company actions are owner/admin only. The webhook is at the root
prefix because Stripe doesn't know about company_id; the event payload
carries it."""

from __future__ import annotations

import logging
from typing import Literal
from uuid import UUID

import asyncpg
from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel

from app import billing
from app.auth import CurrentAccount
from app.db import acquire

log = logging.getLogger("trademaster.billing.routes")

router = APIRouter(prefix="/companies/{company_id}/billing", tags=["billing"])
webhook_router = APIRouter(prefix="/webhooks", tags=["billing"])


class CheckoutRequest(BaseModel):
    tier: Literal["starter", "pro"]


class CheckoutResponse(BaseModel):
    url: str


class BillingStatusResponse(BaseModel):
    enabled: bool          # billing globally configured on this api instance
    has_customer: bool     # this company has been associated with a Stripe customer
    subscription_status: str | None
    current_period_end: str | None
    portal_available: bool


async def _ensure_owner_or_admin(
    conn: asyncpg.Connection, company_id: UUID, account_id: UUID,
) -> tuple[str, str, str]:
    """Returns (role, company_name, account_email) — needed downstream
    for the Stripe customer create. One query, no extra roundtrips."""
    row = await conn.fetchrow(
        """
        SELECT m.role, c.name AS company_name, a.email
        FROM company_members m
        JOIN companies c ON c.id = m.company_id
        JOIN accounts a ON a.id = m.account_id
        WHERE m.company_id = $1 AND m.account_id = $2
        """,
        company_id, account_id,
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "company not found")
    if row["role"] not in ("owner", "admin"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "owner/admin only")
    return row["role"], row["company_name"], row["email"]


@router.get("", response_model=BillingStatusResponse)
async def get_billing_status(company_id: UUID, account_id: CurrentAccount):
    async with acquire() as conn:
        # Membership check (any role can see whether billing is on the
        # company — they just can't actually mutate it).
        row = await conn.fetchrow(
            """
            SELECT m.role, c.stripe_customer_id, c.subscription_status, c.current_period_end
            FROM company_members m JOIN companies c ON c.id = m.company_id
            WHERE m.company_id = $1 AND m.account_id = $2
            """,
            company_id, account_id,
        )
        if row is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "company not found")
    return BillingStatusResponse(
        enabled=billing.billing_enabled(),
        has_customer=row["stripe_customer_id"] is not None,
        subscription_status=row["subscription_status"],
        current_period_end=(
            row["current_period_end"].isoformat() if row["current_period_end"] else None
        ),
        portal_available=billing.billing_enabled() and row["stripe_customer_id"] is not None,
    )


@router.post("/checkout", response_model=CheckoutResponse)
async def start_checkout(
    company_id: UUID, body: CheckoutRequest, account_id: CurrentAccount,
):
    async with acquire() as conn:
        _, company_name, email = await _ensure_owner_or_admin(conn, company_id, account_id)
    customer_id = await billing._ensure_stripe_customer(company_id, company_name, email)
    url = billing.create_checkout_session(
        customer_id=customer_id, company_id=company_id, tier=body.tier,
    )
    return CheckoutResponse(url=url)


@router.post("/portal", response_model=CheckoutResponse)
async def open_portal(company_id: UUID, account_id: CurrentAccount):
    """Returns a Stripe customer portal URL — single-use, scoped to
    this customer. The browser redirects there for cancellation,
    invoice history, and payment-method updates."""
    async with acquire() as conn:
        await _ensure_owner_or_admin(conn, company_id, account_id)
        customer_id = await conn.fetchval(
            "SELECT stripe_customer_id FROM companies WHERE id = $1", company_id,
        )
    if not customer_id:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "no Stripe customer yet — start a checkout first to create one",
        )
    return CheckoutResponse(url=billing.create_portal_session(customer_id=customer_id))


@webhook_router.post("/stripe")
async def stripe_webhook(request: Request):
    """Stripe POSTs subscription-lifecycle events here. Signature
    verification is mandatory; any failure returns 400 without
    touching state. Successful events flip `companies.tier_name` to
    match the active price (or back to 'free' on cancellation)."""
    sig = request.headers.get("stripe-signature", "")
    raw = await request.body()
    event = billing.verify_webhook(raw, sig)
    try:
        await billing.handle_event(event)
    except Exception:
        log.exception("stripe webhook handler failed event=%s", event["type"])
        # Returning 500 makes Stripe retry — that's what we want for
        # transient DB issues.
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            "handler failed; Stripe will retry",
        )
    return {"received": True}
