-- A delivery is due, and the floor should know.
--
-- The supplier promises a date per line and nothing in this estate fires when
-- that date comes near. What happens instead is that a lorry arrives, and the
-- people who have to receive it, count it and tag it find out by seeing it.
--
-- Three days is the warning: long enough to clear a bay and put somebody on
-- the rota, short enough to still be the same week. Told to the people at the
-- DESTINATION rather than to the whole company — a delivery landing at
-- store-07 is store-07's morning, and the same notice sent to fourteen units
-- is thirteen interruptions and one warning.
--
-- What it deliberately does not cover is a delivery that is already late.
-- "It should have arrived yesterday" stays true tomorrow, so it is a standing
-- condition and belongs in the receiving screen's count; a notice for it would
-- repeat every hour until somebody closed the order.

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
        'asset.assessment.overdue'
    ));
