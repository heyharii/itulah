-- 0044: A discount on the order, and the right to disagree with the catalogue.
--
-- # The discount is on the order, not the line
--
-- Because that is how it is agreed. A buyer does not negotiate two percent off
-- the socks and two percent off the tights; they negotiate two percent off the
-- order, and a supplier's invoice states it once at the bottom. Spreading it
-- across lines would invent per-line numbers nobody agreed to and would not
-- add back up — 1/3 of 100 three times is 99.99 — so the reconciliation
-- against the invoice would fail on rounding that exists only because we
-- created it.
--
-- Stored as money, not as a rate. The rate is what was said; the money is what
-- is owed, and it is the money an invoice states and a payment matches. A rate
-- kept alongside it would be a second source of truth that can disagree with
-- the first the moment a line changes.
--
-- # Why a line may now disagree with the catalogue
--
-- A sourcing catalogue goes stale. Prices move between the day a buyer picks
-- something out and the day they raise the order, and a system that can only
-- order at yesterday's price forces the buyer to either order wrongly or go
-- and edit the catalogue — which changes what everyone else sees, to fix one
-- order.
--
-- `purchase_order_line` has carried two sets of columns since 0032 for exactly
-- this: `article_name` / `image_url` / `unit_price_minor` are the ORDER's copy,
-- and `supplier_item_*_snapshot` is what the catalogue said at the moment it
-- was raised. Until now the catalogue path wrote the same value into both, so
-- the pair could never differ and the snapshot proved nothing. They may now
-- differ, and when they do the difference is the record of a decision: this is
-- what the catalogue offered, this is what we agreed.
--
-- Nothing flows back. An order edited at the last moment does not touch
-- `supplier_item`; a price agreed for one order is not a new list price, and a
-- name corrected on one order is not a rename.

ALTER TABLE purchase_order
    ADD COLUMN discount_minor bigint NOT NULL DEFAULT 0
        CHECK (discount_minor >= 0);

COMMENT ON COLUMN purchase_order.discount_minor IS
    'Agreed reduction on the whole order, in the order currency''s minor unit. '
    'Not spread across lines: it is negotiated once and invoiced once.';

-- A snapshot that equals the order's own copy is the ordinary case and says
-- "we took the catalogue's word for it". A snapshot that differs is the
-- interesting one, so make it findable without scanning every line.
CREATE INDEX ix_po_line_price_differs_from_catalogue
    ON purchase_order_line (purchase_order_id)
    WHERE supplier_item_id IS NOT NULL;
