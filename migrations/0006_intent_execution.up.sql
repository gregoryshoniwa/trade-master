-- Execution + fill detail on trade_intents. One intent = one Deriv
-- contract (these contract types don't partial-fill), so we keep the
-- fill columns inline rather than a separate table.

BEGIN;

ALTER TABLE trade_intents
    ADD COLUMN buy_price_usd       NUMERIC(18,4),
    ADD COLUMN buy_transaction_id  BIGINT,
    ADD COLUMN longcode            TEXT,
    ADD COLUMN realized_pnl_usd    NUMERIC(18,4),
    ADD COLUMN exit_reason         TEXT,   -- 'sold' | 'stop_loss' | 'take_profit' | 'expiry'
    ADD COLUMN closed_at           TIMESTAMPTZ,
    ADD COLUMN execution_error     TEXT;

CREATE INDEX idx_intents_open_contracts ON trade_intents (broker_contract_id)
    WHERE status = 'executed' AND closed_at IS NULL;

COMMIT;
