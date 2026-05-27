-- Per-agent forecasting model (PLAN §3 — pluggable TSFMs).
--
-- Which time-series foundation model produces the signals an agent acts on.
-- Validated app-side against app.forecasting.registry (NOT a CHECK), so adding
-- a model is a code change, not a migration — mirrors how llm_model is handled.
-- The decision loop matches a forecast's `model` to this column, so the value
-- must equal the publishing service's model_label exactly (e.g. 'kronos-base').

BEGIN;

ALTER TABLE agents
    ADD COLUMN forecasting_model TEXT NOT NULL DEFAULT 'ttm-granite-r2';

-- Backs the decision loop's per-signal agent match, which scans all employees
-- across all companies filtered by forecasting_model.
CREATE INDEX idx_agents_forecasting_model ON agents (forecasting_model);

COMMIT;
