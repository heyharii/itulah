-- The member directory opens with a page and the shape of everything the
-- page was drawn from: the six segments counted, and how many members the
-- search, the narrowing and the filters match. Both halves were read by
-- aggregating the whole till history first — one subquery folding every
-- completed sale per card, another folding every line of every completed
-- sale — and the second is the expensive one by far: on the load estate a
-- million receipts and the lines on them, walked once for the page and
-- once for the facets, and the open measured 2.2-3.7 s of it.
--
-- The rank cannot be made cheap — "who spent most" needs every member's
-- spend, however the query is shaped — but it can be made to read an index
-- instead of the table. One covering index holds everything the spend
-- subquery sums, keyed by the card it is summed for: a group-by over it is
-- an index-only scan in the index's own order — no heap, no sort — and the
-- partial predicate is that subquery's own WHERE, minus the `btrim` clause
-- the query still applies for itself. `sale_id` rides in INCLUDE for the
-- pieces: the lines carry no card number, so that arm joins receipts to
-- lines, and the receipts' side of the join is served from this same
-- index. The second index carries the quantity the same way; it shares its
-- key with `edge_sale_line_pkey`, which stays — the primary key is the
-- uniqueness of a line, this one is a read path, and what it buys is the
-- pieces fold without a heap fetch per line.
--
-- The queries meet the indexes halfway — the other half of this change is
-- in membership.rs, where the page now ranks on the card and what was
-- spent on it and fetches the pieces, the vouchers and the pairing for the
-- rows it keeps alone, and the whole envelope — page, six, total, scheme
-- count — comes off that one fold in one statement instead of three, two
-- of which walked the till history again. Until they did, no index could
-- help: the aggregate subqueries sat above the sort and the limit, so
-- PostgreSQL had to fold every line of every sale before it could hand
-- back one screen, and the facets materialised the whole join to read a
-- single column of it.

CREATE INDEX IF NOT EXISTS ix_edge_sale_member_spend
    ON edge_sale (customer_id)
    INCLUDE (sale_id, occurred_at, total_minor, discount_total_minor, points_earned)
    WHERE customer_id IS NOT NULL AND status = 'COMPLETED';

CREATE INDEX IF NOT EXISTS ix_edge_sale_line_quantity
    ON edge_sale_line (sale_id)
    INCLUDE (quantity);
