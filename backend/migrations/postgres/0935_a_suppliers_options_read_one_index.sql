-- The Explorer's supplier places read their orders twice on every call: the
-- filter picker lists every supplier as DISTINCT ON over all purchase orders
-- (sales_explorer_options), and each supplier row's label reads that
-- supplier's newest order (sales_explorer.rs, ExplorerGroup::Supplier). Both
-- sort the whole table. One index answers both, newest first.
CREATE INDEX ix_purchase_order_supplier_created
    ON purchase_order (supplier_id, created_at DESC);
