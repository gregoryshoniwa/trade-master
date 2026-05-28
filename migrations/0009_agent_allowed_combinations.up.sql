-- Per-agent whitelist of (strategy, asset, contract) combos used when
-- trade_selection_mode = 'specific' (PLAN §7.3). App-level validated against
-- the strategy/contract registries — no CHECK so adding strategies isn't a
-- migration. The schema is a JSONB array; an empty array under `specific`
-- mode means "reject everything" (the safer fail-closed default).

BEGIN;

ALTER TABLE agents
    ADD COLUMN allowed_combinations JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMIT;
