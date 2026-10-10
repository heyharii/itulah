-- The Sales screens summed raw till lines on every open: two million lines a
-- year, 6.8 s for one month of "Sales by store", and the server ran out of
-- memory on a full year. This is the one summary they read instead.
--
-- One row per business day × store × SKU × the division and tags the article
-- carried at the moment of the sale. Not retroactive (0715): a division or tag
-- that changes at 14:00 sends the morning's sales and the afternoon's to
-- different rows. Colour and size never change on a SKU, so the SKU code alone
-- carries them; supplier and PO come from the article (one article, one
-- purchase — there are no repeat orders).
--
-- Plain table, written by one function. Nothing here is a materialized view:
-- a day and store is recomputed from the raw lines whenever anything for it
-- arrives — a sale, a void, a return, a shop that was offline for three days —
-- so the summary is a pure function of the ledger and can always be rebuilt.

-- ── the cost of a line, frozen once ──────────────────────────────────────────
-- What a sold line cost, written the first time the line is summed and never
-- again. A supplier bill that corrects the article's cost later is booked as a
-- correction; it does not reach back into the cost of goods already sold.
CREATE TABLE sale_line_cost (
    origin      text        NOT NULL CHECK (origin IN ('edge', 'centre')),
    sale_id     uuid        NOT NULL,
    subject_id  uuid        NOT NULL,
    cost_minor  bigint      NOT NULL CHECK (cost_minor >= 0),
    costed_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (origin, sale_id, subject_id)
);

-- What one piece of an article cost: its receipt's layer with the capitalised
-- corrections on it. One receipt per article, so in practice one layer.
CREATE FUNCTION article_unit_cost(p_article uuid) RETURNS numeric
LANGUAGE sql STABLE AS $$
    SELECT sum(l.opening_cost_minor + COALESCE(adj.total, 0))::numeric
           / NULLIF(sum(l.quantity), 0)
      FROM cost_layer l
      LEFT JOIN LATERAL (
          SELECT sum(a.amount_minor) AS total
            FROM cost_layer_adjustment a
            JOIN cost_component_type t ON t.component_type = a.component_type
           WHERE a.layer_id = l.layer_id
             AND a.superseded_by IS NULL
             AND NOT t.is_opening
      ) adj ON true
     WHERE l.article_id = p_article
$$;

-- ── the order an article came in on ─────────────────────────────────────────
-- There are no repeat orders: an article is minted from one receipt line of
-- one purchase order, so by PO and by supplier read the article. The setup
-- session is where our code and the supplier's line are tied together; a
-- cancelled one tied nothing.
CREATE VIEW article_purchase_line AS
SELECT DISTINCT ON (a.id) a.id AS article_id, receipt.po_line_id
  FROM article a
  JOIN article_setup_session setup ON setup.article_code = a.article_code
  JOIN goods_receipt_line receipt ON receipt.receipt_line_id = setup.receipt_line_id
 WHERE setup.cancelled_at IS NULL
 ORDER BY a.id, setup.created_at, setup.session_id;

-- ── the summary ─────────────────────────────────────────────────────────────
CREATE TABLE sales_sku_day (
    business_date    date   NOT NULL,
    site_id          text   NOT NULL,
    sku_code         text   NOT NULL,
    article_id       uuid,
    division_code    text   NOT NULL DEFAULT '',
    tag_codes        text[] NOT NULL DEFAULT '{}',
    -- Sold, as rung up: quantity, and the money split by whether the piece
    -- went at its list price or below it (markdown or promotion).
    sold_qty         bigint NOT NULL DEFAULT 0,
    full_qty         bigint NOT NULL DEFAULT 0,
    full_minor       bigint NOT NULL DEFAULT 0,
    discounted_qty   bigint NOT NULL DEFAULT 0,
    discounted_minor bigint NOT NULL DEFAULT 0,
    -- The same money in three steps: the list price, the till price after
    -- any markdown (gross), and what was charged after promotions and any
    -- apportioned bill discount (net = full + discounted). Markdown is list
    -- less gross, discount is gross less net.
    list_minor       bigint NOT NULL DEFAULT 0,
    gross_minor      bigint NOT NULL DEFAULT 0,
    net_minor        bigint NOT NULL DEFAULT 0,
    tax_minor        bigint NOT NULL DEFAULT 0,
    -- Brought back over the counter that day.
    returned_qty     bigint NOT NULL DEFAULT 0,
    refund_minor     bigint NOT NULL DEFAULT 0,
    -- Cost of goods sold (returns put back what was restocked); pieces whose
    -- article had no cost yet are counted, never priced at zero.
    cost_minor       bigint NOT NULL DEFAULT 0,
    uncosted_qty     bigint NOT NULL DEFAULT 0,
    PRIMARY KEY (business_date, site_id, sku_code, division_code, tag_codes)
);
CREATE INDEX ix_sales_sku_day_article ON sales_sku_day (article_id, business_date);
CREATE INDEX ix_sales_sku_day_site ON sales_sku_day (site_id, business_date);

