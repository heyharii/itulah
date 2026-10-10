-- A year of the store-day summary (0930) is two million rows on a busy estate,
-- and a screen that groups a year by article read every one of them. The
-- same figures one level up — a store's month per article, under the division
-- and tags as sold — are a third of that, and answer every question that does
-- not need the SKU (article, division, tag, supplier, PO, store, month) over
-- whole months. Days at either end of a window still come from 0930.
--
-- Not a materialized view either: the job that sums a store's day sums its
-- month again from that day's summary, so the two never disagree; the nightly
-- check compares them as well.
-- Profit is only known for pieces that have a cost. What the uncosted pieces
-- fetched is kept beside their count, so gross profit and margin are read over
-- the costed pieces alone instead of counting the uncosted ones at zero cost
-- (which read as a 100 % margin). Every store day with uncosted pieces is summed
-- again to fill it.
ALTER TABLE sales_sku_day ADD COLUMN uncosted_minor bigint NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION sales_rollup_refresh(p_day date, p_site text) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
    written integer;
BEGIN
    -- One writer per store day, whoever asks.
    PERFORM pg_advisory_xact_lock(hashtext('sales_rollup'), hashtext(p_day::text || '|' || p_site));

    -- Freeze the cost of every line of the day that has none yet and whose
    -- article now has one. Lines already costed keep their cost.
    INSERT INTO sale_line_cost (origin, sale_id, subject_id, cost_minor)
    SELECT 'edge', l.sale_id, l.subject_id, round(l.quantity * c.unit)::bigint
      FROM edge_sale e
      JOIN edge_sale_line l ON l.sale_id = e.sale_id
      JOIN sku k ON k.sku_code = l.sku_code
      CROSS JOIN LATERAL (SELECT article_unit_cost(k.article_id) AS unit) c
     WHERE e.business_date = p_day AND e.site_id = p_site
       AND NOT EXISTS (SELECT 1 FROM sale_line_cost x
                        WHERE x.origin = 'edge' AND x.sale_id = l.sale_id
                          AND x.subject_id = l.subject_id)
       AND c.unit IS NOT NULL
    ON CONFLICT DO NOTHING;

    INSERT INTO sale_line_cost (origin, sale_id, subject_id, cost_minor)
    SELECT 'centre', sl.sale_id, sl.subject_id, round(sl.quantity * c.unit)::bigint
      FROM sale_line sl
      JOIN sku k ON k.id = sl.sku_id
      CROSS JOIN LATERAL (SELECT article_unit_cost(k.article_id) AS unit) c
     WHERE sl.sale_id IN (
               SELECT s.id FROM sale s
                WHERE s.site_id = p_site AND s.completed_at IS NOT NULL
                  AND site_local_date(s.completed_at, s.site_id) = p_day
               UNION
               -- a sale returned today whose own day was never summed
               SELECT r.sale_id FROM sale_return r
                WHERE r.site_id = p_site
                  AND site_local_date(r.created_at, r.site_id) = p_day)
       AND NOT EXISTS (SELECT 1 FROM sale_line_cost x
                        WHERE x.origin = 'centre' AND x.sale_id = sl.sale_id
                          AND x.subject_id = sl.subject_id)
       AND c.unit IS NOT NULL
    ON CONFLICT DO NOTHING;

    DELETE FROM sales_sku_day WHERE business_date = p_day AND site_id = p_site;

    WITH lines AS (
        -- A shop's till, on the day its shift says (0714).
        SELECT e.occurred_at AS at, COALESCE(l.sku_code, '') AS sku_code,
               l.quantity AS qty,
               l.quantity * COALESCE(l.base_unit_price_minor, l.unit_price_minor) AS list_minor,
               l.quantity * l.unit_price_minor AS gross_minor,
               COALESCE(l.line_total_minor, l.quantity * l.unit_price_minor) AS net_minor,
               COALESCE(l.tax_minor, 0) AS tax_minor,
               lc.cost_minor, 0::bigint AS ret_qty, 0::bigint AS refund_minor
          FROM edge_sale e
          JOIN edge_sale_line l ON l.sale_id = e.sale_id
          LEFT JOIN sale_line_cost lc
                 ON lc.origin = 'edge' AND lc.sale_id = l.sale_id AND lc.subject_id = l.subject_id
         WHERE e.business_date = p_day AND e.site_id = p_site AND e.status = 'COMPLETED'
        UNION ALL
        -- The centre's own till, which keeps no list price apart from what
        -- it charged.
        SELECT s.completed_at, k.sku_code, sl.quantity,
               sl.total_minor, sl.total_minor, sl.total_minor, sl.tax_minor,
               lc.cost_minor, 0, 0
          FROM sale s
          JOIN sale_line sl ON sl.sale_id = s.id
          JOIN sku k ON k.id = sl.sku_id
          LEFT JOIN sale_line_cost lc
                 ON lc.origin = 'centre' AND lc.sale_id = sl.sale_id AND lc.subject_id = sl.subject_id
         WHERE s.site_id = p_site AND s.status = 'COMPLETED' AND s.completed_at IS NOT NULL
           AND site_local_date(s.completed_at, s.site_id) = p_day
        UNION ALL
        -- Returns, on the day they came back; a restocked piece puts its
        -- original cost back.
        SELECT r.created_at, k.sku_code, 0, 0, 0, 0, 0,
               CASE WHEN rl.restock AND lc.cost_minor IS NOT NULL AND sl.quantity > 0
                    THEN -round(lc.cost_minor::numeric * rl.quantity / sl.quantity)::bigint
                    ELSE 0 END,
               rl.quantity, rl.refund_minor
          FROM sale_return r
          JOIN sale_return_line rl ON rl.return_id = r.id
          JOIN sku k ON k.id = rl.sku_id
          LEFT JOIN sale_line sl ON sl.id = rl.sale_line_id
          LEFT JOIN sale_line_cost lc
                 ON lc.origin = 'centre' AND lc.sale_id = sl.sale_id AND lc.subject_id = sl.subject_id
         WHERE r.site_id = p_site AND site_local_date(r.created_at, r.site_id) = p_day
    ), attributed AS (
        SELECT x.*, k.article_id,
               COALESCE((SELECT dp.division_code FROM article_division_period dp
                          WHERE dp.article_id = k.article_id
                            AND dp.valid_from <= x.at
                            AND (dp.valid_to IS NULL OR x.at < dp.valid_to)
                          ORDER BY dp.valid_from DESC LIMIT 1), '') AS division_code,
               COALESCE((SELECT array_agg(DISTINCT tp.tag_code ORDER BY tp.tag_code)
                           FROM article_tag_period tp
                          WHERE tp.article_id = k.article_id
                            AND tp.valid_from <= x.at
                            AND (tp.valid_to IS NULL OR x.at < tp.valid_to)), '{}') AS tag_codes
          FROM lines x
          LEFT JOIN sku k ON k.sku_code = x.sku_code
    )
    INSERT INTO sales_sku_day (
        business_date, site_id, sku_code, article_id, division_code, tag_codes,
        sold_qty, full_qty, full_minor, discounted_qty, discounted_minor,
        list_minor, gross_minor, net_minor, tax_minor,
        returned_qty, refund_minor, cost_minor, uncosted_qty, uncosted_minor)
    SELECT p_day, p_site, sku_code, max(article_id::text)::uuid, division_code, tag_codes,
           COALESCE(sum(qty), 0),
           COALESCE(sum(qty) FILTER (WHERE qty > 0 AND net_minor >= list_minor), 0),
           COALESCE(sum(net_minor) FILTER (WHERE qty > 0 AND net_minor >= list_minor), 0),
           COALESCE(sum(qty) FILTER (WHERE qty > 0 AND net_minor < list_minor), 0),
           COALESCE(sum(net_minor) FILTER (WHERE qty > 0 AND net_minor < list_minor), 0),
           COALESCE(sum(list_minor), 0),
           COALESCE(sum(gross_minor), 0),
           COALESCE(sum(net_minor), 0),
           COALESCE(sum(tax_minor), 0),
           COALESCE(sum(ret_qty), 0),
           COALESCE(sum(refund_minor), 0),
           COALESCE(sum(cost_minor), 0),
           COALESCE(sum(qty) FILTER (WHERE qty > 0 AND cost_minor IS NULL), 0),
           COALESCE(sum(net_minor) FILTER (WHERE qty > 0 AND cost_minor IS NULL), 0)
      FROM attributed
     GROUP BY sku_code, division_code, tag_codes;
    GET DIAGNOSTICS written = ROW_COUNT;
    RETURN written;
