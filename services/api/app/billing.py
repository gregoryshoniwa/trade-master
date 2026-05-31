"""Stripe billing — checkout, customer portal, webhook ⇄ tier sync.

The api never instantiates Stripe-related state at module load (Stripe
ships a lazy client). Operators who don't fill in `STRIPE_SECRET_KEY`
can still run the rest of the platform; the billing routes just return
503 explaining what's missing.

How the loop closes:
  1. Logged-in customer clicks a pricing CTA → `POST /billing/checkout`
  2. We mint a Stripe Checkout Session bound to their company_id, redirect
  3. After payment, Stripe fires `customer.subscription.created` →
     webhook flips `companies.tier_name` based on the price's lookup_key
  4. UI re-reads `/companies/{id}/tier` and the new features unlock
  5. Cancellations flow the same way via `customer.subscription.deleted`

We use `client_reference_id` on the checkout session to carry the
company_id across the round-trip — Stripe surfaces it back on every
webhook for that subscription.
"""

from __future__ import annotations

import logging
from typing import Literal
from uuid import UUID

import stripe
from fastapi import HTTPException, status

from app.config import settings
from app.db import acquire

log = logging.getLogger("trademaster.billing")

# Map a Stripe price ID to the tier_name we should flip the company to.
# Built lazily from `settings` so an operator can omit a tier (e.g.
# only sells Pro) without us crashing on startup.
def _price_to_tier_map() -> dict[str, str]:
    out: dict[str, str] = {}
    if settings.stripe_price_starter:
        out[settings.stripe_price_starter] = "starter"
    if settings.stripe_price_pro:
        out[settings.stripe_price_pro] = "pro"
    return out


def _tier_to_price_map() -> dict[str, str]:
    return {v: k for k, v in _price_to_tier_map().items()}


def billing_enabled() -> bool:
    return bool(settings.stripe_secret_key)


def _client() -> stripe.StripeClient:
    """Lazy Stripe client bound to the current key. Building per-call
    is cheap (just constructs a thin Python object) and avoids a
    module-load order dependency on environment variables."""
    if not settings.stripe_secret_key:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "billing is not configured on this instance (STRIPE_SECRET_KEY unset)",
        )
    return stripe.StripeClient(settings.stripe_secret_key)


async def _ensure_stripe_customer(
    company_id: UUID, company_name: str, account_email: str,
) -> str:
    """Idempotent: returns the Stripe customer id, creating it on the
    first call. Stored on the company row so we don't create a new
    customer every time the CEO clicks Manage Billing."""
    async with acquire() as conn:
        existing = await conn.fetchval(
            "SELECT stripe_customer_id FROM companies WHERE id = $1",
            company_id,
        )
    if existing:
        return existing
    cust = _client().customers.create(params={
        "email": account_email,
        "name": company_name,
        "metadata": {"company_id": str(company_id)},
    })
    async with acquire() as conn:
        await conn.execute(
            "UPDATE companies SET stripe_customer_id = $2 WHERE id = $1",
            company_id, cust.id,
        )
    return cust.id


def create_checkout_session(
    *, customer_id: str, company_id: UUID, tier: Literal["starter", "pro"],
) -> str:
    """Create a Stripe Checkout Session for a tier upgrade. Returns
    the Stripe-hosted URL the browser should redirect to."""
    price_id = _tier_to_price_map().get(tier)
    if not price_id:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"no Stripe Price configured for tier {tier!r}",
        )
    return_url = settings.stripe_billing_return_url
    session = _client().checkout.sessions.create(params={
        "mode": "subscription",
        "customer": customer_id,
        "client_reference_id": str(company_id),
        "line_items": [{"price": price_id, "quantity": 1}],
        # Stripe-hosted success/cancel — both come back to the api host
        # with a query param the UI uses to show a confirmation banner.
        "success_url": f"{return_url}?billing=success",
        "cancel_url":  f"{return_url}?billing=cancel",
        "allow_promotion_codes": True,
        "subscription_data": {
            "metadata": {"company_id": str(company_id)},
        },
    })
    if not session.url:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            "Stripe returned no checkout URL",
        )
    return session.url


def create_portal_session(*, customer_id: str) -> str:
    """Customer portal — handles cancellation, payment-method updates,
    invoice history. We don't model any of that ourselves; Stripe does."""
    session = _client().billing_portal.sessions.create(params={
        "customer": customer_id,
        "return_url": settings.stripe_billing_return_url,
    })
    return session.url


# ───────────────── webhook handling ─────────────────


