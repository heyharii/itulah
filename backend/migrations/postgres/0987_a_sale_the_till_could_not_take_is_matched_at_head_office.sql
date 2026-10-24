-- A sale the till could not take from its own store's stock is matched at
-- head office (owner, 23 Oct 2026: "barang harus bisa dijual").
--
-- The shop sells the piece anyway and sends the line up on `sales.completed`
-- (`unmatched`); nothing left its stock. The sale belongs to the store where
-- the shopper paid. Head office later matches the line to one piece of a SKU
-- at a store or at HO, and that piece leaves that place's stock:
--
--   * a place whose ledger the centre keeps — a SALE movement here, to
--     `external/customer`, reference UNMATCHED_SALE / the line's id;
--   * a shop with its own server — `inventory.unmatched_sale.take.v1` to its
--     node, which writes the movement itself (`match_command_id`).
--
-- `id` is the shop's: a resent fact lands on the same row. `match_doc` is
-- `TRF-####` when the piece came from another place than the selling store,
-- `Own stock` when it did not. FOUND (a count turning the piece up) is not
-- written in v1. A new table, nothing else changes.

CREATE TABLE IF NOT EXISTS unmatched_sale_line (
    id                 uuid PRIMARY KEY,
    sale_id            uuid NOT NULL REFERENCES edge_sale (sale_id),
    line_no            integer NOT NULL CHECK (line_no >= 0),
    site_id            text NOT NULL,
    kind               text NOT NULL
                       CHECK (kind IN ('NO_TAG', 'NOT_IN_STOCK', 'OTHER', 'UNKNOWN')),
    sku_code           text,
    epc                text,
    name               text,
    from_place         text,
    unit_price_minor   bigint NOT NULL CHECK (unit_price_minor >= 0),
    line_total_minor   bigint NOT NULL CHECK (line_total_minor >= 0),
    net_ex_tax_minor   bigint,
    tax_minor          bigint,
    points_earned      bigint,
    price_source       text,
    sold_at            timestamptz NOT NULL,
    actor_id           text NOT NULL,
    priced_by          text,
    receipt_no         text,
    till               text,
    status             text NOT NULL DEFAULT 'OPEN'
                       CHECK (status IN ('OPEN', 'MATCHED', 'FOUND')),
    matched_site_id    text,
    matched_sku_code   text,
    matched_epc        text,
    match_doc          text,
    matched_by         text,
    matched_at         timestamptz,
    movement_group_id  uuid,
    match_command_id   uuid,
    received_at        timestamptz NOT NULL DEFAULT now(),
    UNIQUE (sale_id, line_no),
    CHECK (kind = 'UNKNOWN' OR sku_code IS NOT NULL),
    CHECK ((status = 'OPEN') = (matched_at IS NULL))
);

CREATE INDEX IF NOT EXISTS unmatched_sale_line_by_status
    ON unmatched_sale_line (status, sold_at);
CREATE INDEX IF NOT EXISTS unmatched_sale_line_by_site
    ON unmatched_sale_line (site_id, status);

-- The transfer a match from another place makes: TRF-0001, TRF-0002, …
CREATE SEQUENCE IF NOT EXISTS unmatched_sale_transfer_no;
