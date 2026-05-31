-- Per-company credentials (broker tokens + LLM provider keys).
--
-- Stored Fernet-encrypted in the BYTEA columns. The encryption key
-- lives in the api process env (CREDENTIALS_KEY) — never in the DB.
-- The api never returns plaintext values via the REST API; the only
-- read paths are the api's own runtime (LLM dispatch, broker calls)
-- and an admin export when a key needs to be rotated.
--
-- TSFM_API_KEY and TAVILY_API_KEY are intentionally NOT included —
-- those are system-owner-managed env vars on the api/tsfm containers,
-- shared across all customers. Everything else here is per-customer.

CREATE TABLE IF NOT EXISTS company_credentials (
    company_id UUID PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,

    -- Broker — Deriv. Each company can hold both a demo and a real
    -- token; `deriv_environment` selects which one is live. We never
    -- mix the two in a single trade path.
    deriv_token_demo BYTEA,
    deriv_token_real BYTEA,
    deriv_environment TEXT NOT NULL DEFAULT 'demo'
        CHECK (deriv_environment IN ('demo', 'real')),

    -- LLM provider keys (customer brings own). The api prefers these
    -- when present; falls back to the system env keys for free-tier
    -- accounts and during onboarding.
    anthropic_api_key BYTEA,
    openai_api_key    BYTEA,
    gemini_api_key    BYTEA,
    openrouter_api_key BYTEA,
    groq_api_key      BYTEA,

    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed empty rows for existing companies so the runtime can do a
-- straight UPSERT/UPDATE without an existence dance.
INSERT INTO company_credentials (company_id)
SELECT id FROM companies
ON CONFLICT (company_id) DO NOTHING;
