-- 0384: The marketing reads find their rows by index.
--
-- Four lookups the Marketing screens make on every open, each of which walked
-- a whole table because nothing was keyed the way it asks:
--
--   * a product's live company price (`commercial_products`, once per row of a
--     picker that returns up to five hundred) and a price book narrowed to one
--     page of products look price rules up by SKU. The only index that starts
--     anywhere near was `(channel, site_id)`, so each lookup read every
--     company-level STORE price in every book ever published;
--   * a campaign's rules (`rules_in_books`, and the sell-through read) are
--     found by the `campaign_id` inside the rule document. Migration 0031 keeps
--     rules as the engine's own documents, and this is the one field of them the
--     console filters on;
--   * stock on hand per SKU for a style (pricelist performance, sell-through)
--     joins `inventory_subject` on `sku_id`. That table is one row per tag, so
--     it is the largest table these reads touch;
--   * the voucher ledger's default order — newest first, across every status —
--     had only `(status, issued_at)`, which serves a status filter and not the
--     list as it first opens.

CREATE INDEX IF NOT EXISTS ix_price_rule_sku_channel
    ON commercial_price_rule (sku_id, channel)
    INCLUDE (publication_id, site_id, unit_price_minor);

CREATE INDEX IF NOT EXISTS ix_rule_campaign
    ON commercial_rule ((definition ->> 'campaign_id'))
    WHERE definition ->> 'campaign_id' IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_inventory_subject_sku
    ON inventory_subject (sku_id);

CREATE INDEX IF NOT EXISTS ix_voucher_issued
    ON voucher (issued_at DESC, voucher_id DESC);
