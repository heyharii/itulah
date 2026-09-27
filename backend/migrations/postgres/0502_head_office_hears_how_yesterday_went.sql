-- 0502: head office hears how yesterday went before anybody asks.
--
-- Fase 3 of the assistant: the morning brief. A background agent
-- (`run_morning_brief_agent` in `postgres/assistant.rs`) sends every Admin one
-- notification a day, at the hour Finance sets on head office's clock:
-- yesterday's takings against the same weekday a week before, the shops that
-- moved most on their own, the missing stock still open, the shops behind on
-- the pricelist, and the assistant's budget when it is nearly spent.
--
-- Rules decide every line and no model is asked. A figure pushed to the
-- owner's phone at seven in the morning has to be the figure the screen
-- shows, every time; explaining it is what the assistant is for, once
-- somebody asks.
--
--   * `assistant.brief` joins the notification kinds — 0490's list otherwise
--     unchanged.
--   * `assistant_brief_hour` is that hour, 0-23. -1 stops the brief.
--   * `assistant_brief` keeps each day's brief, and its key is what makes it
--     once a day: the agent claims the day's row in the same transaction that
--     raises the notification, so a restart or a second node finds the day
--     taken.

ALTER TABLE notification DROP CONSTRAINT notification_kind_check;
ALTER TABLE notification ADD CONSTRAINT notification_kind_check
    CHECK (kind IN (
        'activity',
        'purchase.price_amendment.requested',
        'purchase.delivery.due_soon',
        'receipt.awaiting_identity',
        'receipt.excess_awaiting_decision',
        'finance.integrity.exception',
        'discussion.thread.opened',
        'discussion.thread.replied',
        'discussion.mentioned',
        'discussion.solution.accepted',
        'asset.assessment.overdue',
        'people.contract.expiring',
        'people.period.month_open',
        'people.roster.gap',
        'ga.contract.expiring',
        'ga.document.expiring',
        'finance.bill.due_soon',
        'finance.tax.deadline',
        'commercial.cap.near',
        'commercial.cap.reached',
        'commercial.rollout.failed',
        'commercial.rollout.stalled',
        'commercial.usage.stale',
        'commercial.guardrail.breached',
        'commercial.promotion.starting',
        'commercial.promotion.ending',
        'node.attention',
        'node.recovered',
        'assistant.brief'
    ));

INSERT INTO finance_setting (setting_key, value_numeric, unit, note, set_by) VALUES
    ('assistant_brief_hour', 7, 'hour',
     'The hour (0-23, head office''s clock) at which every Admin is sent yesterday''s brief. -1 stops it.',
     'migration:0502')
ON CONFLICT (setting_key) DO NOTHING;

CREATE TABLE assistant_brief (
    -- The day the brief is about: yesterday, when it was sent.
    business_date   date PRIMARY KEY,
    title           text NOT NULL CHECK (btrim(title) <> ''),
    body            text NOT NULL CHECK (btrim(body) <> ''),
    -- Null when nobody held the Admin rung to be told.
    notification_id uuid REFERENCES notification (notification_id),
    sent_at         timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE assistant_brief IS
    'Each morning brief sent to head office, one per business day (0502).';
