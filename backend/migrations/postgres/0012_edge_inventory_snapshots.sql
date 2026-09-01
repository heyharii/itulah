-- Owner-bound inventory snapshot read model for independently operated
-- SQLite DC/Store edges. This state is deliberately separate from the Cloud
-- movement ledger: snapshots are current owner observations, not movements.

ALTER TABLE sync_origin_credential
    ADD COLUMN site_id text,
    ADD COLUMN node_role text,
    ADD COLUMN active_generation bigint NOT NULL DEFAULT 1,
    ADD COLUMN inventory_enabled boolean NOT NULL DEFAULT false,
    ADD CONSTRAINT sync_origin_active_generation_positive
        CHECK (active_generation >= 1),
    ADD CONSTRAINT sync_origin_inventory_binding_complete
        CHECK (
            NOT inventory_enabled
            OR (site_id IS NOT NULL AND node_role IN ('DC', 'STORE'))
        );

CREATE UNIQUE INDEX sync_origin_one_inventory_owner_per_site
    ON sync_origin_credential (site_id)
    WHERE inventory_enabled;

CREATE TABLE edge_inventory_snapshot (
    origin_id     text PRIMARY KEY REFERENCES sync_origin_credential(origin_id) ON DELETE CASCADE,
    site_id       text NOT NULL,
    node_role     text NOT NULL CHECK (node_role IN ('DC', 'STORE')),
    generation    bigint NOT NULL CHECK (generation >= 1),
    seq           bigint NOT NULL CHECK (seq >= 1),
    event_id      uuid NOT NULL,
    captured_at   timestamptz NOT NULL,
    applied_at    timestamptz NOT NULL DEFAULT now(),
    UNIQUE (origin_id, generation, seq),
    UNIQUE (event_id)
);

CREATE TABLE edge_inventory_pool (
    origin_id  text NOT NULL REFERENCES edge_inventory_snapshot(origin_id) ON DELETE CASCADE,
    pool_id    text NOT NULL,
    stock      bigint NOT NULL CHECK (stock >= 0),
    allotted   bigint CHECK (allotted >= 0),
    on_hand    bigint NOT NULL CHECK (on_hand >= 0),
    missing    bigint NOT NULL CHECK (missing >= 0),
    PRIMARY KEY (origin_id, pool_id),
    CHECK (stock = on_hand + COALESCE(allotted, 0) + missing)
);

CREATE INDEX edge_inventory_snapshot_site
    ON edge_inventory_snapshot (site_id, node_role);
