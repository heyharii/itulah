-- The Sales screen puts what each store still holds beside what it sold. Read
-- live, that is every piece on the shelves joined to its place, pool and SKU —
-- two seconds for two million pieces, on every open. Kept here per store and
-- SKU instead, refreshed by a job when the ledger has moved, the same reading
-- the breakdowns use (a shop whose node reports owns its own figures; the
-- centre's ledger answers for the rest; NORMAL places only).
CREATE TABLE store_stock_sku (
    site_id  text   NOT NULL,
    sku_code text   NOT NULL,
    on_hand  bigint NOT NULL,
    PRIMARY KEY (site_id, sku_code)
);
CREATE INDEX ix_store_stock_sku_sku ON store_stock_sku (sku_code);

CREATE TABLE store_stock_refresh (
    singleton    boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    source_mark  text,
    refreshed_at timestamptz
);
INSERT INTO store_stock_refresh (singleton) VALUES (true);

-- Rewrites only the rows that changed. Returns false when nothing had moved
-- since the last refresh (and it is not half an hour old).
CREATE FUNCTION store_stock_refresh() RETURNS boolean
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

    UPDATE store_stock_refresh SET source_mark = mark, refreshed_at = now();
    RETURN true;
END
$$;

-- What one piece of each article cost (the same reading as
-- `article_unit_cost`, 0930), for the stock's value: one pass over the layers
-- instead of a call per row.
CREATE VIEW article_cost AS
SELECT l.article_id,
       sum(l.opening_cost_minor + COALESCE(adj.total, 0))::numeric
           / NULLIF(sum(l.quantity), 0) AS unit_cost
  FROM cost_layer l
  LEFT JOIN (
      SELECT a.layer_id, sum(a.amount_minor) AS total
        FROM cost_layer_adjustment a
        JOIN cost_component_type t ON t.component_type = a.component_type
       WHERE a.superseded_by IS NULL AND NOT t.is_opening
       GROUP BY a.layer_id
  ) adj ON adj.layer_id = l.layer_id
 GROUP BY l.article_id;
