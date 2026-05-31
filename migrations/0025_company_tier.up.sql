-- Subscription tier per company.
--
-- The tier gates feature access in code; tier limits live in
-- `app/tiers.py` (a Python module, not a DB table) so the source of
-- truth is versioned with the rest of the runtime. Each company carries
-- only its tier name here; the runtime joins to the limits when it
-- evaluates a gate.
--
-- The CEO upgrades manually for now (set the column via SQL or a future
-- admin tool). Stripe webhooks would flip this column when payment
-- lands — that's Phase 4. Existing companies default to 'pro' so the
-- enforcement turn doesn't suddenly clamp accounts that were created
-- pre-tier; new signups land on 'free'.

ALTER TABLE companies
    ADD COLUMN IF NOT EXISTS tier_name TEXT NOT NULL DEFAULT 'pro'
        CHECK (tier_name IN ('free', 'starter', 'pro', 'enterprise'));

-- New signups land on 'free' going forward — flip the default after
-- existing rows have been seeded.
ALTER TABLE companies ALTER COLUMN tier_name SET DEFAULT 'free';
