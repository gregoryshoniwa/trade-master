-- Per-agent forecast cadence.
--
-- Forecasters publish a signal per symbol every ~60s. With multiple
-- forecasters active (TTM + Kronos + TSFM) plus 14+ symbols, the
-- decision loop can see 50+ signals/min. Without a per-agent throttle
-- the same agent would consider every one of them, blowing through
-- `max_trades_per_day` and racking up correlated positions.
--
-- This column lets each agent declare "evaluate at most one signal per
-- N seconds across all my matching forecast models". Default 60s
-- preserves current behavior (one signal per minute per symbol).

ALTER TABLE agents
    ADD COLUMN IF NOT EXISTS forecast_min_interval_secs INT NOT NULL DEFAULT 60
        CHECK (forecast_min_interval_secs BETWEEN 5 AND 86400);
