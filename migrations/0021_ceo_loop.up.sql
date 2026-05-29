-- CEO ⇄ manager ⇄ employee loop (PLAN §10 update).
--
-- Three additions that make the org chart actually conversational:
--
-- 1. companies.daily_profit_target_usd — a CEO-set target the manager
--    reads when sizing positions and reviewing employees. NULL means
--    "no specific target — just don't lose money".
--
-- 2. employee_meeting_requests — when an employee notices something
--    worth flagging (a loss streak, a regime change, a question), it
--    can drop a row here. The manager checks the queue at the start of
--    every scheduled review and during ad-hoc 1:1s.
--
-- 3. manager_actions: no new columns yet — the existing schema
--    already supports follow-up turns (we just append to the
--    conversation and write a new 'meeting' row referencing the same
--    conversation_id).

ALTER TABLE companies
    ADD COLUMN IF NOT EXISTS daily_profit_target_usd NUMERIC(18,4);

CREATE TABLE IF NOT EXISTS employee_meeting_requests (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id          UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    employee_agent_id   UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    reason              TEXT NOT NULL,
    status              TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'addressed', 'declined')),
    -- Links to the manager_actions row that resolved the request (a
    -- meeting or an adjustment). Lets the UI show "the manager
    -- responded with this 1:1 →" on the request feed.
    addressed_action_id UUID REFERENCES manager_actions(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    addressed_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_meeting_requests_pending
    ON employee_meeting_requests (company_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_meeting_requests_employee
    ON employee_meeting_requests (employee_agent_id, created_at DESC);
