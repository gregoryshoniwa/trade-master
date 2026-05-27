-- LLM usage tracking. One row per provider call so we can build a "what
-- did each agent cost" report (the HR Payroll page in §17.x of PLAN).

BEGIN;

CREATE TABLE llm_usage (
    id BIGSERIAL PRIMARY KEY,
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
    agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    estimated_cost_usd NUMERIC(14, 8) NOT NULL DEFAULT 0,
    -- 'chat' | 'mem0_extract' | 'agent_decision' | 'tool_explain'
    kind TEXT NOT NULL DEFAULT 'chat',
    latency_ms INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_llm_usage_company_ts ON llm_usage (company_id, created_at DESC);
CREATE INDEX idx_llm_usage_agent_ts   ON llm_usage (agent_id, created_at DESC) WHERE agent_id IS NOT NULL;
CREATE INDEX idx_llm_usage_model      ON llm_usage (provider, model);

COMMIT;
