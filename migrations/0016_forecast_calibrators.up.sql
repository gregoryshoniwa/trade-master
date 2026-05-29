-- Forecast confidence calibration (PLAN §11).
--
-- Raw forecaster scores (Kronos, TTM, etc.) are not probabilities — they
-- correlate with win probability but are systematically miscalibrated.
-- A model that says "65% confidence" might empirically win 48% of the
-- time across the trades agents actually took. Raising an agent's
-- `min_confidence_threshold` doesn't help if the threshold is on a
-- meaningless number.
--
-- We fix this with **isotonic regression** (pool-adjacent-violators)
-- fit on the recent window of (raw_confidence, outcome) pairs per
-- forecasting model. The artifact is a sorted list of breakpoints
-- representing a monotone step function: raw_prob → calibrated_prob.
--
-- Calibration is per-model (not per-agent) because the same model
-- outputs the same probabilities for every agent. We also store the
-- before/after Brier and ECE so the UI can show "is this model
-- actually calibrated now?".

CREATE TABLE IF NOT EXISTS forecast_calibrators (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    forecasting_model  TEXT NOT NULL,
    fitted_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Inputs to the fit, kept for audit / debugging
    window_days        INT NOT NULL,
    n_samples          INT NOT NULL,
    -- Reliability metrics — Brier score & Expected Calibration Error
    raw_brier          DOUBLE PRECISION NOT NULL,
    calibrated_brier   DOUBLE PRECISION NOT NULL,
    raw_ece            DOUBLE PRECISION NOT NULL,
    calibrated_ece     DOUBLE PRECISION NOT NULL,
    -- Artifact: list of {x: raw_prob, y: calibrated_prob} breakpoints,
    -- sorted ascending by x. Application is a step lookup:
    --   apply(raw) = y of the first breakpoint with x >= raw,
    --   or the last y when raw exceeds all breakpoints.
    artifact           JSONB NOT NULL,
    is_active          BOOLEAN NOT NULL DEFAULT TRUE
);

-- Only one active calibrator per model — the fit job marks the previous
-- one inactive before inserting the new one.
CREATE UNIQUE INDEX IF NOT EXISTS idx_calibrator_active_model
    ON forecast_calibrators (forecasting_model)
    WHERE is_active;

CREATE INDEX IF NOT EXISTS idx_calibrator_model_fitted
    ON forecast_calibrators (forecasting_model, fitted_at DESC);
