-- Post-completion customer returns.
--
-- A return is a one-shot, immutable document: it is created COMPLETED in the
-- same transaction that posts the CUSTOMER_RETURN inventory movements and the
-- refund tender rows, or not at all. Amounts are integer minor units, refunds
-- are recorded per method, and a sale line can be returned at most once
-- (V1: whole-line returns only), enforced by the unique index below.
--
-- Deliberately plain SQL (no plpgsql triggers) to keep a future SQLite edge
-- port cheap; immutability is enforced by the application layer, which never
-- issues UPDATE or DELETE against these tables.

CREATE SEQUENCE sale_return_number_sequence START 1;

CREATE TABLE sale_return (
    id UUID PRIMARY KEY,
    return_number TEXT NOT NULL UNIQUE,
    sale_id UUID NOT NULL REFERENCES sale(id),
    site_id TEXT NOT NULL REFERENCES site(id),
    reason TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 500),
    refund_total_minor BIGINT NOT NULL CHECK (refund_total_minor >= 0),
    movement_group_id UUID NOT NULL REFERENCES movement_group(id),
    actor_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX sale_return_sale_idx ON sale_return(sale_id);
CREATE INDEX sale_return_site_time_idx ON sale_return(site_id, created_at DESC);

CREATE TABLE sale_return_line (
    id UUID PRIMARY KEY,
    return_id UUID NOT NULL REFERENCES sale_return(id),
    sale_line_id UUID NOT NULL REFERENCES sale_line(id),
    subject_id UUID NOT NULL REFERENCES inventory_subject(id),
    sku_id UUID NOT NULL REFERENCES sku(id),
    quantity BIGINT NOT NULL CHECK (quantity > 0),
    refund_minor BIGINT NOT NULL CHECK (refund_minor >= 0),
    -- TRUE: item goes back to the store floor as sellable stock.
    -- FALSE: item is damaged and goes to the store reject pool.
    restock BOOLEAN NOT NULL
);

-- V1: a sold line can be returned exactly once, in full.
CREATE UNIQUE INDEX sale_return_line_once_idx ON sale_return_line(sale_line_id);
CREATE INDEX sale_return_line_return_idx ON sale_return_line(return_id);

CREATE TABLE sale_return_payment (
    id UUID PRIMARY KEY,
    return_id UUID NOT NULL REFERENCES sale_return(id),
    method TEXT NOT NULL CHECK (method IN ('CASH', 'CARD', 'QRIS', 'OTHER')),
    amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
    reference TEXT
);

CREATE INDEX sale_return_payment_return_idx ON sale_return_payment(return_id);
