-- A notification kind is a word the database knows.
--
-- The kinds live in a CHECK constraint rather than in free text, and that is
-- right: a screen reads `kind` to decide which record a notification points at
-- and what to draw, so an invented one is a row nothing can display. The cost
-- is that "any module can raise a notification" means a migration and not only
-- a line of Rust, which is worth saying out loud rather than discovering the
-- first time a handler answers "database operation failed".
--
-- # Three kinds, and one of them has been broken since the day it was written
--
-- `receipt.excess_awaiting_decision` is raised in `sync.rs` beside
-- `receipt.awaiting_identity` and was never added to the list. The two sit
-- fourteen lines apart. Nothing has failed yet only because no warehouse has
-- received more than it ordered since the constraint was written — the day one
-- does, the whole ingest transaction is refused and the delivery cannot be
-- accepted at all. Found by adding the two below and reading the constraint it
-- collided with.
--
-- The other two carry a shop's fault reports and the answers to them: the
-- discussion is the report channel, so the thread being opened and the thread
-- being replied to are the two moments somebody is waiting on.

ALTER TABLE notification DROP CONSTRAINT notification_kind_check;
ALTER TABLE notification ADD CONSTRAINT notification_kind_check
    CHECK (kind IN (
        'activity',
        'purchase.price_amendment.requested',
        'receipt.awaiting_identity',
        'receipt.excess_awaiting_decision',
        'finance.integrity.exception',
        'discussion.thread.opened',
        'discussion.thread.replied'
    ));
