-- The Sales screen showed what sold — pieces and rupiah per SKU — but not how
-- many sales it came from: a million receipts were nowhere on it. Receipts are
-- not a sum of SKUs (one receipt holds several), and neither is a way of
-- paying (a receipt is paid, not an item) nor a cashier's session. So they
-- are counted on their own, per store and business day, beside the SKU
-- summary (0930) and by the same job, from the same raw sales.
--
--  * sales_store_day   receipts completed, voided (and what they charged),
--                      returns made.
--  * sales_payment_day money collected per way of paying, change given back
--                      taken off the cash; the number of receipts paid that way.
--  * sales_shift_day   one row per cashier session of the day: receipts,
--                      pieces and sales. Sales rung with no session open (and
--                      the centre's own till) are one row with an empty key.

CREATE TABLE sales_store_day (
    business_date   date   NOT NULL,
    site_id         text   NOT NULL,
    receipts        bigint NOT NULL DEFAULT 0,
    voided_receipts bigint NOT NULL DEFAULT 0,
    voided_minor    bigint NOT NULL DEFAULT 0,
    return_receipts bigint NOT NULL DEFAULT 0,
    PRIMARY KEY (business_date, site_id)
);

CREATE TABLE sales_payment_day (
    business_date date   NOT NULL,
    site_id       text   NOT NULL,
    -- CASH, CARD_DEBIT, CARD_CREDIT, CARD (kind unknown), QRIS, ...
    method        text   NOT NULL,
    receipts      bigint NOT NULL DEFAULT 0,
    amount_minor  bigint NOT NULL DEFAULT 0,
    PRIMARY KEY (business_date, site_id, method)
);

CREATE TABLE sales_shift_day (
    business_date   date        NOT NULL,
    site_id         text        NOT NULL,
    -- cash_shift.shift_id as text; '' for sales with no session.
    shift_key       text        NOT NULL,
    receipts        bigint      NOT NULL DEFAULT 0,
    voided_receipts bigint      NOT NULL DEFAULT 0,
    sold_qty        bigint      NOT NULL DEFAULT 0,
    net_minor       bigint      NOT NULL DEFAULT 0,
    first_sale_at   timestamptz,
    last_sale_at    timestamptz,
    PRIMARY KEY (business_date, site_id, shift_key)
);
CREATE INDEX ix_sales_shift_day_site ON sales_shift_day (site_id, business_date);

-- The tenders of the day's completed sales, as one signed list: what each way
-- of paying took in, and the change given back (always cash) as a negative.
CREATE FUNCTION sales_tenders_of_day(p_day date, p_site text)
RETURNS TABLE (sale_id uuid, method text, amount_minor bigint)
LANGUAGE sql STABLE AS $$
    SELECT t.sale_id,
           CASE WHEN t.method = 'CARD' THEN 'CARD' || COALESCE('_' || t.card_kind, '')
                ELSE t.method END,
           t.amount_minor
      FROM edge_sale e JOIN edge_sale_tender t ON t.sale_id = e.sale_id
     WHERE e.business_date = p_day AND e.site_id = p_site AND e.status = 'COMPLETED'
    UNION ALL
    SELECT e.sale_id, 'CASH', -e.change_minor
      FROM edge_sale e
     WHERE e.business_date = p_day AND e.site_id = p_site AND e.status = 'COMPLETED'
       AND e.change_minor > 0
    UNION ALL
    SELECT p.sale_id,
           CASE WHEN p.method = 'CARD' THEN 'CARD' || COALESCE('_' || p.card_kind, '')
                ELSE p.method END,
           p.amount_minor
      FROM sale s JOIN sale_payment p ON p.sale_id = s.id
     WHERE s.site_id = p_site AND s.status = 'COMPLETED' AND s.completed_at IS NOT NULL
       AND site_local_date(s.completed_at, s.site_id) = p_day
    UNION ALL
    SELECT s.id, 'CASH', -s.change_minor
      FROM sale s
     WHERE s.site_id = p_site AND s.status = 'COMPLETED' AND s.completed_at IS NOT NULL
       AND site_local_date(s.completed_at, s.site_id) = p_day AND s.change_minor > 0
$$;

CREATE FUNCTION sales_store_day_refresh(p_day date, p_site text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    DELETE FROM sales_store_day WHERE business_date = p_day AND site_id = p_site;
    INSERT INTO sales_store_day (business_date, site_id, receipts, voided_receipts,
                                 voided_minor, return_receipts)
    SELECT p_day, p_site,
           COALESCE(sum(receipts), 0), COALESCE(sum(voided), 0),
           COALESCE(sum(voided_minor), 0), COALESCE(sum(returns), 0)
      FROM (
          SELECT count(*) FILTER (WHERE status = 'COMPLETED') AS receipts,
                 count(*) FILTER (WHERE status = 'VOIDED') AS voided,
                 sum(total_minor) FILTER (WHERE status = 'VOIDED') AS voided_minor,
                 0 AS returns
            FROM edge_sale
           WHERE business_date = p_day AND site_id = p_site
          UNION ALL
          SELECT count(*) FILTER (WHERE status = 'COMPLETED'),
                 count(*) FILTER (WHERE status = 'VOIDED'),
                 sum(total_minor) FILTER (WHERE status = 'VOIDED'),
                 0
            FROM sale
           WHERE site_id = p_site AND completed_at IS NOT NULL
             AND site_local_date(completed_at, site_id) = p_day
          UNION ALL
          SELECT 0, 0, 0, count(*)
            FROM sale_return
           WHERE site_id = p_site AND site_local_date(created_at, site_id) = p_day
      ) counted
    HAVING COALESCE(sum(receipts), 0) + COALESCE(sum(voided), 0) + COALESCE(sum(returns), 0) > 0;

    DELETE FROM sales_payment_day WHERE business_date = p_day AND site_id = p_site;
    INSERT INTO sales_payment_day (business_date, site_id, method, receipts, amount_minor)
    SELECT p_day, p_site, method,
           count(DISTINCT sale_id) FILTER (WHERE amount_minor > 0), sum(amount_minor)
      FROM sales_tenders_of_day(p_day, p_site)
     GROUP BY method
    HAVING sum(amount_minor) <> 0;

    DELETE FROM sales_shift_day WHERE business_date = p_day AND site_id = p_site;
    INSERT INTO sales_shift_day (business_date, site_id, shift_key, receipts, voided_receipts,
                                 sold_qty, net_minor, first_sale_at, last_sale_at)
    SELECT p_day, p_site, shift_key,
           sum(receipts), sum(voided), sum(qty), sum(net), min(first_at), max(last_at)
      FROM (
          SELECT COALESCE(e.shift_id::text, '') AS shift_key,
                 count(*) FILTER (WHERE e.status = 'COMPLETED') AS receipts,
                 count(*) FILTER (WHERE e.status = 'VOIDED') AS voided,
                 COALESCE(sum(l.qty) FILTER (WHERE e.status = 'COMPLETED'), 0) AS qty,
                 COALESCE(sum(l.net) FILTER (WHERE e.status = 'COMPLETED'), 0) AS net,
                 min(e.occurred_at) AS first_at, max(e.occurred_at) AS last_at
            FROM edge_sale e
            LEFT JOIN LATERAL (
                SELECT sum(el.quantity) AS qty,
                       sum(COALESCE(el.line_total_minor, el.quantity * el.unit_price_minor)) AS net
                  FROM edge_sale_line el WHERE el.sale_id = e.sale_id) l ON true
           WHERE e.business_date = p_day AND e.site_id = p_site
           GROUP BY 1
          UNION ALL
          SELECT '',
                 count(*) FILTER (WHERE s.status = 'COMPLETED'),
                 count(*) FILTER (WHERE s.status = 'VOIDED'),
                 COALESCE(sum(l.qty) FILTER (WHERE s.status = 'COMPLETED'), 0),
                 COALESCE(sum(l.net) FILTER (WHERE s.status = 'COMPLETED'), 0),
                 min(s.completed_at), max(s.completed_at)
            FROM sale s
            LEFT JOIN LATERAL (
                SELECT sum(sl.quantity) AS qty, sum(sl.total_minor) AS net
                  FROM sale_line sl WHERE sl.sale_id = s.id) l ON true
           WHERE s.site_id = p_site AND s.completed_at IS NOT NULL
             AND site_local_date(s.completed_at, s.site_id) = p_day
          HAVING count(*) > 0
      ) parts
     GROUP BY shift_key;
END
$$;

-- Everything already sold, once, set-based (the nightly check and the job keep
-- it right afterwards).
INSERT INTO sales_store_day (business_date, site_id, receipts, voided_receipts,
                             voided_minor, return_receipts)
SELECT day, site_id, sum(receipts), sum(voided), sum(voided_minor), sum(returns)
  FROM (
      SELECT business_date AS day, site_id,
             count(*) FILTER (WHERE status = 'COMPLETED') AS receipts,
             count(*) FILTER (WHERE status = 'VOIDED') AS voided,
             COALESCE(sum(total_minor) FILTER (WHERE status = 'VOIDED'), 0) AS voided_minor,
             0 AS returns
        FROM edge_sale
       WHERE business_date IS NOT NULL
       GROUP BY 1, 2
      UNION ALL
      SELECT site_local_date(completed_at, site_id), site_id,
             count(*) FILTER (WHERE status = 'COMPLETED'),
             count(*) FILTER (WHERE status = 'VOIDED'),
             COALESCE(sum(total_minor) FILTER (WHERE status = 'VOIDED'), 0),
             0
        FROM sale
       WHERE completed_at IS NOT NULL
       GROUP BY 1, 2
      UNION ALL
      SELECT site_local_date(created_at, site_id), site_id, 0, 0, 0, count(*)
        FROM sale_return
       GROUP BY 1, 2
  ) counted
 GROUP BY day, site_id;

INSERT INTO sales_payment_day (business_date, site_id, method, receipts, amount_minor)
SELECT day, site_id, method, count(DISTINCT sale_id) FILTER (WHERE amount > 0), sum(amount)
  FROM (
      SELECT e.business_date AS day, e.site_id, e.sale_id,
             CASE WHEN t.method = 'CARD' THEN 'CARD' || COALESCE('_' || t.card_kind, '')
                  ELSE t.method END AS method,
             t.amount_minor AS amount
        FROM edge_sale e JOIN edge_sale_tender t ON t.sale_id = e.sale_id
       WHERE e.status = 'COMPLETED' AND e.business_date IS NOT NULL
      UNION ALL
      SELECT e.business_date, e.site_id, e.sale_id, 'CASH', -e.change_minor
        FROM edge_sale e
       WHERE e.status = 'COMPLETED' AND e.business_date IS NOT NULL AND e.change_minor > 0
      UNION ALL
      SELECT site_local_date(s.completed_at, s.site_id), s.site_id, s.id,
             CASE WHEN p.method = 'CARD' THEN 'CARD' || COALESCE('_' || p.card_kind, '')
                  ELSE p.method END,
             p.amount_minor
        FROM sale s JOIN sale_payment p ON p.sale_id = s.id
       WHERE s.status = 'COMPLETED' AND s.completed_at IS NOT NULL
      UNION ALL
      SELECT site_local_date(s.completed_at, s.site_id), s.site_id, s.id, 'CASH', -s.change_minor
        FROM sale s
       WHERE s.status = 'COMPLETED' AND s.completed_at IS NOT NULL AND s.change_minor > 0
  ) tenders
 GROUP BY day, site_id, method
HAVING sum(amount) <> 0;

INSERT INTO sales_shift_day (business_date, site_id, shift_key, receipts, voided_receipts,
                             sold_qty, net_minor, first_sale_at, last_sale_at)
SELECT day, site_id, shift_key, sum(receipts), sum(voided), sum(qty), sum(net),
       min(first_at), max(last_at)
  FROM (
      SELECT e.business_date AS day, e.site_id, COALESCE(e.shift_id::text, '') AS shift_key,
             count(*) FILTER (WHERE e.status = 'COMPLETED') AS receipts,
             count(*) FILTER (WHERE e.status = 'VOIDED') AS voided,
             COALESCE(sum(l.qty) FILTER (WHERE e.status = 'COMPLETED'), 0) AS qty,
             COALESCE(sum(l.net) FILTER (WHERE e.status = 'COMPLETED'), 0) AS net,
             min(e.occurred_at) AS first_at, max(e.occurred_at) AS last_at
        FROM edge_sale e
        LEFT JOIN (
            SELECT sale_id, sum(quantity) AS qty,
                   sum(COALESCE(line_total_minor, quantity * unit_price_minor)) AS net
              FROM edge_sale_line GROUP BY sale_id) l ON l.sale_id = e.sale_id
       WHERE e.business_date IS NOT NULL
       GROUP BY 1, 2, 3
      UNION ALL
      SELECT site_local_date(s.completed_at, s.site_id), s.site_id, '',
             count(*) FILTER (WHERE s.status = 'COMPLETED'),
             count(*) FILTER (WHERE s.status = 'VOIDED'),
             COALESCE(sum(l.qty) FILTER (WHERE s.status = 'COMPLETED'), 0),
             COALESCE(sum(l.net) FILTER (WHERE s.status = 'COMPLETED'), 0),
             min(s.completed_at), max(s.completed_at)
        FROM sale s
        LEFT JOIN (
            SELECT sale_id, sum(quantity) AS qty, sum(total_minor) AS net
              FROM sale_line GROUP BY sale_id) l ON l.sale_id = s.id
       WHERE s.completed_at IS NOT NULL
       GROUP BY 1, 2
  ) parts
 GROUP BY day, site_id, shift_key;