END
$$;


INSERT INTO sales_rollup_dirty (business_date, site_id)
SELECT DISTINCT business_date, site_id FROM sales_sku_day WHERE uncosted_qty > 0
ON CONFLICT (business_date, site_id)
    DO UPDATE SET mark = nextval('sales_rollup_mark_seq'), marked_at = now();

CREATE TABLE sales_article_month (
    month            date   NOT NULL CHECK (month = date_trunc('month', month)::date),
    site_id          text   NOT NULL,
    article_id       uuid,
    division_code    text   NOT NULL DEFAULT '',
    tag_codes        text[] NOT NULL DEFAULT '{}',
    sold_qty         bigint NOT NULL DEFAULT 0,
    full_qty         bigint NOT NULL DEFAULT 0,
    full_minor       bigint NOT NULL DEFAULT 0,
    discounted_qty   bigint NOT NULL DEFAULT 0,
    discounted_minor bigint NOT NULL DEFAULT 0,
    list_minor       bigint NOT NULL DEFAULT 0,
    gross_minor      bigint NOT NULL DEFAULT 0,
    net_minor        bigint NOT NULL DEFAULT 0,
    tax_minor        bigint NOT NULL DEFAULT 0,
    returned_qty     bigint NOT NULL DEFAULT 0,
    refund_minor     bigint NOT NULL DEFAULT 0,
    cost_minor       bigint NOT NULL DEFAULT 0,
    uncosted_qty     bigint NOT NULL DEFAULT 0,
    uncosted_minor   bigint NOT NULL DEFAULT 0
);
CREATE INDEX ix_sales_article_month_slice ON sales_article_month (month, site_id);
CREATE INDEX ix_sales_article_month_article ON sales_article_month (article_id, month);

