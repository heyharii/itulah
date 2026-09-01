-- 0015: A price the shop floor can actually match to a product.
--
-- `commercial_price_rule` arrived keyed by `sku_id`, the centre's UUID. Every
-- other thing in this database names a product by its `sku_code`: the
-- catalogue is keyed by it, a scanned tag decodes to it, a sale line records
-- it. So the prices landed, were stored faithfully, and were unusable — there
-- was no column to join them on, and the till went on charging the price
-- stamped on each unit when it was received.
--
-- The code arrives alongside the id from now on. The id stays: it is what the
-- centre calls the row, and reporting a fact back up needs it.
--
-- Rules already resident predate the code and cannot be given one — the edge
-- holds no map from one to the other, and inventing a join here would be a
-- guess wearing the clothes of a repair. They keep a NULL and are ignored by
-- the pricing lookup, which is the honest outcome: the next publication
-- carries codes, and until it lands the till prices exactly as it did before.

ALTER TABLE commercial_price_rule ADD COLUMN sku_code TEXT;

CREATE INDEX IF NOT EXISTS ix_price_rule_sku_code
    ON commercial_price_rule (sku_code, channel)
    WHERE sku_code IS NOT NULL;

-- A sale line records which authority set its price.
--
-- Without this the centre sees an amount and cannot tell whether it came from
-- the published price book, from a branch override, or from the price stamped
-- on the unit at intake — and those are three different answers to "was this
-- sold correctly". `publication_version` names the exact price book, so a
-- disputed receipt can be traced to the document that governed it.
--
-- Both are NULL for lines already recorded, which is honest: those sales
-- happened before anything tracked this and no value could be supplied without
-- inventing one.
ALTER TABLE sale_line ADD COLUMN price_source TEXT;
ALTER TABLE sale_line ADD COLUMN publication_version INTEGER;
