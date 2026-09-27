-- A prepayment spreads itself — for every prepaid thing, not one of them.
--
-- # What 0278 already did, and what it kept private
--
-- 0278 taught the books that a prepayment is used up a month at a time: the
-- asset is charged month by month and the expense lands in the month the
-- service is for. But the schedule it walked lived inside that one lane, on
-- the shape of that one document. Rent, insurance, a software subscription —
-- every other prepaid thing in the client's month has the same arithmetic and
-- no way to ask for it.
--
-- # What this migration does
--
-- Makes the schedule a table of its own, at the grain the poster already
-- posts: one row per (source document, account, site, month), charged or not.
-- The generalisation is deliberately boring — the same deferred constraint
-- discipline, the same source kind (`PREPAID_ALLOCATION`, already in the
-- 0298 list), and the run is a document like every other: it posts through
-- the one door (`poster::post`), it carries a `rule_version`
-- (`prepaid_spread/1`), and a month that is shut refuses it like everything
-- else.
--
-- The engine lives in Rust beside `prepaid.rs`, which becomes a caller of it
-- rather than the whole of it. This migration creates the schedule's home and
-- nothing else: a migration that invented postings would be a second author
-- of the books.

CREATE TABLE defer_schedule (
    schedule_id   uuid PRIMARY KEY,
    -- What was prepaid. The document that paid it — a bill, a cash document,
    -- an advance — names itself here, and the schedule is evidence about it.
    source_kind   text NOT NULL,
    source_id     text NOT NULL CHECK (btrim(source_id) <> ''),
    site_id       text NOT NULL REFERENCES site (id),
    -- The prepaid asset being drained, and the expense it drains into: the
    -- pair the monthly posting is, resolved through `account_map` at run time
    -- by the same meanings the source used — never frozen codes.
    prepaid_key   text NOT NULL,
    prepaid_qualifier text NOT NULL DEFAULT '',
    expense_key   text NOT NULL,
    expense_qualifier text NOT NULL DEFAULT '',
    total_minor   bigint NOT NULL CHECK (total_minor > 0),
    -- The spread. Even division down to the rupiah, remainder on the first
    -- month — the same rounding 0278 does, said once here.
    month_count   integer NOT NULL CHECK (month_count > 0),
    start_month   date NOT NULL,
    created_by    text NOT NULL CHECK (btrim(created_by) <> ''),
    created_at    timestamptz NOT NULL DEFAULT now(),

    UNIQUE (source_kind, source_id, prepaid_key, site_id)
);

CREATE TABLE defer_schedule_month (
    schedule_id   uuid NOT NULL REFERENCES defer_schedule (schedule_id) ON DELETE CASCADE,
    month         date NOT NULL,
    amount_minor  bigint NOT NULL CHECK (amount_minor > 0),
    -- The entry this month's share posted, when it posted. A month before its
    -- time has no entry and no date; the run fills both, once.
    journal_entry_id uuid REFERENCES journal_entry (entry_id),
    posted_at     timestamptz,

    PRIMARY KEY (schedule_id, month),
    CHECK ((journal_entry_id IS NULL) = (posted_at IS NULL))
);

CREATE INDEX ix_defer_schedule_month_due
    ON defer_schedule_month (month) WHERE journal_entry_id IS NULL;

COMMENT ON TABLE defer_schedule IS
    'A prepaid amount and the months it drains across — 0278''s arithmetic, generalized to any prepaid thing. The monthly run (Rust, prepaid_spread/1) posts every due month through the one door; a shut month refuses it like everything else.';
COMMENT ON TABLE defer_schedule_month IS
    'One row per month of the spread: what is due, and — once the run has posted it — the entry that did. The due-and-unposted rows are the whole run queue.';

-- ---------------------------------------------------------------------------
-- Guards
-- ---------------------------------------------------------------------------

DO $$
DECLARE
    s record;
    month_total bigint;
BEGIN
    -- The spread must return exactly what was prepaid: no month created yet,
    -- so the check is vacuous today and binding every month after.
    FOR s IN SELECT schedule_id, total_minor FROM defer_schedule LOOP
        SELECT COALESCE(SUM(amount_minor), 0) INTO month_total
          FROM defer_schedule_month
         WHERE schedule_id = s.schedule_id;
        IF month_total <> s.total_minor THEN
            RAISE EXCEPTION 'schedule % spreads to %, not its total %',
                s.schedule_id, month_total, s.total_minor;
        END IF;
    END LOOP;
END $$;