def verify_webhook(raw_body: bytes, signature: str) -> stripe.Event:
    if not settings.stripe_webhook_secret:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "STRIPE_WEBHOOK_SECRET unset — refusing to process webhooks",
        )
    try:
        return stripe.Webhook.construct_event(
            raw_body, signature, settings.stripe_webhook_secret,
        )
    except (stripe.SignatureVerificationError, ValueError) as e:
        log.warning("stripe webhook signature rejected: %s", e)
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "invalid webhook signature",
        )


def _g(obj, key, default=None):
    """Pull a field off either a stripe object or a raw dict — papers
    over the version-to-version SDK shape differences. Stripe objects
    expose attributes; webhook events sometimes hand us plain dicts."""
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)


async def _apply_subscription(
    sub, fallback_company_id: str | None = None,
) -> None:
    """Sync a Stripe subscription onto its company row.

    Resolution: company_id comes from `sub.metadata.company_id` first,
    then `sub.customer` lookup. The latter is the path for events that
    don't carry our metadata yet (rare; happens if the operator
    backfills a sub created outside our checkout flow)."""
    metadata = _g(sub, "metadata") or {}
    if not isinstance(metadata, dict):
        try:
            metadata = dict(metadata)
        except Exception:
            metadata = {}
    company_id_str = metadata.get("company_id") or fallback_company_id
    sub_id = _g(sub, "id")
    customer_id = _g(sub, "customer")
    status_str = _g(sub, "status")

    if not company_id_str:
        # Last-resort lookup via stripe_customer_id.
        async with acquire() as conn:
            company_id_str = await conn.fetchval(
                "SELECT id::text FROM companies WHERE stripe_customer_id = $1",
                customer_id,
            )
    if not company_id_str:
        log.warning("subscription %s carries no company_id — skipped", sub_id)
        return

    # The "active" item determines the tier. Subscriptions can carry
    # multiple items (addons), but for our tier-flip we look at the
    # first item's price.
    items_obj = _g(sub, "items") or {}
    items_data = _g(items_obj, "data") or []
    if not items_data:
        tier = "free"
    else:
        first = items_data[0]
        price_obj = _g(first, "price") or {}
        price_id = _g(price_obj, "id")
        tier = _price_to_tier_map().get(price_id, "free")

    # Stripe statuses that should clamp the tier back to free regardless
    # of which price was on the subscription: canceled, unpaid,
    # incomplete_expired. trialing/past_due keep the tier (grace period).
    if status_str in ("canceled", "unpaid", "incomplete_expired"):
        tier = "free"

    period_end = None
    cpe = _g(sub, "current_period_end")
    if cpe:
        from datetime import datetime, timezone
        period_end = datetime.fromtimestamp(int(cpe), tz=timezone.utc)

    async with acquire() as conn:
        await conn.execute(
            """
            UPDATE companies SET
                tier_name = $2,
                stripe_subscription_id = $3,
                subscription_status = $4,
                current_period_end = $5,
                updated_at = now()
            WHERE id = $1
            """,
            UUID(company_id_str), tier, sub_id, status_str, period_end,
        )
    log.info(
        "subscription sync company=%s tier=%s status=%s",
        company_id_str, tier, status_str,
    )


async def handle_event(event: stripe.Event) -> None:
    """Dispatch a verified webhook event. We only care about a small
    set of subscription-lifecycle types; everything else is logged and
    dropped quietly. Stripe retries on 5xx, so an exception here causes
    a retry — keep this idempotent."""
    kind = event["type"]
    obj = event["data"]["object"]
    if kind in (
        "customer.subscription.created",
        "customer.subscription.updated",
        "customer.subscription.deleted",
    ):
        # `obj` is the raw event-data dict from Stripe — _apply_subscription
        # uses `_g` so it works on either dicts or SDK objects.
        await _apply_subscription(obj)
    elif kind == "checkout.session.completed":
        # Bind the customer to the company immediately so even if the
        # subscription.* events race ahead we have a backstop.
        company_id = obj.get("client_reference_id")
        customer_id = obj.get("customer")
        if company_id and customer_id:
            async with acquire() as conn:
                await conn.execute(
                    "UPDATE companies SET stripe_customer_id = $2 WHERE id = $1 AND stripe_customer_id IS DISTINCT FROM $2",
                    UUID(company_id), customer_id,
                )
            # If the subscription is already attached, sync it too.
            sub_id = obj.get("subscription")
            if sub_id:
                sub = _client().subscriptions.retrieve(sub_id)
                await _apply_subscription(sub, fallback_company_id=company_id)
    else:
        log.debug("ignored stripe event %s", kind)
