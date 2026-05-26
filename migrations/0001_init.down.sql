-- Rollback of 0001_init

BEGIN;

DROP TRIGGER IF EXISTS tr_agents_updated_at ON agents;
DROP TRIGGER IF EXISTS tr_companies_updated_at ON companies;
DROP TRIGGER IF EXISTS tr_accounts_updated_at ON accounts;
DROP FUNCTION IF EXISTS set_updated_at();

DROP TABLE IF EXISTS conversation_messages;
DROP TABLE IF EXISTS conversations;
DROP TABLE IF EXISTS agents;
DROP TABLE IF EXISTS deriv_connections;
DROP TABLE IF EXISTS company_members;
DROP TABLE IF EXISTS companies;
DROP TABLE IF EXISTS accounts;

-- We deliberately do NOT drop the extensions; they may be used by other apps.

COMMIT;
