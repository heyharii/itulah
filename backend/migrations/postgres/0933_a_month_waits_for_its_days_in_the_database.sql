-- The month summary (0932) is summed again after its days; which months are
-- due was remembered only by the job while it ran, so a server that stopped
-- between summing the days and summing their month left the month behind.
-- The mark now lives beside the day marks: every write to a store's day in
-- `sales_sku_day` marks its month, in the same transaction, and the job
-- clears a month only once it has summed it.
CREATE TABLE sales_month_dirty (
    month     date        NOT NULL CHECK (month = date_trunc('month', month)::date),
    site_id   text        NOT NULL,
    mark      bigint      NOT NULL DEFAULT nextval('sales_rollup_mark_seq'),
    marked_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (month, site_id)
);

CREATE FUNCTION sales_month_mark() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO sales_month_dirty (month, site_id)
    SELECT DISTINCT date_trunc('month', business_date)::date, site_id FROM changed
    ON CONFLICT (month, site_id)
        DO UPDATE SET mark = nextval('sales_rollup_mark_seq'), marked_at = now();
    RETURN NULL;
END
$$;
CREATE TRIGGER sales_sku_day_marks_month_insert
    AFTER INSERT ON sales_sku_day REFERENCING NEW TABLE AS changed
    FOR EACH STATEMENT EXECUTE FUNCTION sales_month_mark();
CREATE TRIGGER sales_sku_day_marks_month_delete
    AFTER DELETE ON sales_sku_day REFERENCING OLD TABLE AS changed
    FOR EACH STATEMENT EXECUTE FUNCTION sales_month_mark();

-- The nightly check compares cost and the uncosted pieces as well, so a month
-- that kept an old cost is found too.
CREATE OR REPLACE FUNCTION sales_month_drift(p_from date, p_to date)
RETURNS TABLE (month date, site_id text, day_qty bigint, day_net bigint,
               month_qty bigint, month_net bigint)
LANGUAGE sql STABLE AS $$
    WITH d AS (
        SELECT date_trunc('month', business_date)::date AS month, site_id,
               sum(sold_qty)::bigint AS qty, sum(net_minor)::bigint AS net,
               sum(cost_minor)::bigint AS cost, sum(uncosted_minor)::bigint AS uncosted,
               sum(refund_minor)::bigint AS refund
          FROM sales_sku_day
         WHERE business_date >= date_trunc('month', p_from)::date
           AND business_date < (date_trunc('month', p_to) + interval '1 month')::date
         GROUP BY 1, 2
    ), m AS (
        SELECT month, site_id, sum(sold_qty)::bigint AS qty, sum(net_minor)::bigint AS net,
               sum(cost_minor)::bigint AS cost, sum(uncosted_minor)::bigint AS uncosted,
               sum(refund_minor)::bigint AS refund
          FROM sales_article_month
         WHERE month BETWEEN date_trunc('month', p_from)::date AND date_trunc('month', p_to)::date
         GROUP BY 1, 2
    )
    SELECT COALESCE(d.month, m.month), COALESCE(d.site_id, m.site_id),
           COALESCE(d.qty, 0), COALESCE(d.net, 0), COALESCE(m.qty, 0), COALESCE(m.net, 0)
      FROM d FULL JOIN m ON m.month = d.month AND m.site_id = d.site_id
     WHERE COALESCE(d.qty, 0) <> COALESCE(m.qty, 0)
        OR COALESCE(d.net, 0) <> COALESCE(m.net, 0)
        OR COALESCE(d.cost, 0) <> COALESCE(m.cost, 0)
        OR COALESCE(d.uncosted, 0) <> COALESCE(m.uncosted, 0)
        OR COALESCE(d.refund, 0) <> COALESCE(m.refund, 0)
$$;

-- Whatever is out of step today is due now.
INSERT INTO sales_month_dirty (month, site_id)
SELECT month, site_id FROM sales_month_drift('-infinity', 'infinity')
ON CONFLICT DO NOTHING;
