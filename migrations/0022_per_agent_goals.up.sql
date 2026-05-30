-- Per-employee daily profit target.
--
-- Companies got a single target in migration 0021; this lets the CEO
-- (or manager via tool call) set individual targets per employee.
-- Decision loop applies the more restrictive throttle of company vs
-- agent — if either is "halve", we halve.

ALTER TABLE agents
    ADD COLUMN IF NOT EXISTS daily_profit_target_usd NUMERIC(18,4);
