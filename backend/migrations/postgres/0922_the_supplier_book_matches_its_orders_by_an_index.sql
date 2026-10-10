-- The supplier book's standing summary matches every legacy order to its
-- supplier by code — `PURCHASE_ORDER_STANDING`'s correlated
-- `WHERE x.supplier_code = o.supplier_id`. Only `supplier_code_normalized`
-- carries a unique index, and 0820's trigram serves pattern search, not
-- equality; so every legacy order scanned the whole supplier book, and the
-- summary runs on every heavy supplier list read.
CREATE INDEX IF NOT EXISTS ix_supplier_code ON supplier (supplier_code);
