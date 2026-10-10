-- The SKU, colour and size groupings still read a year off the day summary:
-- two million rows for questions whose answer is a third of that one level
-- up. The same figures per store month and SKU answer them, exactly as 0932
-- answers the article's; colour and size never leave a SKU, so the SKU grain
-- carries them. Days at either end of a window still come from the day
-- summary.
--
-- Shares sales_month_dirty with the article summary: whatever re-sums a
-- store's day re-sums its month on both levels (sales_rollup.rs,
-- refresh_months), so day, article-month and SKU-month never disagree. The
-- nightly reconcile keeps comparing the days with the article months; the
-- SKU months are refreshed in the same pass whenever a month is marked.
CREATE TABLE sales_sku_month (
    month            date   NOT NULL CHECK (month = date_trunc('month', month)::date),
    site_id          text   NOT NULL,
    sku_code         text   NOT NULL,
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
    uncosted_minor   bigint NOT NULL DEFAULT 0,
    PRIMARY KEY (month, site_id, sku_code, division_code, tag_codes)
);
CREATE INDEX ix_sales_sku_month_slice ON sales_sku_month (month, site_id);

-- One store's month, again, from its days.
CREATE FUNCTION sales_sku_month_refresh(p_month date, p_site text) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
    written integer;
    first_day date := date_trunc('month', p_month)::date;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('sales_sku_month'), hashtext(first_day::text || '|' || p_site));
    DELETE FROM sales_sku_month WHERE month = first_day AND site_id = p_site;
    INSERT INTO sales_sku_month (
        month, site_id, sku_code, article_id, division_code, tag_codes,
        sold_qty, full_qty, full_minor, discounted_qty, discounted_minor,
        list_minor, gross_minor, net_minor, tax_minor,
        returned_qty, refund_minor, cost_minor, uncosted_qty, uncosted_minor)
    SELECT first_day, site_id, sku_code, article_id, division_code, tag_codes,
           sum(sold_qty), sum(full_qty), sum(full_minor), sum(discounted_qty),
           sum(discounted_minor), sum(list_minor), sum(gross_minor), sum(net_minor),
           sum(tax_minor), sum(returned_qty), sum(refund_minor), sum(cost_minor),
           sum(uncosted_qty), sum(uncosted_minor)
      FROM sales_sku_day
     WHERE business_date >= first_day
       AND business_date < (first_day + interval '1 month')::date
       AND site_id = p_site
     GROUP BY site_id, sku_code, article_id, division_code, tag_codes;
    GET DIAGNOSTICS written = ROW_COUNT;
    RETURN written;
END
$$;

-- Everything summed so far, once.
INSERT INTO sales_sku_month (
    month, site_id, sku_code, article_id, division_code, tag_codes,
    sold_qty, full_qty, full_minor, discounted_qty, discounted_minor,
    list_minor, gross_minor, net_minor, tax_minor,
    returned_qty, refund_minor, cost_minor, uncosted_qty, uncosted_minor)
SELECT date_trunc('month', business_date)::date, site_id, sku_code, article_id,
       division_code, tag_codes,
       sum(sold_qty), sum(full_qty), sum(full_minor), sum(discounted_qty),
       sum(discounted_minor), sum(list_minor), sum(gross_minor), sum(net_minor),
       sum(tax_minor), sum(returned_qty), sum(refund_minor), sum(cost_minor),
       sum(uncosted_qty), sum(uncosted_minor)
  FROM sales_sku_day
 GROUP BY 1, 2, 3, 4, 5, 6;