-- Voided sales are read on their own (a few in a hundred).
CREATE INDEX IF NOT EXISTS ix_edge_sale_voided
    ON edge_sale (business_date) WHERE status = 'VOIDED';

-- The as-sold lookups the summary makes for every line.
CREATE INDEX IF NOT EXISTS ix_article_division_period_article
    ON article_division_period (article_id, valid_from);

-- ── one function computes a store's day ─────────────────────────────────────
CREATE FUNCTION sales_rollup_refresh(p_day date, p_site text) RETURNS integer
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
        returned_qty, refund_minor, cost_minor, uncosted_qty)
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
           COALESCE(sum(qty) FILTER (WHERE qty > 0 AND cost_minor IS NULL), 0)
      FROM attributed
     GROUP BY sku_code, division_code, tag_codes;
    GET DIAGNOSTICS written = ROW_COUNT;
    RETURN written;
END
$$;

-- ── what is waiting to be recomputed ────────────────────────────────────────
-- Marked by the writes themselves, so no path into the ledger can forget to:
-- the sync applier, the centre's till and the return desk all land here.
-- `mark` changes on every write, so the job deletes a row only if nothing
-- arrived for that day while it was summing it; anything later keeps it dirty.
CREATE SEQUENCE sales_rollup_mark_seq;
CREATE TABLE sales_rollup_dirty (
    business_date date        NOT NULL,
    site_id       text        NOT NULL,
    mark          bigint      NOT NULL DEFAULT nextval('sales_rollup_mark_seq'),
    marked_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (business_date, site_id)
);

CREATE FUNCTION sales_rollup_mark_edge_sale() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO sales_rollup_dirty (business_date, site_id)
    SELECT DISTINCT business_date, site_id FROM changed WHERE business_date IS NOT NULL
    ON CONFLICT (business_date, site_id)
        DO UPDATE SET mark = nextval('sales_rollup_mark_seq'), marked_at = now();
    RETURN NULL;
END
$$;
CREATE TRIGGER edge_sale_marks_sales_rollup_insert
    AFTER INSERT ON edge_sale REFERENCING NEW TABLE AS changed
    FOR EACH STATEMENT EXECUTE FUNCTION sales_rollup_mark_edge_sale();
CREATE TRIGGER edge_sale_marks_sales_rollup_update
    AFTER UPDATE ON edge_sale REFERENCING NEW TABLE AS changed
    FOR EACH STATEMENT EXECUTE FUNCTION sales_rollup_mark_edge_sale();

CREATE FUNCTION sales_rollup_mark_edge_line() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO sales_rollup_dirty (business_date, site_id)
    SELECT DISTINCT e.business_date, e.site_id
      FROM changed c JOIN edge_sale e ON e.sale_id = c.sale_id
     WHERE e.business_date IS NOT NULL
    ON CONFLICT (business_date, site_id)
        DO UPDATE SET mark = nextval('sales_rollup_mark_seq'), marked_at = now();
    RETURN NULL;
END
$$;
CREATE TRIGGER edge_sale_line_marks_sales_rollup
    AFTER INSERT ON edge_sale_line REFERENCING NEW TABLE AS changed
    FOR EACH STATEMENT EXECUTE FUNCTION sales_rollup_mark_edge_line();

CREATE FUNCTION sales_rollup_mark_sale() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO sales_rollup_dirty (business_date, site_id)
    SELECT DISTINCT site_local_date(completed_at, site_id), site_id
      FROM changed WHERE completed_at IS NOT NULL
    ON CONFLICT (business_date, site_id)
        DO UPDATE SET mark = nextval('sales_rollup_mark_seq'), marked_at = now();
    RETURN NULL;
END
$$;
CREATE TRIGGER sale_marks_sales_rollup_insert
    AFTER INSERT ON sale REFERENCING NEW TABLE AS changed
    FOR EACH STATEMENT EXECUTE FUNCTION sales_rollup_mark_sale();
CREATE TRIGGER sale_marks_sales_rollup_update
    AFTER UPDATE ON sale REFERENCING NEW TABLE AS changed
    FOR EACH STATEMENT EXECUTE FUNCTION sales_rollup_mark_sale();

CREATE FUNCTION sales_rollup_mark_return() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO sales_rollup_dirty (business_date, site_id)
    SELECT DISTINCT site_local_date(created_at, site_id), site_id FROM changed
    ON CONFLICT (business_date, site_id)
        DO UPDATE SET mark = nextval('sales_rollup_mark_seq'), marked_at = now();
    RETURN NULL;
