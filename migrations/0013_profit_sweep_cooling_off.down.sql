DROP TABLE IF EXISTS profit_sweeps;

ALTER TABLE agents
    DROP COLUMN IF EXISTS cooling_off_until,
    DROP COLUMN IF EXISTS cooling_off_loss_streak,
    DROP COLUMN IF EXISTS last_outcome_at;

ALTER TABLE companies
    DROP COLUMN IF EXISTS insurance_balance_usd;
