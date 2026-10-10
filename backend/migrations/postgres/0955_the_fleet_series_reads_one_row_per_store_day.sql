-- The fleet's sales-over-time chart (Sales › Analytics) folded the raw till
-- on every open: a year of series by month read a million receipts and every
-- line under them, grouped them per receipt for pieces, then again per store
-- and bucket — 13 s cold for an answer whose input is really 13 stores × 365
-- days. Everything it asks of a store's day is summed once here instead, per
-- store and business day, from the same raw sales as the store-day counts
-- (0934) and under the same dirty marks: a sale, a void or a late sync makes
-- the day dirty and the same job that sums the other summaries sums this one.
--
--  * sales_series_day  every sale the store reported — completed and voided
--                      alike, at face value, exactly as the fleet chart has
--                      always read them — with its pieces and its net, tax
--                      and total; plus the centre's own completed sales.
--
-- The tenders of a day live on sales_payment_day (0934) and the SKU grain on
-- sales_sku_day (0930); neither is repeated here, because the chart folds
-- neither. A day nobody sold in leaves no row: the empty buckets on the chart
-- are the axis's work, not the summary's.

CREATE TABLE sales_series_day (
    business_date date   NOT NULL,
    site_id       text   NOT NULL,
    sales_count   bigint NOT NULL DEFAULT 0,
    units_sold    bigint NOT NULL DEFAULT 0,
    net_minor     bigint NOT NULL DEFAULT 0,
    tax_minor     bigint NOT NULL DEFAULT 0,
    gross_minor   bigint NOT NULL DEFAULT 0,
    PRIMARY KEY (business_date, site_id)
);

CREATE FUNCTION sales_series_day_refresh(p_day date, p_site text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    DELETE FROM sales_series_day WHERE business_date = p_day AND site_id = p_site;
    INSERT INTO sales_series_day (business_date, site_id, sales_count, units_sold,
                                  net_minor, tax_minor, gross_minor)
    SELECT p_day, p_site,
           sum(sales), sum(units), sum(net), sum(tax), sum(gross)
      FROM (
          -- A store's till, on the day the sale trades for (0714), read at
          -- face value: the chart never split completed from voided, and
          -- until it does, neither does the sum it reads.
          SELECT 1::bigint AS sales,
                 COALESCE(l.units, 0) AS units,
                 COALESCE(e.net_ex_tax_minor, e.total_minor) AS net,
                 COALESCE(e.tax_total_minor, 0) AS tax,
                 e.total_minor AS gross
            FROM edge_sale e
            LEFT JOIN LATERAL (
                SELECT sum(el.quantity) AS units
                  FROM edge_sale_line el WHERE el.sale_id = e.sale_id) l ON true
           WHERE e.business_date = p_day AND e.site_id = p_site
          UNION ALL
          -- The centre's own till, completed only, as the fleet report reads it.
          SELECT 1,
                 COALESCE(l.units, 0), s.net_minor, s.tax_minor, s.total_minor
            FROM sale s
            LEFT JOIN LATERAL (
                SELECT sum(sl.quantity) AS units
                  FROM sale_line sl WHERE sl.sale_id = s.id) l ON true
           WHERE s.site_id = p_site AND s.status = 'COMPLETED'
             AND s.completed_at IS NOT NULL
             AND site_local_date(s.completed_at, s.site_id) = p_day
      ) per_sale
     -- A day nobody sold in leaves no row behind.
     HAVING sum(sales) > 0;
END
$$;

-- Everything already sold, once, set-based — the same fold the chart was
-- about to do on its next request, done one last time here.
INSERT INTO sales_series_day (business_date, site_id, sales_count, units_sold,
                              net_minor, tax_minor, gross_minor)
SELECT day, site_id, sum(sales), sum(units), sum(net), sum(tax), sum(gross)
  FROM (
      SELECT e.business_date AS day, e.site_id,
             1::bigint AS sales,
             COALESCE(l.units, 0) AS units,
             COALESCE(e.net_ex_tax_minor, e.total_minor) AS net,
             COALESCE(e.tax_total_minor, 0) AS tax,
             e.total_minor AS gross
        FROM edge_sale e
        LEFT JOIN (
            SELECT sale_id, sum(quantity) AS units
              FROM edge_sale_line GROUP BY sale_id) l ON l.sale_id = e.sale_id
       WHERE e.business_date IS NOT NULL
      UNION ALL
      SELECT site_local_date(s.completed_at, s.site_id), s.site_id,
             1, COALESCE(l.units, 0), s.net_minor, s.tax_minor, s.total_minor
        FROM sale s
        LEFT JOIN (
            SELECT sale_id, sum(quantity) AS units
              FROM sale_line GROUP BY sale_id) l ON l.sale_id = s.id
       WHERE s.status = 'COMPLETED' AND s.completed_at IS NOT NULL
  ) per_sale
 GROUP BY day, site_id;
