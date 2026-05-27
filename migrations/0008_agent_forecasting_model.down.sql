BEGIN;
DROP INDEX IF EXISTS idx_agents_forecasting_model;
ALTER TABLE agents DROP COLUMN IF EXISTS forecasting_model;
COMMIT;
