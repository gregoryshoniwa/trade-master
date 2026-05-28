-- Economic calendar (PLAN §9). Normalized, source-agnostic event table that
-- the risk agent consults for blackout windows and the decision loop folds
-- into entry_context. Events are global (not per-company); membership scopes
-- the routes that surface them.
--
-- event_id is the upstream-stable id (Forex Factory uses a hash of
-- date+country+title); ON CONFLICT lets the ingestor upsert idempotently.

BEGIN;

CREATE TABLE economic_events (
    event_id        TEXT PRIMARY KEY,
    ts              TIMESTAMPTZ NOT NULL,
    country         TEXT NOT NULL,
    name            TEXT NOT NULL,
    impact          TEXT NOT NULL,           -- 'high' | 'medium' | 'low'
    category        TEXT,
    previous        TEXT,
    forecast        TEXT,
    actual          TEXT,
    affected_currencies TEXT[] NOT NULL DEFAULT '{}',
    affected_assets     TEXT[] NOT NULL DEFAULT '{}',
    source          TEXT NOT NULL,           -- 'forex_factory' | 'finnhub' | ...
    fetched_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_events_ts_impact ON economic_events (ts, impact);
CREATE INDEX idx_events_currencies ON economic_events USING GIN (affected_currencies);
CREATE INDEX idx_events_assets ON economic_events USING GIN (affected_assets);

COMMIT;
