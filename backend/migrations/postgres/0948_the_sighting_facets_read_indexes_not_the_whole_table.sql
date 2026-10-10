-- The observations list answers a page and, with every page, the shape of
-- everything the page was drawn from: the sightings split by pool, by
-- device and by method, plus the exact total. When the page is not
-- narrowed to a pool, a tag or a search, those are group-bys and a count
-- over the whole sighting table — millions of rows on the load estate —
-- and this morning the recount alone ran ~6 s, the bulk of a ~5 s
-- endpoint.
--
-- Each facet's own shape is the index: the group key and nothing else,
-- because nothing else narrows it first. These are also the columns
-- Postgres stores cheapest — duplicates in a non-unique b-tree collapse
-- into posting lists, and a few dozen pools, a device per antenna and a
-- couple of methods are nearly nothing but duplicates — so each index is
-- megabytes where the table is gigabytes, and a group-by is answered by
-- an index-only scan in the index's own order: no sort, no heap. The
-- indexes this table already carries cannot shrink that way.
-- ix_observation_pool_last_seen carries last_seen_at beside pool_id,
-- which makes almost every key distinct, and observation_burst_idx leads
-- with device_id only in front of a session, a pool and an EPC, so a
-- group-by by device walks all four columns.
--
-- The house order gets what the ledger got in 0944: the list is read
-- newest first, last_seen_at descending tie-broken by observation_id, and
-- no index leads with last_seen_at, so the default page sorted the whole
-- stream to hand back two hundred rows. Ascending columns suffice —
-- Postgres reads a b-tree backwards at the same cost — and the first page
-- and every keyset seek after it become a walk down the index.
--
-- 0072 created ix_observation_pool_last_seen over exactly 0001's
-- observation_recent_pool_idx, and every sighting written since has paid
-- for both. The duplicate is dropped here; a pool's own sightings keep
-- the one that remains.
--
-- The queries meet the indexes halfway — the other half of this change is
-- in observations.rs, where the facet statement asks for NOT MATERIALIZED
-- when nothing narrows the sightings, so its branches read these indexes
-- instead of one wide materialised copy of the table.

CREATE INDEX IF NOT EXISTS ix_observation_pool_facet
    ON observation_sighting (pool_id);

CREATE INDEX IF NOT EXISTS ix_observation_device_facet
    ON observation_sighting (device_id);

CREATE INDEX IF NOT EXISTS ix_observation_method_facet
    ON observation_sighting (method);

CREATE INDEX IF NOT EXISTS ix_observation_recent
    ON observation_sighting (last_seen_at, observation_id);

DROP INDEX IF EXISTS observation_recent_pool_idx;
