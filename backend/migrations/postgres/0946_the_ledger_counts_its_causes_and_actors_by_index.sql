-- The movements screen opens with three numbers beside its fifty rows: how
-- many postings the search matches, how they split by cause, and how they
-- split by who posted them. Those are exact counts, and exact counts read
-- every row they count — 8.8 million on the load estate. What they read is
-- the choice left: the counting half materialised the whole table's
-- (cause, actor_id) pairs and hashed them apart, because no index led with
-- either column, so there was no order to group by and no slice for a
-- ticked filter to narrow to.
--
-- Two indexes, one per column the breakdowns group by and the filters tick.
-- A ticked cause or actor counts a slice of one index rather than a walk of
-- the table, and the unfiltered breakdowns — inherently whole-ledger reads,
-- an exact count cannot read less — walk one narrow index in the grouping's
-- own order instead: no sort, no materialisation, no heap. A maintained
-- rollup was considered and declined: the breakdowns must respect a subject,
-- a pool and a free-text search, so a tally is only ever valid for the
-- unfiltered shape, and maintaining it would put the SALE counter on every
-- posting's write path.
CREATE INDEX IF NOT EXISTS movement_cause_idx
    ON movement (cause);

CREATE INDEX IF NOT EXISTS movement_actor_idx
    ON movement (actor_id);
