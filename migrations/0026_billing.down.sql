DROP INDEX IF EXISTS idx_companies_stripe_customer;
ALTER TABLE companies
    DROP COLUMN IF EXISTS stripe_customer_id,
    DROP COLUMN IF EXISTS stripe_subscription_id,
    DROP COLUMN IF EXISTS subscription_status,
    DROP COLUMN IF EXISTS current_period_end;
