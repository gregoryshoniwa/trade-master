-- Magic-link tokens for passwordless auth (Phase 0).
-- We store SHA-256 hashes of tokens so a DB read doesn't leak active links.

BEGIN;

CREATE TABLE magic_link_tokens (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email        TEXT NOT NULL,
    full_name    TEXT,
    token_hash   TEXT NOT NULL UNIQUE,
    expires_at   TIMESTAMPTZ NOT NULL,
    consumed_at  TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_magic_link_email     ON magic_link_tokens (email, expires_at);
CREATE INDEX idx_magic_link_expires   ON magic_link_tokens (expires_at)
    WHERE consumed_at IS NULL;

-- TTL cleanup job target: rows older than 7 days even if unconsumed.

COMMIT;
