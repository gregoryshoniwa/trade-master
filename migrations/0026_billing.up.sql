-- Stripe subscription state per company.
--
-- The api flips `tier_name` based on the active Stripe subscription's
-- price ID. We persist the Stripe customer + subscription IDs here
-- so the customer portal session + webhook idempotency both have
-- something to anchor against.
--
-- `subscription_status` mirrors Stripe's status enum (trialing,
-- active, past_due, canceled, …). UI shows a warning banner when it's
-- anything other than 'active' or null. The api doesn't enforce on
-- the status field directly — only on `tier_name`, which the webhook
-- handler keeps in sync.

ALTER TABLE companies
    ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT,
    ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT,
    ADD COLUMN IF NOT EXISTS subscription_status TEXT,
    ADD COLUMN IF NOT EXISTS current_period_end TIMESTAMPTZ;

-- Look up a company by stripe_customer_id on every webhook hit;
-- indexed for the inevitable hot path.
CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_stripe_customer
    ON companies (stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;
