-- 0125: The notification table learns one more word.
--
-- `notification.kind` is a closed set on purpose — 0046 says why: the browser
-- routes on it, so a new kind is a deliberate act rather than a typo somebody
-- shipped. This is that deliberate act.
--
-- # Why only on the transition
--
-- The engine raises this when a control equation CROSSES into Exception or
-- Blocked, never on the nights it merely stays there. An unmatched bank line
-- that has been open for six weeks is a real problem and it is not six weeks of
-- news; a notification every night would train exactly the reflex 0046 warns
-- about, which is to dismiss all of them. The standing state lives in
-- `attention_item`, which is a queue and does not expire.

ALTER TABLE notification
    DROP CONSTRAINT notification_kind_check;
ALTER TABLE notification
    ADD CONSTRAINT notification_kind_check CHECK (kind IN (
        'purchase.price_amendment.requested',
        'receipt.awaiting_identity',
        'activity',
        -- A control equation that agreed yesterday does not agree today.
        'finance.integrity.exception'
    ));

COMMENT ON CONSTRAINT notification_kind_check ON notification IS
    'The closed set of things a person can be told about. Adding one is a '
    'migration, deliberately.';
