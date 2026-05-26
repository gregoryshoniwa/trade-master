-- TradeMaster initial schema (PLAN §6.2 v0.5)
-- Creates core multi-tenant entities: accounts, companies, members, Deriv
-- connections, agents. Plus the pgvector extension for mem0 memory in
-- later phases.

BEGIN;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS vector;

-- ─────────────────────────────────────────────────────────────────
-- accounts: one row per human signup
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE accounts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           TEXT UNIQUE NOT NULL,
    full_name       TEXT,                  -- "Gregory Shoniwa" — referenced by mem0
    phone           TEXT,
    jurisdiction    TEXT NOT NULL,         -- ISO code, e.g. "ZW"
    webauthn_creds  JSONB DEFAULT '[]'::jsonb,
    recovery_codes_hash JSONB DEFAULT '[]'::jsonb,  -- BIP39 codes (hashed)
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_accounts_email ON accounts (email);

-- ─────────────────────────────────────────────────────────────────
-- companies: tenant boundary. Every other row carries company_id.
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE companies (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                    TEXT NOT NULL,
    slug                    TEXT UNIQUE NOT NULL,
    logo_url                TEXT,
    brand_color             TEXT,
    ceo_account_id          UUID REFERENCES accounts(id) ON DELETE SET NULL,
    base_currency           TEXT NOT NULL DEFAULT 'USD',
    paper_mode              BOOLEAN NOT NULL DEFAULT TRUE,
    paper_unlocked_at       TIMESTAMPTZ,
    current_asset_tier      SMALLINT NOT NULL DEFAULT 1
                              CHECK (current_asset_tier BETWEEN 1 AND 9),
    unlocked_contract_types TEXT[] NOT NULL DEFAULT ARRAY['MULTUP','MULTDOWN'],
    event_aware_trading     BOOLEAN NOT NULL DEFAULT TRUE,
    created_by              UUID REFERENCES accounts(id),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_companies_slug ON companies (slug);
CREATE INDEX idx_companies_ceo ON companies (ceo_account_id);

-- ─────────────────────────────────────────────────────────────────
-- company_members: humans inside a company with roles
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE company_members (
    company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    account_id  UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    role        TEXT NOT NULL CHECK (role IN ('owner','admin','trader','viewer')),
    title       TEXT,                  -- "CEO", "Risk Officer" — surfaced to agents
    invited_by  UUID REFERENCES accounts(id),
    joined_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (company_id, account_id)
);
CREATE INDEX idx_members_account ON company_members (account_id);

-- ─────────────────────────────────────────────────────────────────
-- deriv_connections: per-Company Deriv WebSocket credentials
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE deriv_connections (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    label           TEXT NOT NULL,                  -- "Master" / "Manager Alpha account"
    api_token_enc   BYTEA NOT NULL,                 -- Vault-encrypted token
    account_type    TEXT NOT NULL CHECK (account_type IN ('demo','real')),
    currency        TEXT NOT NULL DEFAULT 'USD',
    balance_cached  NUMERIC(20,8),
    last_sync_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_deriv_conn_company ON deriv_connections (company_id);

-- ─────────────────────────────────────────────────────────────────
-- agents: configurable AI employees per Company
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE agents (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id               UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name                     TEXT NOT NULL,
    avatar_url               TEXT,
    role                     TEXT NOT NULL CHECK (role IN ('manager','employee','research')),
    reports_to_agent_id      UUID REFERENCES agents(id) ON DELETE SET NULL,
    llm_provider             TEXT NOT NULL,         -- 'anthropic'|'openai'|'google'|'groq'|'local'
    llm_model                TEXT NOT NULL,
    llm_config               JSONB NOT NULL DEFAULT '{}'::jsonb,
    voice_id                 TEXT,                  -- Gemini TTS voice
    voice_enabled            BOOLEAN NOT NULL DEFAULT TRUE,
    strategies               TEXT[] NOT NULL DEFAULT '{}',
    allowed_assets           TEXT[] NOT NULL DEFAULT '{}',
    allowed_contract_types   TEXT[] NOT NULL DEFAULT '{}',
    deriv_connection_id      UUID REFERENCES deriv_connections(id) ON DELETE SET NULL,
    allocated_balance_usd    NUMERIC(20,4) NOT NULL DEFAULT 0,
    max_position_size_usd    NUMERIC(20,4) NOT NULL DEFAULT 25,
    max_daily_drawdown_pct   NUMERIC(5,2) NOT NULL DEFAULT 5.0,
    -- personality + trade selection (PLAN §7)
    personality              TEXT NOT NULL DEFAULT 'balanced'
                               CHECK (personality IN ('sniper','scalper','hunter','guardian','balanced','custom')),
    trade_selection_mode     TEXT NOT NULL DEFAULT 'balanced'
                               CHECK (trade_selection_mode IN ('specific','most_profitable','safest','balanced')),
    kelly_fraction           NUMERIC(6,4) NOT NULL DEFAULT 0.25,
    min_confidence_threshold NUMERIC(6,4) NOT NULL DEFAULT 0.55,
    min_payoff_ratio         NUMERIC(5,2) NOT NULL DEFAULT 1.5,
    max_trades_per_day       INTEGER NOT NULL DEFAULT 20,
    target_holding_secs      INTEGER,
    event_aware              BOOLEAN NOT NULL DEFAULT TRUE,
    -- observed metrics (computed)
    aggression_index         SMALLINT NOT NULL DEFAULT 50
                               CHECK (aggression_index BETWEEN 0 AND 100),
    detected_personality     TEXT,
    observed_metrics         JSONB NOT NULL DEFAULT '{}'::jsonb,
    performance_stats        JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- runtime state
    trade_mode               TEXT NOT NULL DEFAULT 'approve_each'
                               CHECK (trade_mode IN ('autonomous','approve_each','approve_above_threshold')),
    is_active                BOOLEAN NOT NULL DEFAULT FALSE,
    is_paused                BOOLEAN NOT NULL DEFAULT FALSE,
    pause_reason             TEXT,
    system_prompt_addendum   TEXT,
    created_by               UUID REFERENCES accounts(id),
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_agents_company_role ON agents (company_id, role);
CREATE INDEX idx_agents_company_personality ON agents (company_id, personality);
CREATE INDEX idx_agents_reports_to ON agents (reports_to_agent_id);

-- ─────────────────────────────────────────────────────────────────
-- conversations + messages: chat threads per (user × agent)
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE conversations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    account_id      UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    agent_id        UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    title           TEXT,
    last_message_at TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_conversations_user_agent ON conversations (company_id, account_id, agent_id);

CREATE TABLE conversation_messages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    company_id      UUID NOT NULL,           -- denormalized for RLS + filtering
    role            TEXT NOT NULL CHECK (role IN ('user','assistant','tool','system')),
    content         TEXT NOT NULL,
    tool_calls      JSONB,
    metadata        JSONB DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_msg_conv_ts ON conversation_messages (conversation_id, created_at);

-- ─────────────────────────────────────────────────────────────────
-- updated_at triggers
-- ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tr_accounts_updated_at  BEFORE UPDATE ON accounts
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER tr_companies_updated_at BEFORE UPDATE ON companies
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER tr_agents_updated_at    BEFORE UPDATE ON agents
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
