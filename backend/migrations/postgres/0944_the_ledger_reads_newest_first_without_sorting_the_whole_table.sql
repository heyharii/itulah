-- The movements ledger is read newest first: one page of it, ordered by
-- occurred_at descending and tie-broken by fact_sequence, with a keyset seek
-- to walk further back. No index leads with occurred_at. The movement table is
-- 8.8 million rows on the load estate, and the only orders that exist are
-- subject-then-time (movement_subject_time_idx) and the two place-then-time
-- indexes from 0072 — so a page that is not narrowed to one subject or place
-- gets the whole ledger sorted to hand back fifty rows.
--
-- One index in the ledger's own order. There is no need to spell the columns
-- DESC: Postgres reads an ascending index backwards at the same cost, so this
-- serves both walking down from the newest posting and walking up from the
-- oldest. The sort becomes a seek.
CREATE INDEX IF NOT EXISTS movement_occurred_fact_idx
    ON movement (occurred_at, fact_sequence);
