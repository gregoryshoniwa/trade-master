BEGIN;
DROP INDEX IF EXISTS idx_intents_open_contracts;
ALTER TABLE trade_intents
    DROP COLUMN IF EXISTS execution_error,
    DROP COLUMN IF EXISTS closed_at,
    DROP COLUMN IF EXISTS exit_reason,
    DROP COLUMN IF EXISTS realized_pnl_usd,
    DROP COLUMN IF EXISTS longcode,
    DROP COLUMN IF EXISTS buy_transaction_id,
    DROP COLUMN IF EXISTS buy_price_usd;
COMMIT;
