-- Search backend preference + in-app notifications.
--
-- Two unrelated additions but both small enough to land together:
--   1. companies.web_search_backend: 'auto' picks Tavily when the env
--      key is set, otherwise DDG. 'tavily' and 'duckduckgo' force a
--      specific backend regardless of env state.
--   2. notifications: per-account in-app inbox the topbar bell reads
--      from. Currently driven by meeting completion; future writers
--      can use the same shape.

ALTER TABLE companies
    ADD COLUMN IF NOT EXISTS web_search_backend TEXT NOT NULL DEFAULT 'auto'
        CHECK (web_search_backend IN ('auto', 'tavily', 'duckduckgo'));

CREATE TABLE IF NOT EXISTS notifications (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id  UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    -- Free-form kind so writers can add categories without a migration.
    -- The UI uses it for icon selection only; unknown kinds get a default.
    kind        TEXT NOT NULL,
    title       TEXT NOT NULL,
    body        TEXT,
    -- Where the bell should send the user when they click this row.
    -- Relative path within the web app, e.g. "/meetings/<uuid>".
    link        TEXT,
    read_at     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_inbox
    ON notifications (account_id, read_at NULLS FIRST, created_at DESC);

-- Link manager_actions to their conversation transcript so the
-- Meetings page can render the full thread directly from an action
-- row. Existing rows are NULL — they predate the persistence step.
ALTER TABLE manager_actions
    ADD COLUMN IF NOT EXISTS conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL;
