-- Two-tier calibration (PLAN §11 update).
--
-- Isotonic (PAV) needs ~80+ samples to behave; below that the step
-- function gets wobbly and overfits noise. For slow-trading models
-- like Kronos we add Platt scaling (2-parameter logistic) which is
-- well-conditioned at N ≥ 20. This column records which method
-- produced the active calibrator so the UI can say "Platt from 29
-- samples" instead of pretending the curve has 29 independent knots.

ALTER TABLE forecast_calibrators
    ADD COLUMN IF NOT EXISTS method TEXT NOT NULL DEFAULT 'isotonic'
        CHECK (method IN ('isotonic', 'platt'));
