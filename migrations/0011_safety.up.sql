-- Safety: kill switch + circuit breaker (PLAN §22 / Phase 7 basics).
--
-- kill_switch_active is the master flag the risk agent consults. It can be
-- flipped manually by an owner/admin or automatically by the circuit-breaker
-- background task (services/api/app/safety.py) when realized loss for the day
-- exceeds daily_loss_limit_usd.

BEGIN;

ALTER TABLE companies
    ADD COLUMN kill_switch_active BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN kill_switch_reason TEXT,
    ADD COLUMN kill_switch_at    TIMESTAMPTZ,
    ADD COLUMN daily_loss_limit_usd NUMERIC(18,4);

COMMIT;
