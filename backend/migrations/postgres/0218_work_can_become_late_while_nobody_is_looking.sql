-- Work can become late while nobody is looking.
--
-- Every notification this system raises so far hangs on somebody's request: a
-- delivery was received, a supplier invoiced, a shop reported a fault. An asset
-- that has sat unassessed for a week hangs on nothing — no request happens at
-- the moment it becomes late, and the only reason anybody would find it is by
-- opening the register and filtering for it.
--
-- So the first kind raised by a PASS rather than by a person. The catalogue
-- publisher already makes this argument for a promotion whose window opened at
-- midnight; the difference here is that a pass over work must raise its notice
-- exactly once, because a condition that is still true tomorrow must not be
-- announced again tomorrow. The guard lives in the query; this only widens the
-- vocabulary it writes with.

ALTER TABLE notification DROP CONSTRAINT notification_kind_check;
ALTER TABLE notification ADD CONSTRAINT notification_kind_check
    CHECK (kind IN (
        'activity',
        'purchase.price_amendment.requested',
        'receipt.awaiting_identity',
        'receipt.excess_awaiting_decision',
        'finance.integrity.exception',
        'discussion.thread.opened',
        'discussion.thread.replied',
        'asset.assessment.overdue'
    ));
