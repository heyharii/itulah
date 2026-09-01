-- Movement history received from inventory-owning Edge nodes. It remains
-- separate from Cloud's native movement ledger and feeds disposable current
-- state projections.
CREATE TABLE edge_movement (
    origin_id text NOT NULL REFERENCES sync_origin_credential(origin_id),
    generation bigint NOT NULL,
    seq bigint NOT NULL,
    event_id uuid NOT NULL UNIQUE,
    movement_group_id uuid NOT NULL,
    cause text NOT NULL,
    reason text NOT NULL,
    reference_type text,
    reference_id text,
    actor_id text NOT NULL,
    occurred_at timestamptz NOT NULL,
    received_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (movement_group_id),
    UNIQUE (origin_id,generation,seq),
    CHECK (event_id = movement_group_id)
);
CREATE INDEX ix_edge_movement_origin ON edge_movement(origin_id,generation,seq);
CREATE INDEX ix_edge_movement_cause ON edge_movement(cause,occurred_at DESC);

CREATE TABLE edge_movement_line (
    movement_group_id uuid NOT NULL REFERENCES edge_movement(movement_group_id) ON DELETE CASCADE,
    subject_id uuid NOT NULL,
    epc text,
    sku_code text,
    quantity bigint NOT NULL CHECK (quantity > 0),
    from_place_id text NOT NULL,
    to_place_id text NOT NULL,
    PRIMARY KEY (movement_group_id,subject_id,from_place_id,to_place_id)
);
CREATE INDEX ix_edge_movement_line_epc ON edge_movement_line(epc) WHERE epc IS NOT NULL;
CREATE INDEX ix_edge_movement_line_to ON edge_movement_line(to_place_id);
CREATE INDEX ix_edge_movement_line_from ON edge_movement_line(from_place_id);

-- Subject identity survives movement out of operational positions. Incoming
-- facts may fill an unknown legacy identity once, but can never relabel it.
CREATE TABLE edge_inventory_fact_subject_identity (
    origin_id text NOT NULL REFERENCES sync_origin_credential(origin_id),
    subject_id uuid NOT NULL,
    epc text,
    sku_code text,
    first_generation bigint NOT NULL CHECK (first_generation >= 1),
    first_seq bigint NOT NULL CHECK (first_seq >= 1),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (origin_id,subject_id),
    CHECK (epc IS NULL OR (btrim(epc) <> '' AND epc = upper(btrim(epc)))),
    CHECK (sku_code IS NULL OR (btrim(sku_code) <> '' AND sku_code = upper(btrim(sku_code))))
);
CREATE UNIQUE INDEX edge_inventory_fact_subject_epc
    ON edge_inventory_fact_subject_identity(origin_id,epc) WHERE epc IS NOT NULL;

-- Fact-authoritative current position. This is disposable and can be rebuilt
-- from edge_movement + edge_movement_line; snapshots never overwrite it.
CREATE TABLE edge_inventory_fact_position (
    origin_id text NOT NULL REFERENCES sync_origin_credential(origin_id),
    subject_id uuid NOT NULL,
    place_id text NOT NULL,
    epc text,
    sku_code text,
    quantity bigint NOT NULL CHECK (quantity > 0),
    last_generation bigint NOT NULL CHECK (last_generation >= 1),
    last_seq bigint NOT NULL CHECK (last_seq >= 1),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (origin_id,subject_id,place_id),
    FOREIGN KEY (origin_id,subject_id)
        REFERENCES edge_inventory_fact_subject_identity(origin_id,subject_id),
    CHECK (epc IS NULL OR quantity = 1)
);
CREATE INDEX edge_inventory_fact_position_place
    ON edge_inventory_fact_position(origin_id,place_id);
CREATE UNIQUE INDEX edge_inventory_fact_position_epc
    ON edge_inventory_fact_position(origin_id,epc) WHERE epc IS NOT NULL;

COMMENT ON TABLE edge_movement IS 'Immutable Edge-authored movement history, separate from the Cloud native inventory ledger.';
COMMENT ON TABLE edge_inventory_fact_position IS 'Disposable current Edge position derived only from immutable Edge movement facts; snapshots are reconciliation checkpoints.';
