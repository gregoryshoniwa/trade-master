BEGIN;
ALTER TABLE agents DROP COLUMN IF EXISTS allowed_combinations;
COMMIT;
