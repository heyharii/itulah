-- A piece the destination did not find when it counted a delivery in is
-- Missing at the origin (0718): every shortage is Missing (owner, 1 Oct 2026).
-- One row per piece told, so it is told once; the origin books it from its
-- in-transit pool to that pool's `:missing` on `inventory.in_transit.short.v1`.

CREATE TABLE edge_transit_short (
    in_transit_event_id uuid PRIMARY KEY REFERENCES edge_transfer_claim (event_id),
    origin_id           text NOT NULL,
    receipt_event_id    uuid NOT NULL REFERENCES edge_goods_step (event_id),
    epc                 text NOT NULL,
    command_id          uuid NOT NULL,
    issued_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_edge_transit_short_origin ON edge_transit_short (origin_id, issued_at);

COMMENT ON TABLE edge_transit_short IS
    'Pieces a destination did not find at its door, told to their origin to book Missing (0718).';
