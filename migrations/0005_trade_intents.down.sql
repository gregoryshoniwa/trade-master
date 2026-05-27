BEGIN;
DROP TRIGGER IF EXISTS tr_intents_updated_at ON trade_intents;
DROP TABLE IF EXISTS trade_intents;
COMMIT;
