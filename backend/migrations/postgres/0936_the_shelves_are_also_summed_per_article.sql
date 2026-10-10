-- The Explorer reads stock beside sales on every open, and the shelf table
-- (0931) is a row per store and SKU — millions on a large estate. Reading it
-- whole answered three things that only need the article: the estate's stock
-- under article-level filters (the strip above the table), every group whose
-- key is the article's (article, division, tag, supplier, PO, store), and the
-- page's own stock. What one piece cost was joined live per row through the
-- article_cost view besides.
--
-- Here the same shelves one level up: a store's article, with its value
-- already summed. Kept by the same refresh that keeps 0931 — it rewrites the
-- rollup in one pass after it has rewritten the shelves, so the two never
-- disagree by more than the refresh's own transaction. The cost is frozen at
-- refresh time, like the quantities; the value follows the layers within the
-- refresh's cadence, not the request's.
CREATE TABLE store_stock_article (
    article_id      uuid   NOT NULL,
    site_id         text   NOT NULL,
    on_hand         bigint NOT NULL DEFAULT 0,
    stock_cost_minor bigint NOT NULL DEFAULT 0,
    PRIMARY KEY (article_id, site_id)
);
CREATE INDEX ix_store_stock_article_site ON store_stock_article (site_id);

CREATE OR REPLACE FUNCTION store_stock_refresh() RETURNS boolean
LANGUAGE plpgsql AS $$
DECLARE
    mark text;
    last record;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('store_stock_refresh'));
    mark := concat_ws('|',
        (SELECT max(fact_sequence) FROM movement),
        (SELECT sum(n_tup_ins + n_tup_upd + n_tup_del) FROM pg_stat_user_tables
          WHERE relname IN ('edge_inventory_fact_position', 'sync_applied_watermark',
                            'sync_origin_credential')));
    SELECT source_mark, refreshed_at INTO last FROM store_stock_refresh;
    IF last.source_mark IS NOT DISTINCT FROM mark
       AND last.refreshed_at > now() - interval '30 minutes' THEN
        RETURN false;
    END IF;

    CREATE TEMP TABLE IF NOT EXISTS store_stock_fresh (
        site_id text, sku_code text, on_hand bigint, PRIMARY KEY (site_id, sku_code)
    ) ON COMMIT DROP;
    TRUNCATE store_stock_fresh;

    INSERT INTO store_stock_fresh (site_id, sku_code, on_hand)
    WITH edge_owned AS (
        SELECT c.origin_id, c.site_id
          FROM sync_origin_credential c
          JOIN sync_applied_watermark w
            ON w.origin_id = c.origin_id AND w.generation = c.active_generation
         WHERE c.inventory_enabled
    ), held AS (
        SELECT op.site_id, k.sku_code, pr.quantity::bigint AS quantity
          FROM inventory_projection pr
          JOIN inventory_place pl ON pl.id = pr.place_id
          JOIN operational_pool op ON op.id = pl.pool_id
          JOIN inventory_subject su ON su.id = pr.subject_id
          JOIN sku k ON k.id = su.sku_id
         WHERE pl.kind = 'OPERATIONAL' AND pl.state = 'NORMAL'
           AND op.site_id NOT IN (SELECT site_id FROM edge_owned)
        UNION ALL
        SELECT e.site_id, fp.sku_code, fp.quantity::bigint
          FROM edge_inventory_fact_position fp
          JOIN edge_owned e ON e.origin_id = fp.origin_id
         WHERE fp.place_id LIKE '%:on_hand'
    )
    SELECT h.site_id, h.sku_code, sum(h.quantity)
      FROM held h
      JOIN site s ON s.id = h.site_id AND s.kind = 'STORE'
     GROUP BY 1, 2
    HAVING sum(h.quantity) <> 0;

    INSERT INTO store_stock_sku (site_id, sku_code, on_hand)
    SELECT site_id, sku_code, on_hand FROM store_stock_fresh
    ON CONFLICT (site_id, sku_code) DO UPDATE SET on_hand = EXCLUDED.on_hand
     WHERE store_stock_sku.on_hand <> EXCLUDED.on_hand;

    DELETE FROM store_stock_sku s
     WHERE NOT EXISTS (SELECT 1 FROM store_stock_fresh f
                        WHERE f.site_id = s.site_id AND f.sku_code = s.sku_code);

    -- The shelves, one level up: an article's pieces and value per store.
    -- Rewritten whole under the same lock and transaction as the shelves, so
    -- a reader sees one consistent pair.
    TRUNCATE store_stock_article;
    INSERT INTO store_stock_article (article_id, site_id, on_hand, stock_cost_minor)
    SELECT k.article_id, x.site_id, sum(x.on_hand)::bigint,
           sum(round(x.on_hand * coalesce(c.unit_cost, 0)))::bigint
      FROM store_stock_sku x
      JOIN sku k ON k.sku_code = x.sku_code
      LEFT JOIN article_cost c ON c.article_id = k.article_id
     WHERE k.article_id IS NOT NULL
     GROUP BY 1, 2;

    UPDATE store_stock_refresh SET source_mark = mark, refreshed_at = now();
    RETURN true;
END
$$;

-- Once, for the shelves that already exist.
INSERT INTO store_stock_article (article_id, site_id, on_hand, stock_cost_minor)
SELECT k.article_id, x.site_id, sum(x.on_hand)::bigint,
       sum(round(x.on_hand * coalesce(c.unit_cost, 0)))::bigint
  FROM store_stock_sku x
  JOIN sku k ON k.sku_code = x.sku_code
  LEFT JOIN article_cost c ON c.article_id = k.article_id
 WHERE k.article_id IS NOT NULL
 GROUP BY 1, 2;
