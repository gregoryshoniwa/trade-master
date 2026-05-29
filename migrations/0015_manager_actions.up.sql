-- Manager actions audit (PLAN §10).
--
-- Every adjustment the Manager Agent makes to an Employee gets logged
-- here: the employee touched, the field changed, before/after, the
-- reason the LLM gave, and which manager_agent did it. The employee's
-- mem0 also reads from this so they have a memory of "Alpha changed me
-- at 14:32 because…".
--
-- We also log manager *reviews* (where the manager built a digest and
-- ran the LLM) even when no action was taken — useful for auditing
-- "did the manager see the data?" vs "did the manager act on it?".

CREATE TABLE IF NOT EXISTS manager_actions (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id       UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    manager_agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    employee_agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
    -- "review" = ran the digest, may or may not have acted
    -- "adjust" = changed a config field
    -- "pause"  = set is_paused=true
    -- "resume" = cleared is_paused
    action_kind      TEXT NOT NULL CHECK (action_kind IN ('review', 'adjust', 'pause', 'resume')),
    -- For 'adjust' actions: which field, before, after
    field_name       TEXT,
    before_value     JSONB,
    after_value      JSONB,
    reason           TEXT,
    -- The full LLM response that produced this action — kept for the
    -- audit trail and so the operator can see "what did Alpha actually
    -- decide?". Nullable so a manual / scripted action doesn't have to
    -- fake one.
    llm_narrative    TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_manager_actions_company_created
    ON manager_actions (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_manager_actions_employee
    ON manager_actions (employee_agent_id, created_at DESC);
