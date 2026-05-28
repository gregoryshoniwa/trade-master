-- Backtest runs.
--
-- Each row records a walk-forward backtest the user kicked off from the
-- /backtests page. We store the request params so the user can re-run
-- with one click, the full result_json so the UI can render the per-symbol
-- breakdown long after the model service has forgotten, and a few
-- denormalised aggregates so list-views don't have to crack the JSON.

CREATE TABLE IF NOT EXISTS backtest_runs (
    id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id          UUID         NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    requested_by        UUID         NOT NULL REFERENCES accounts(id),

    -- Which forecaster (model_key matches forecasting registry + agents.forecasting_model)
    model_key           TEXT         NOT NULL,

    -- Request parameters
    symbols             TEXT[]       NOT NULL,
    granularity_secs    INTEGER      NOT NULL,
    bar_count           INTEGER      NOT NULL,
    horizon             INTEGER      NOT NULL,
    stride              INTEGER      NOT NULL,
    stop_pct            DOUBLE PRECISION NOT NULL,
    payoff_ratio        DOUBLE PRECISION NOT NULL,

    -- Lifecycle: pending → running → done | failed
    status              TEXT         NOT NULL DEFAULT 'pending',
    error_message       TEXT,

    -- Full per-symbol result + summary. Same shape the model service returns.
    result_json         JSONB,

    -- Denormalised aggregates from result_json.summary — for list views.
    n_forecasts         INTEGER,
    overall_hit_rate    DOUBLE PRECISION,
    overall_brier       DOUBLE PRECISION,
    overall_pnl_pct     DOUBLE PRECISION,

    -- One row per applied recommendation so we can audit who tweaked
    -- what agent off which run. (Composed JSON: {agent_id, fields_changed}.)
    applied_actions     JSONB        NOT NULL DEFAULT '[]'::jsonb,

    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    started_at          TIMESTAMPTZ,
    finished_at         TIMESTAMPTZ,
    duration_secs       INTEGER
);

CREATE INDEX IF NOT EXISTS idx_backtest_runs_company_created
    ON backtest_runs (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_backtest_runs_company_status
    ON backtest_runs (company_id, status);
