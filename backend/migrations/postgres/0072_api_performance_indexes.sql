-- Bounded API pages and fleet summaries must be able to seek rather than scan.
-- These indexes mirror the predicates used by the current read paths; they do
-- not change inventory truth or introduce a second projection.

CREATE INDEX IF NOT EXISTS ix_movement_to_place_occurred
    ON movement (to_place_id, occurred_at);

CREATE INDEX IF NOT EXISTS ix_movement_from_place_occurred
    ON movement (from_place_id, occurred_at);

CREATE INDEX IF NOT EXISTS ix_observation_pool_last_seen
    ON observation_sighting (pool_id, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS ix_supplier_item_supplier_cursor
    ON supplier_item (supplier_id, supplier_item_id);
