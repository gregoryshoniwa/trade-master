-- Profit sweep + cooling-off (PLAN §6, Phase 6).
--
-- Two safeguards, one migration:
--
--   1) Profit sweep: when an agent's realized P&L crosses a threshold,
--      the sweep job moves a fraction off its allocation into the
--      company's `insurance_balance_usd`. Sweeps are recorded in their
--      own table so we can audit every move.
--   2) Cooling-off: after N consecutive losses (or a daily drawdown
--      breach) the decision loop refuses to issue new intents for the
--      agent until `cooling_off_until` passes. Streaks reset on a win.

-- Company-level insurance pot.
ALTER TABLE companies
    ADD COLUMN IF NOT EXISTS insurance_balance_usd NUMERIC(20, 4) NOT NULL DEFAULT 0;

-- Per-agent cooling-off state.
ALTER TABLE agents
    ADD COLUMN IF NOT EXISTS cooling_off_until      TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS cooling_off_loss_streak INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS last_outcome_at        TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS profit_sweeps (
    id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id    UUID         NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    agent_id      UUID         REFERENCES agents(id) ON DELETE SET NULL,
    -- Positive: profit moving INTO insurance. Could go negative if we
    -- ever build a "draw from insurance" rebate path, hence signed.
    amount_usd    NUMERIC(20, 4) NOT NULL,
    -- Snapshot of the agent's realized window P&L + allocation at sweep
    -- time so the audit row stands on its own without joining live state.
    window_realized_pnl_usd NUMERIC(20, 4) NOT NULL,
    allocation_usd          NUMERIC(20, 4) NOT NULL,
    reason        TEXT         NOT NULL,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_profit_sweeps_company_created
    ON profit_sweeps (company_id, created_at DESC);
