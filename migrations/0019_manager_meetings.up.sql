-- Manager meetings (PLAN §10 update).
--
-- The scheduled cron handles "team review". A meeting is a focused 1:1
-- between the manager and one employee — deeper context, narrower
-- scope, its own transcript. We use the same `manager_actions` table
-- but add a new action_kind so the audit + UI can distinguish them.
--
-- A meeting may also be triggered by the CEO ad-hoc (no waiting for the
-- 4h cron), or by the manager itself from within a scheduled review.

ALTER TABLE manager_actions
    DROP CONSTRAINT IF EXISTS manager_actions_action_kind_check;

ALTER TABLE manager_actions
    ADD CONSTRAINT manager_actions_action_kind_check
        CHECK (action_kind IN ('review', 'adjust', 'pause', 'resume', 'meeting'));
