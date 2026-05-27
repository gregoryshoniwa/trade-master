-- Phase 1 auth rework: password-based login + invite tokens.
--
-- We add a password_hash to accounts and repurpose the existing
-- magic_link_tokens table as a generic invite-tokens table. This way
-- accounts created during the magic-link era keep working — we just need
-- to set passwords for them via the API.

BEGIN;

-- ── passwords on accounts ──────────────────────────────────────────
ALTER TABLE accounts
    ADD COLUMN password_hash TEXT,
    ADD COLUMN password_updated_at TIMESTAMPTZ;

-- ── invite tokens ──────────────────────────────────────────────────
ALTER TABLE magic_link_tokens
    RENAME TO invite_tokens;

ALTER INDEX idx_magic_link_email RENAME TO idx_invite_email;
ALTER INDEX idx_magic_link_expires RENAME TO idx_invite_expires;

ALTER TABLE invite_tokens
    ADD COLUMN company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    ADD COLUMN role TEXT CHECK (role IN ('admin', 'trader', 'viewer')),
    ADD COLUMN invited_by_account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
    ADD COLUMN title TEXT;

CREATE INDEX idx_invite_company ON invite_tokens (company_id)
    WHERE consumed_at IS NULL;

COMMIT;
