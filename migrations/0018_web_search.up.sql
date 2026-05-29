-- Internet search tool config (PLAN §14).
--
-- Adds a per-company toggle + allow/block lists + daily quota for the
-- agent web_search tool. Defaults are conservative: disabled, no
-- allowlist (treated as "no domains allowed"), and a tiny quota — the
-- CEO opts in explicitly per company.
--
-- We also keep a tiny audit log of every search so the CEO can review
-- what their agents are searching for and the quota counter is fair.

ALTER TABLE companies
    ADD COLUMN IF NOT EXISTS web_search_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS web_search_allowed_domains TEXT[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS web_search_blocked_domains TEXT[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS web_search_daily_quota INT NOT NULL DEFAULT 25;

CREATE TABLE IF NOT EXISTS web_search_log (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    agent_id    UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    query       TEXT NOT NULL,
    n_results   INT NOT NULL,
    ok          BOOLEAN NOT NULL,
    -- Populated on failure (quota hit, no allowed domains, upstream error)
    error_reason TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_web_search_log_company_ts
    ON web_search_log (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_web_search_log_agent_ts
    ON web_search_log (agent_id, created_at DESC);
