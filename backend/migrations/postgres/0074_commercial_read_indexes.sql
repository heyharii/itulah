-- 0074: The two lookups every priced basket makes, indexed.
--
-- Pricing anything reads the published price book: `commercial_price_rule`
-- joined to `commercial_publication`, filtered by status, by channel, and by
-- the shop. The existing unique index leads on `publication_id`, which is the
-- wrong end — nothing asks for one publication's prices on that path, it asks
-- for every publication's prices for one channel at one shop.
--
-- Both are partial. Only PUBLISHED publications are ever read for pricing, and
-- indexing the drafts would be indexing rows the query never reaches.

CREATE INDEX IF NOT EXISTS ix_publication_live
    ON commercial_publication (effective_from, effective_to)
    WHERE status = 'PUBLISHED';

-- Channel first: it is the equality the query always has, where the site is a
-- three-way test the planner cannot use an index for.
CREATE INDEX IF NOT EXISTS ix_price_rule_channel_site
    ON commercial_price_rule (channel, site_id);

-- The assortment join is by (publication, sku, channel) and lands on a table
-- whose only index leads on publication_id — fine for the join itself, but the
-- catalogue read walks it per SKU.
CREATE INDEX IF NOT EXISTS ix_assortment_sku_channel
    ON commercial_assortment_rule (sku_id, channel);