END
$$;
CREATE TRIGGER sale_return_marks_sales_rollup
    AFTER INSERT ON sale_return REFERENCING NEW TABLE AS changed
    FOR EACH STATEMENT EXECUTE FUNCTION sales_rollup_mark_return();

CREATE FUNCTION sales_rollup_mark_return_line() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO sales_rollup_dirty (business_date, site_id)
    SELECT DISTINCT site_local_date(r.created_at, r.site_id), r.site_id
      FROM changed c JOIN sale_return r ON r.id = c.return_id
    ON CONFLICT (business_date, site_id)
        DO UPDATE SET mark = nextval('sales_rollup_mark_seq'), marked_at = now();
    RETURN NULL;
END
$$;
CREATE TRIGGER sale_return_line_marks_sales_rollup
    AFTER INSERT ON sale_return_line REFERENCING NEW TABLE AS changed
    FOR EACH STATEMENT EXECUTE FUNCTION sales_rollup_mark_return_line();

-- An article re-filed under another division or tag changes where its sales
-- count from that moment (0715), so the store days it sold on from that
-- moment on are summed again. The usual change is made now and touches today
-- only; an edited history reaches as far back as the edit does.
CREATE FUNCTION sales_rollup_mark_period(p_articles uuid[], p_since timestamptz[])
RETURNS void LANGUAGE sql AS $$
    INSERT INTO sales_rollup_dirty (business_date, site_id)
    SELECT DISTINCT d.business_date, d.site_id
      FROM unnest(p_articles, p_since) AS c(article_id, since)
      JOIN sales_sku_day d
        ON d.article_id = c.article_id
       AND d.business_date >= (CASE WHEN c.since = '-infinity' THEN '-infinity'::date
                                    ELSE (c.since - interval '1 day')::date END)
    ON CONFLICT (business_date, site_id)
        DO UPDATE SET mark = nextval('sales_rollup_mark_seq'), marked_at = now();
$$;

CREATE FUNCTION sales_rollup_mark_period_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        PERFORM sales_rollup_mark_period(array_agg(article_id), array_agg(valid_from))
           FROM after_rows;
    ELSIF TG_OP = 'DELETE' THEN
        PERFORM sales_rollup_mark_period(array_agg(article_id), array_agg(valid_from))
           FROM before_rows;
    ELSE
        -- From the earliest edge that moved: a period closed now marks today.
        PERFORM sales_rollup_mark_period(
                    array_agg(n.article_id),
                    array_agg(LEAST(
                        CASE WHEN o.valid_from IS DISTINCT FROM n.valid_from
                             THEN LEAST(o.valid_from, n.valid_from) END,
                        CASE WHEN o.valid_to IS DISTINCT FROM n.valid_to
                             THEN LEAST(COALESCE(o.valid_to, 'infinity'), COALESCE(n.valid_to, 'infinity')) END,
                        CASE WHEN row(o.*) IS DISTINCT FROM row(n.*)
                              AND o.valid_from IS NOT DISTINCT FROM n.valid_from
                              AND o.valid_to IS NOT DISTINCT FROM n.valid_to
                             THEN n.valid_from END)))
           FROM before_rows o JOIN after_rows n ON n.period_id = o.period_id
          WHERE row(o.*) IS DISTINCT FROM row(n.*);
    END IF;
    RETURN NULL;
END
$$;

CREATE TRIGGER article_division_period_marks_sales_insert
    AFTER INSERT ON article_division_period REFERENCING NEW TABLE AS after_rows
    FOR EACH STATEMENT EXECUTE FUNCTION sales_rollup_mark_period_change();
CREATE TRIGGER article_division_period_marks_sales_update
    AFTER UPDATE ON article_division_period
    REFERENCING OLD TABLE AS before_rows NEW TABLE AS after_rows
    FOR EACH STATEMENT EXECUTE FUNCTION sales_rollup_mark_period_change();
CREATE TRIGGER article_division_period_marks_sales_delete
    AFTER DELETE ON article_division_period REFERENCING OLD TABLE AS before_rows
    FOR EACH STATEMENT EXECUTE FUNCTION sales_rollup_mark_period_change();
CREATE TRIGGER article_tag_period_marks_sales_insert
    AFTER INSERT ON article_tag_period REFERENCING NEW TABLE AS after_rows
    FOR EACH STATEMENT EXECUTE FUNCTION sales_rollup_mark_period_change();
CREATE TRIGGER article_tag_period_marks_sales_update
    AFTER UPDATE ON article_tag_period
    REFERENCING OLD TABLE AS before_rows NEW TABLE AS after_rows
    FOR EACH STATEMENT EXECUTE FUNCTION sales_rollup_mark_period_change();
CREATE TRIGGER article_tag_period_marks_sales_delete
    AFTER DELETE ON article_tag_period REFERENCING OLD TABLE AS before_rows
    FOR EACH STATEMENT EXECUTE FUNCTION sales_rollup_mark_period_change();

