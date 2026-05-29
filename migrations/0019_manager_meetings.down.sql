ALTER TABLE manager_actions
    DROP CONSTRAINT IF EXISTS manager_actions_action_kind_check;

ALTER TABLE manager_actions
    ADD CONSTRAINT manager_actions_action_kind_check
        CHECK (action_kind IN ('review', 'adjust', 'pause', 'resume'));
