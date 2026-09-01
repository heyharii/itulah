-- Forward-only additions for authoritative Official Count execution.
-- SqliteEdge checks the sentinel columns before executing this migration,
-- because migrations are embedded and replayed whenever a database is opened.

ALTER TABLE dc_official_count_adjustment
    ADD COLUMN movement_group_ids_json TEXT NOT NULL DEFAULT '[]'
        CHECK (json_valid(movement_group_ids_json)
               AND json_type(movement_group_ids_json) = 'array');

-- A newly discovered gain EPC must use centre-authored SKU pricing. Legacy
-- catalogue rows remain readable, but cannot create gain subjects until a
-- newer catalogue publication supplies this value.
ALTER TABLE catalog_item
    ADD COLUMN base_price_minor INTEGER
        CHECK (base_price_minor IS NULL OR base_price_minor >= 0);
