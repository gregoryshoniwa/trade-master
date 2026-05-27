BEGIN;
DROP TABLE IF EXISTS trade_postmortems;
ALTER TABLE trade_intents DROP COLUMN IF EXISTS entry_context;
COMMIT;