-- An article that sold before its receipt was costed gets its cost on the
-- days it sold uncosted, once a cost exists; days already costed keep theirs.
CREATE FUNCTION sales_rollup_mark_costed() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO sales_rollup_dirty (business_date, site_id)
    SELECT DISTINCT d.business_date, d.site_id
      FROM (SELECT DISTINCT article_id FROM after_rows) c
      JOIN sales_sku_day d ON d.article_id = c.article_id AND d.uncosted_qty > 0
    ON CONFLICT (business_date, site_id)
        DO UPDATE SET mark = nextval('sales_rollup_mark_seq'), marked_at = now();
    RETURN NULL;
END
$$;
CREATE TRIGGER cost_layer_marks_uncosted_sales
    AFTER INSERT ON cost_layer REFERENCING NEW TABLE AS after_rows
    FOR EACH STATEMENT EXECUTE FUNCTION sales_rollup_mark_costed();

-- ── the check that keeps it honest ──────────────────────────────────────────
-- Every store day in the window where the summary and the raw lines disagree
-- on quantity, money or returns. The nightly job marks each one for
-- recomputation and records how many it found; zero is the expected answer.
CREATE FUNCTION sales_rollup_drift(p_from date, p_to date)
RETURNS TABLE (business_date date, site_id text, raw_qty bigint, raw_net bigint,
               summary_qty bigint, summary_net bigint)
LANGUAGE sql STABLE AS $$
    WITH raw AS (
        SELECT e.business_date AS day, e.site_id,
               sum(l.quantity)::bigint AS qty,
               sum(COALESCE(l.line_total_minor, l.quantity * l.unit_price_minor))::bigint AS net,
               0::bigint AS ret, 0::bigint AS refund
          FROM edge_sale e JOIN edge_sale_line l ON l.sale_id = e.sale_id
         WHERE e.business_date BETWEEN p_from AND p_to AND e.status = 'COMPLETED'
         GROUP BY 1, 2
        UNION ALL
        SELECT site_local_date(s.completed_at, s.site_id), s.site_id,
               sum(sl.quantity)::bigint, sum(sl.total_minor)::bigint, 0, 0
          FROM sale s JOIN sale_line sl ON sl.sale_id = s.id
         WHERE s.status = 'COMPLETED' AND s.completed_at IS NOT NULL
           AND site_local_date(s.completed_at, s.site_id) BETWEEN p_from AND p_to
         GROUP BY 1, 2
        UNION ALL
        SELECT site_local_date(r.created_at, r.site_id), r.site_id, 0, 0,
               sum(rl.quantity)::bigint, sum(rl.refund_minor)::bigint
          FROM sale_return r JOIN sale_return_line rl ON rl.return_id = r.id
         WHERE site_local_date(r.created_at, r.site_id) BETWEEN p_from AND p_to
         GROUP BY 1, 2
    ), raw_day AS (
        SELECT day, site_id, sum(qty)::bigint AS qty, sum(net)::bigint AS net,
               sum(ret)::bigint AS ret, sum(refund)::bigint AS refund
          FROM raw GROUP BY 1, 2
    ), summary AS (
        SELECT d.business_date AS day, d.site_id, sum(d.sold_qty)::bigint AS qty,
               sum(d.net_minor)::bigint AS net, sum(d.returned_qty)::bigint AS ret,
               sum(d.refund_minor)::bigint AS refund
          FROM sales_sku_day d
         WHERE d.business_date BETWEEN p_from AND p_to
         GROUP BY 1, 2
    )
    SELECT COALESCE(r.day, s.day), COALESCE(r.site_id, s.site_id),
           COALESCE(r.qty, 0), COALESCE(r.net, 0), COALESCE(s.qty, 0), COALESCE(s.net, 0)
      FROM raw_day r
      FULL JOIN summary s ON s.day = r.day AND s.site_id = r.site_id
     WHERE COALESCE(r.qty, 0) <> COALESCE(s.qty, 0)
        OR COALESCE(r.net, 0) <> COALESCE(s.net, 0)
        OR COALESCE(r.ret, 0) <> COALESCE(s.ret, 0)
        OR COALESCE(r.refund, 0) <> COALESCE(s.refund, 0)
$$;

-- ── everything already sold is summed once, by the job, after deploy ─────────
INSERT INTO sales_rollup_dirty (business_date, site_id)
SELECT DISTINCT business_date, site_id FROM edge_sale WHERE business_date IS NOT NULL
UNION
SELECT DISTINCT site_local_date(completed_at, site_id), site_id FROM sale WHERE completed_at IS NOT NULL
UNION
SELECT DISTINCT site_local_date(created_at, site_id), site_id FROM sale_return
ON CONFLICT DO NOTHING;
