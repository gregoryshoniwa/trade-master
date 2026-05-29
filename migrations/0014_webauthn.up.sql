-- WebAuthn / passkey credentials (PLAN Phase 7).
--
-- Used to gate the one really sensitive operation we have today: flipping
-- an agent from paper trading to live trading. The gate is enforced by
-- the api (`routes/agents.py` PATCH /agents/{id}); credentials live here.

CREATE TABLE IF NOT EXISTS webauthn_credentials (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id      UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    -- The credential identifier the authenticator picks. We store it raw
    -- (BYTEA) because some authenticators use non-printable bytes; the
    -- browser sends base64url, we decode before storing.
    credential_id   BYTEA NOT NULL UNIQUE,
    public_key      BYTEA NOT NULL,
    -- Monotonic counter — if an authenticator sends a counter ≤ the one
    -- we last saw, that's a sign of a cloned authenticator. We reject.
    sign_count      BIGINT NOT NULL DEFAULT 0,
    transports      TEXT[] NOT NULL DEFAULT '{}',
    -- Human-readable label so the user can tell which device is which on
    -- the "manage passkeys" screen (eventual UI).
    name            TEXT NOT NULL DEFAULT 'Passkey',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_webauthn_credentials_account
    ON webauthn_credentials (account_id);

-- The registration/assertion challenges we mint live for ~5 minutes.
-- Stored in postgres rather than redis so the api stays single-dep for now.
CREATE TABLE IF NOT EXISTS webauthn_challenges (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id   UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    challenge    BYTEA NOT NULL,
    -- "register" for create() flows, "assert" for get() flows.
    purpose      TEXT NOT NULL CHECK (purpose IN ('register', 'assert')),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at   TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_webauthn_challenges_account
    ON webauthn_challenges (account_id, purpose, expires_at);
