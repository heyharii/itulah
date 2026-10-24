-- 0990: Head office stops a till, a cashier or a whole store, and removes a
-- store that closed for good.
--
-- The client's review of 23 Oct 2026: only head office may switch a POS off —
-- one PC, one person, or a store — and a store cannot do it for itself. The
-- owner added stopping a whole store and removing one that has closed.
-- Prototype: `ho-stop-access-prototype.html`.
--
-- One rule for all three: STOPPED means no selling and no new shift. A drawer
-- already open can still be counted and closed, so no takings are left
-- hanging.
--
-- * **A till** is a device, and already has its status (`device`, 0604):
--   ACTIVE, SUSPENDED (the hub's "Stopped") or REVOKED ("Removed"). Nothing
--   new is stored for it here.
--
-- * **A cashier** is stopped on their login, `app_user.till_stopped_*`, at
--   every store at once. Their hub account, if any, is untouched: blocking
--   the whole account is System › Users. Each server that signs them in hears
--   it with its next auth policy (`pos_stops` in the snapshot).
--
-- * **A store** is stopped on its unit, `unit.stopped_*`. Its server keeps
--   syncing, its store app keeps receiving and returning goods, and its
--   tills stop selling.
--
-- * **Removing a store** closes its unit (`unit.status = 'CLOSED'`, the word
--   0600 already allowed and nothing set). The unit row stays, with its
--   sales, stock, journals and people pointing at it. It only leaves the
--   active lists. A store is stopped before it is removed, so `stopped_*`
--   still says why when it is closed.
--
-- Each stop says who stopped it and why: the till shows the reason, and a
-- stop with no reason is a question nobody can answer later.

ALTER TABLE unit
    ADD COLUMN stopped_at     timestamptz,
    ADD COLUMN stopped_by     text,
    ADD COLUMN stopped_reason text,
    ADD COLUMN closed_at      timestamptz,
    ADD COLUMN closed_by      text,
    ADD CONSTRAINT unit_stop_is_whole
        CHECK ((stopped_at IS NULL) = (stopped_by IS NULL)
           AND (stopped_at IS NULL) = (stopped_reason IS NULL)),
    ADD CONSTRAINT unit_stop_says_why
        CHECK (stopped_reason IS NULL OR btrim(stopped_reason) <> ''),
    ADD CONSTRAINT unit_close_is_whole
        CHECK ((closed_at IS NULL) = (closed_by IS NULL));

COMMENT ON COLUMN unit.stopped_at IS
    'When head office stopped this store''s tills (0990). NULL: trading as usual. Its tills sell nothing and open no shift until head office resumes it; an open drawer can still be closed.';
COMMENT ON COLUMN unit.closed_at IS
    'When head office removed this store for good (0990), setting status CLOSED. Its history stays; it leaves the active lists.';

ALTER TABLE app_user
    ADD COLUMN till_stopped_at     timestamptz,
    ADD COLUMN till_stopped_by     text,
    ADD COLUMN till_stopped_reason text,
    ADD CONSTRAINT app_user_till_stop_is_whole
        CHECK ((till_stopped_at IS NULL) = (till_stopped_by IS NULL)
           AND (till_stopped_at IS NULL) = (till_stopped_reason IS NULL)),
    ADD CONSTRAINT app_user_till_stop_says_why
        CHECK (till_stopped_reason IS NULL OR btrim(till_stopped_reason) <> '');

COMMENT ON COLUMN app_user.till_stopped_at IS
    'When head office stopped this person on the POS (0990), at every store. NULL: allowed. They cannot sell or open a shift; a shift already open can still be closed.';
