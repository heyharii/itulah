-- A fact is deduplicated by its own origin, not by the fleet.
--
-- `sync_ingest_fact` carried `UNIQUE (event_id)` across every origin, and the
-- ingest path looked a fact up by event id alone (`cloud::postgres::sync`,
-- the `held_rows` query). A publication is ONE command sent to many stores, and
-- each store answers it with a fact whose event id is the publication id —
-- `edge::sync::apply_activation` says so in as many words: "the publication id
-- is the fact's event id, so a replay is deduplicated by the lane rather than
-- counted twice".
--
-- So the first store's activation was filed and every other store's was read as
-- a duplicate of it and skipped. Silently: the watermark advanced, no receipt
-- and no dead letter were written, and `commercial_rollout` kept showing the
-- rest of the fleet as never activated.
--
-- Identity is (origin, event id). The same fact re-sent by the same node is
-- still deduplicated, which is the whole point of the lane; two nodes answering
-- the same command are two facts.
--
-- The column list also decides what `held_by_event` may be keyed by: the ingest
-- query filters on the batch's origin for the same reason, and the two have to
-- agree or the second store's insert fails on this index instead of being read
-- as a duplicate.

DROP INDEX ux_sync_ingest_event_id;

CREATE UNIQUE INDEX ux_sync_ingest_origin_event
    ON sync_ingest_fact (origin_id, event_id);

COMMENT ON INDEX ux_sync_ingest_origin_event IS
    'One fact per (origin, event id): a replay from one node is deduplicated, and two nodes answering the same command (a publication, whose id is the fact''s event id) are two facts (0706).';
