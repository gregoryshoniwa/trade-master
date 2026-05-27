-- Trade postmortems (PLAN §13.11/§13.12), Phase 1 shape.
--
-- entry_context is snapshotted onto the intent at decision time so the
-- postmortem is accurate even if the agent is later reconfigured. The
-- postmortem itself holds the structured entry/exit traces, a per-employee
-- rating, and an LLM-generated plain-language narrative.

BEGIN;

ALTER TABLE trade_intents
    ADD COLUMN entry_context JSONB;

CREATE TABLE trade_postmortems (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    intent_id  UUID NOT NULL UNIQUE REFERENCES trade_intents(id) ON DELETE CASCADE,
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    agent_id   UUID REFERENCES agents(id) ON DELETE SET NULL,

    outcome      TEXT NOT NULL,           -- 'win' | 'loss' | 'break_even'
    pnl_usd      NUMERIC(18,4) NOT NULL,

    entry_trace      JSONB NOT NULL,
    exit_trace       JSONB NOT NULL,
    employee_rating  JSONB NOT NULL,      -- direction / calibration / composite
    narrative        TEXT NOT NULL,

    generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_postmortems_company_ts ON trade_postmortems (company_id, generated_at DESC);
CREATE INDEX idx_postmortems_agent_ts   ON trade_postmortems (agent_id, generated_at DESC);

COMMIT;
