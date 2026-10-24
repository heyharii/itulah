-- 0084: A till sells what its own stock does not hold.
--
-- Owner, 23 Oct 2026: a piece the till cannot take from its own store's stock
-- still sells ("barang harus bisa dijual"), and the sale belongs to the store
-- where the shopper paid. Head office matches it later to a piece at a store or
-- at HO, and that piece leaves that place's stock. So nothing moves here at the
-- sale: the line is written down, priced, and sent up on the sale fact.
--
-- `kind` is what the till could not do:
--   NO_TAG        SKU typed off the label, and this shop holds one on hand
--   NOT_IN_STOCK  SKU typed off the label, and this shop holds none
--   OTHER         a tag read that this shop does not hold (unknown here, sold
--                 already, elsewhere, on its way)
--   UNKNOWN       no tag and no SKU: the Kepala toko named and priced it
--
-- `id` is minted here and is the line's id at head office too, so a resent
-- fact lands on the same row there.
--
-- `unknown_item_approval` is the Kepala toko's approval of an UNKNOWN line: a
-- name and a price, verified once with a finger or a password when it is
-- given (a finger's grant is single-use and short-lived, and the till quotes
-- every couple of seconds). The sale that rings the line spends it.
--
-- `unmatched_sale_take` is the other half: head office matched a sale (here or
-- at another shop) to a piece THIS shop holds, and the node let it go
-- (`inventory.unmatched_sale.take.v1`). One row per take, whatever came of it.
--
-- `IF NOT EXISTS`: creates only, runs on every open.

CREATE TABLE IF NOT EXISTS unmatched_sale_line (
    id               TEXT PRIMARY KEY,
    sale_id          TEXT NOT NULL REFERENCES sale(id),
    line_no          INTEGER NOT NULL CHECK (line_no >= 0),
    kind             TEXT NOT NULL
                     CHECK (kind IN ('NO_TAG', 'NOT_IN_STOCK', 'OTHER', 'UNKNOWN')),
    sku_code         TEXT,
    epc              TEXT,
    name             TEXT,
    from_place       TEXT,
    unit_price_minor INTEGER NOT NULL CHECK (unit_price_minor >= 0),
    line_total_minor INTEGER NOT NULL CHECK (line_total_minor >= 0),
    net_ex_tax_minor INTEGER,
    tax_minor        INTEGER,
    points_earned    INTEGER,
    price_source     TEXT,
    priced_by        TEXT,
    UNIQUE (sale_id, line_no),
    CHECK (kind = 'UNKNOWN' OR sku_code IS NOT NULL),
    CHECK (kind <> 'UNKNOWN' OR (name IS NOT NULL AND priced_by IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS unmatched_sale_line_by_sale
    ON unmatched_sale_line (sale_id);

CREATE TABLE IF NOT EXISTS unknown_item_approval (
    id               TEXT PRIMARY KEY,
    name             TEXT NOT NULL CHECK (trim(name) <> ''),
    unit_price_minor INTEGER NOT NULL CHECK (unit_price_minor > 0),
    approved_by      TEXT NOT NULL,
    created_at       TEXT NOT NULL,
    used_sale_id     TEXT
);

CREATE TABLE IF NOT EXISTS unmatched_sale_take (
    take_id           TEXT PRIMARY KEY,
    command_id        TEXT NOT NULL,
    sku_code          TEXT NOT NULL,
    epc               TEXT,
    outcome           TEXT NOT NULL CHECK (outcome IN ('TAKEN', 'NOT_HELD')),
    movement_group_id TEXT,
    applied_at        TEXT NOT NULL
);
