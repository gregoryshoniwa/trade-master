DROP TABLE IF EXISTS web_search_log;

ALTER TABLE companies
    DROP COLUMN IF EXISTS web_search_daily_quota,
    DROP COLUMN IF EXISTS web_search_blocked_domains,
    DROP COLUMN IF EXISTS web_search_allowed_domains,
    DROP COLUMN IF EXISTS web_search_enabled;
