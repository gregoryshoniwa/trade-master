BEGIN;

DROP INDEX IF EXISTS idx_invite_company;
ALTER TABLE invite_tokens
    DROP COLUMN IF EXISTS title,
    DROP COLUMN IF EXISTS invited_by_account_id,
    DROP COLUMN IF EXISTS role,
    DROP COLUMN IF EXISTS company_id;

ALTER INDEX idx_invite_expires RENAME TO idx_magic_link_expires;
ALTER INDEX idx_invite_email RENAME TO idx_magic_link_email;
ALTER TABLE invite_tokens RENAME TO magic_link_tokens;

ALTER TABLE accounts
    DROP COLUMN IF EXISTS password_updated_at,
    DROP COLUMN IF EXISTS password_hash;

COMMIT;