-- One store's month, again, from its days.
CREATE FUNCTION sales_month_refresh(p_month date, p_site text) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
    written integer;
    first_day date := date_trunc('month', p_month)::date;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('sales_month'), hashtext(first_day::text || '|' || p_site));
    DELETE FROM sales_article_month WHERE month = first_day AND site_id = p_site;
    INSERT INTO sales_article_month (
        month, site_id, article_id, division_code, tag_codes,
        sold_qty, full_qty, full_minor, discounted_qty, discounted_minor,
        list_minor, gross_minor, net_minor, tax_minor,
        returned_qty, refund_minor, cost_minor, uncosted_qty, uncosted_minor)
    SELECT first_day, site_id, article_id, division_code, tag_codes,
           sum(sold_qty), sum(full_qty), sum(full_minor), sum(discounted_qty),
           sum(discounted_minor), sum(list_minor), sum(gross_minor), sum(net_minor),
           sum(tax_minor), sum(returned_qty), sum(refund_minor), sum(cost_minor),
           sum(uncosted_qty), sum(uncosted_minor)
      FROM sales_sku_day
     WHERE business_date >= first_day
       AND business_date < (first_day + interval '1 month')::date
       AND site_id = p_site
     GROUP BY site_id, article_id, division_code, tag_codes;
    GET DIAGNOSTICS written = ROW_COUNT;
    RETURN written;
END
$$;

-- Everything summed so far, once.
INSERT INTO sales_article_month (
    month, site_id, article_id, division_code, tag_codes,
    sold_qty, full_qty, full_minor, discounted_qty, discounted_minor,
    list_minor, gross_minor, net_minor, tax_minor,
    returned_qty, refund_minor, cost_minor, uncosted_qty, uncosted_minor)
SELECT date_trunc('month', business_date)::date, site_id, article_id, division_code, tag_codes,
       sum(sold_qty), sum(full_qty), sum(full_minor), sum(discounted_qty),
       sum(discounted_minor), sum(list_minor), sum(gross_minor), sum(net_minor),
       sum(tax_minor), sum(returned_qty), sum(refund_minor), sum(cost_minor),
       sum(uncosted_qty), sum(uncosted_minor)
  FROM sales_sku_day
 GROUP BY 1, 2, 3, 4, 5;

-- The months the nightly check finds out of step with their days.
CREATE FUNCTION sales_month_drift(p_from date, p_to date)
RETURNS TABLE (month date, site_id text, day_qty bigint, day_net bigint,
               month_qty bigint, month_net bigint)
LANGUAGE sql STABLE AS $$
    WITH d AS (
        SELECT date_trunc('month', business_date)::date AS month, site_id,
               sum(sold_qty)::bigint AS qty, sum(net_minor)::bigint AS net
          FROM sales_sku_day
         WHERE business_date >= date_trunc('month', p_from)::date
           AND business_date < (date_trunc('month', p_to) + interval '1 month')::date
         GROUP BY 1, 2
    ), m AS (
        SELECT month, site_id, sum(sold_qty)::bigint AS qty, sum(net_minor)::bigint AS net
          FROM sales_article_month
         WHERE month BETWEEN date_trunc('month', p_from)::date AND date_trunc('month', p_to)::date
         GROUP BY 1, 2
    )
    SELECT COALESCE(d.month, m.month), COALESCE(d.site_id, m.site_id),
           COALESCE(d.qty, 0), COALESCE(d.net, 0), COALESCE(m.qty, 0), COALESCE(m.net, 0)
      FROM d FULL JOIN m ON m.month = d.month AND m.site_id = d.site_id
     WHERE COALESCE(d.qty, 0) <> COALESCE(m.qty, 0) OR COALESCE(d.net, 0) <> COALESCE(m.net, 0)
$$;
