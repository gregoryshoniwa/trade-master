BEGIN;
ALTER TABLE companies
    DROP COLUMN IF EXISTS kill_switch_active,
    DROP COLUMN IF EXISTS kill_switch_reason,
    DROP COLUMN IF EXISTS kill_switch_at,
    DROP COLUMN IF EXISTS daily_loss_limit_usd;
COMMIT;
