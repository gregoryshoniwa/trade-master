ALTER TABLE manager_actions DROP COLUMN IF EXISTS conversation_id;

DROP TABLE IF EXISTS notifications;

ALTER TABLE companies DROP COLUMN IF EXISTS web_search_backend;
