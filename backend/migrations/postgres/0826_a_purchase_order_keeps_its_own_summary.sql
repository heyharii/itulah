-- What an order adds up to, kept beside the order.
--
-- # Why
--
-- The order book and the supplier book both answer "where does this order
-- stand" for every order before they can show fifty of them: how many pieces
-- were ordered, how many matched at receiving, whether every line is settled,
-- what it comes to. That was worked out from the lines, the receipts and the
-- invoices on every request, with a handful of correlated sub-selects per line.
-- At 240,000 orders that is a few seconds per list, and every status tab and
-- every supplier screen asks again.
--
-- # What this is, and what it is not
--
-- A projection. The receipts, lines and invoices stay the facts; this row is
-- what they add up to, recomputed from them for the orders a statement touched.
-- It carries no counter that is added to or taken from, so it cannot drift: the
-- same function that fills it for one order fills it for all of them, and a row
-- that ever disagrees with its sources is put right by running that function
-- again (`SELECT refresh_purchase_order_summary(array_agg(purchase_order_id))
-- FROM purchase_order`).
--
-- It does not hold the discount (read from the order, so editing it needs no
-- refresh) or anything that depends on today's date (late is decided when the
-- list is read).

CREATE TABLE purchase_order_summary (
    purchase_order_id          uuid PRIMARY KEY
                               REFERENCES purchase_order(purchase_order_id) ON DELETE CASCADE,
    -- The supplier the order is for. NULL for an order whose supplier the book
    -- does not know by id or by code.
    supplier_key               uuid,
    line_count                 bigint NOT NULL DEFAULT 0,
    expected_arrival           date,
    gross_minor                bigint NOT NULL DEFAULT 0,
    expected_stock_units       bigint NOT NULL DEFAULT 0,
    ordered_label              text,
    received_stock_units       bigint NOT NULL DEFAULT 0,
    invoiced_stock_units       bigint NOT NULL DEFAULT 0,
    excess_stock_units         bigint NOT NULL DEFAULT 0,
    excess_pending_stock_units bigint NOT NULL DEFAULT 0,
    received_value_minor       bigint NOT NULL DEFAULT 0,
    last_received_at           timestamptz,
    last_closed_at             timestamptz,
    cancelled_at               timestamptz,
    all_lines_settled          boolean NOT NULL DEFAULT false,
    -- Where the order stands, derived from the rest and from `order_status`.
    lifecycle                  text NOT NULL DEFAULT 'ACTIVE'
                               CHECK (lifecycle IN ('ACTIVE', 'PARTIALLY_RECEIVED', 'FULLY_RECEIVED',
                                                    'SHORT_RECEIVED', 'CANCELLED'))
);
CREATE INDEX ix_po_summary_supplier ON purchase_order_summary (supplier_key, lifecycle);
CREATE INDEX ix_po_summary_lifecycle ON purchase_order_summary (lifecycle);

-- What a supplier's orders add up to, for the supplier book. Kept by the same
-- function that keeps the summaries, from the summaries, so a supplier list
-- does not have to walk every order there is to say how many each supplier has.
CREATE TABLE supplier_order_tally (
    supplier_id     uuid PRIMARY KEY REFERENCES supplier(supplier_id) ON DELETE CASCADE,
    order_count     bigint NOT NULL DEFAULT 0,
    ordered_minor   bigint NOT NULL DEFAULT 0,
    active_count    bigint NOT NULL DEFAULT 0,
    completed_count bigint NOT NULL DEFAULT 0,
    cancelled_count bigint NOT NULL DEFAULT 0,
    last_ordered_at timestamptz
);

-- The supplier book's house order (the ones we still buy from first, then by
-- name) as an index, so the first page of it is a seek and not a sort of every
-- supplier. The expression is the one `supplier_rows` computes.
CREATE INDEX ix_supplier_house_order ON supplier (
    ((CASE WHEN status = 'ACTIVE' THEN '0' ELSE '1' END) || ' ' || lower(COALESCE(name, ''))),
    supplier_id
);

-- Recompute the tallies of these suppliers from the summaries. The tally rows
-- are locked first, in id order and after the orders (see below), so two
-- transactions on one supplier take turns instead of overwriting each other.
CREATE FUNCTION refresh_supplier_order_tally(p_keys uuid[]) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    IF p_keys IS NULL OR cardinality(p_keys) = 0 THEN
        RETURN;
    END IF;

    INSERT INTO supplier_order_tally (supplier_id)
    SELECT k.id FROM (SELECT DISTINCT id FROM unnest(p_keys) AS id) k
      JOIN supplier s ON s.supplier_id = k.id
    ON CONFLICT (supplier_id) DO NOTHING;

    PERFORM 1 FROM unnest(p_keys) AS u(id)
      JOIN supplier_order_tally t ON t.supplier_id = u.id
     ORDER BY t.supplier_id
       FOR UPDATE OF t;

    UPDATE supplier_order_tally t SET
        order_count = COALESCE(a.order_count, 0),
        ordered_minor = COALESCE(a.ordered_minor, 0),
        active_count = COALESCE(a.active_count, 0),
        completed_count = COALESCE(a.completed_count, 0),
        cancelled_count = COALESCE(a.cancelled_count, 0),
        last_ordered_at = a.last_ordered_at
      FROM (SELECT DISTINCT id FROM unnest(p_keys) AS id) u
      LEFT JOIN (
          SELECT ps.supplier_key,
                 count(*) FILTER (WHERE ps.lifecycle <> 'CANCELLED')::bigint AS order_count,
                 COALESCE(sum(GREATEST(ps.gross_minor - o.discount_minor, 0))
                              FILTER (WHERE ps.lifecycle <> 'CANCELLED'), 0)::bigint
                     AS ordered_minor,
                 count(*) FILTER (WHERE ps.lifecycle IN ('ACTIVE', 'PARTIALLY_RECEIVED'))::bigint
                     AS active_count,
                 count(*) FILTER (WHERE ps.lifecycle IN ('FULLY_RECEIVED', 'SHORT_RECEIVED'))::bigint
                     AS completed_count,
                 count(*) FILTER (WHERE ps.lifecycle = 'CANCELLED')::bigint AS cancelled_count,
                 max(o.issued_at) FILTER (WHERE ps.lifecycle <> 'CANCELLED') AS last_ordered_at
            FROM (SELECT DISTINCT id FROM unnest(p_keys) AS id) k
            JOIN purchase_order_summary ps ON ps.supplier_key = k.id
            JOIN purchase_order o ON o.purchase_order_id = ps.purchase_order_id
           GROUP BY ps.supplier_key
      ) a ON a.supplier_key = u.id
     WHERE t.supplier_id = u.id;
END;
$$;

-- Recompute the summary of these orders from their lines, receipts and
-- invoices. The orders are locked first, in id order, so two transactions
-- touching the same order take turns: the second one recomputes AFTER the
-- first has committed, and so cannot overwrite it with a total that left the
-- first one's receipt out.
CREATE FUNCTION refresh_purchase_order_summary(p_ids uuid[]) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
    v_keys uuid[];
BEGIN
    IF p_ids IS NULL OR cardinality(p_ids) = 0 THEN
        RETURN;
    END IF;

    -- A join to `unnest`, not `= ANY (array)`: the array can hold every order
    -- there is (the backfill below), and a membership test walks it per row.
    PERFORM 1 FROM unnest(p_ids) AS u(id)
      JOIN purchase_order po ON po.purchase_order_id = u.id
     ORDER BY po.purchase_order_id
       FOR NO KEY UPDATE OF po;

    -- The suppliers these orders belonged to, before this refresh may move them.
    SELECT COALESCE(array_agg(DISTINCT s.supplier_key), '{}') INTO v_keys
      FROM unnest(p_ids) AS u(id)
      JOIN purchase_order_summary s ON s.purchase_order_id = u.id
     WHERE s.supplier_key IS NOT NULL;

    -- Set-based on purpose: one pass over the receipts and invoices of the
    -- orders asked for, however many that is. The same sums worked out line by
    -- line with a sub-select each cost 3 ms an order, which is a quarter of an
    -- hour for the backfill below at 240,000 orders.
    WITH target AS (
        SELECT DISTINCT id FROM unnest(p_ids) AS id
    ), ol AS (
        SELECT l.*
          FROM target t
          JOIN purchase_order_line l ON l.purchase_order_id = t.id
    ), rcpt AS (
        -- MATCHED, not everything accepted: what arrived beyond the order was
        -- never what the order was waiting for.
        SELECT r.po_line_id,
               sum(r.matched_quantity)::bigint AS matched,
               sum(r.excess_quantity)::bigint AS excess,
               COALESCE(sum(r.excess_quantity) FILTER (
                   WHERE r.excess_quantity > 0
                     AND NOT EXISTS (SELECT 1 FROM purchase_excess_decision d
                                      WHERE d.receipt_line_id = r.receipt_line_id)), 0)::bigint
                   AS excess_pending,
               COALESCE(sum(purchase_receipt_value(
                                r.matched_quantity, r.agreed_unit_price_minor,
                                ol.unit_price_minor, ol.order_unit_price_minor, ol.unit_factor))
                        - sum(r.allocated_discount_minor), 0)::bigint AS value_minor,
               max(r.received_at) AS last_received_at
          FROM ol
          JOIN goods_receipt_line r ON r.po_line_id = ol.po_line_id
         GROUP BY r.po_line_id
    ), inv AS (
        SELECT il.po_line_id, sum(il.quantity)::bigint AS invoiced
          FROM ol
          JOIN supplier_invoice_line il ON il.po_line_id = ol.po_line_id
          JOIN supplier_invoice si ON si.invoice_id = il.invoice_id
         WHERE si.status IN ('DRAFT', 'MATCHED', 'POSTED')
         GROUP BY il.po_line_id
    ), per_line AS (
        SELECT ol.purchase_order_id, ol.promised_date, ol.line_amount_minor, ol.closed_short_at,
               ol.ordered_quantity - ol.cancelled_quantity AS expected,
               COALESCE(rcpt.matched, 0) AS matched,
               COALESCE(rcpt.excess, 0) AS excess,
               COALESCE(rcpt.excess_pending, 0) AS excess_pending,
               COALESCE(rcpt.value_minor, 0) AS value_minor,
               rcpt.last_received_at,
               COALESCE(inv.invoiced, 0) AS invoiced,
               (ol.line_status <> 'OPEN'
                OR COALESCE(rcpt.matched, 0) >= ol.ordered_quantity - ol.cancelled_quantity)
                   AS settled
          FROM ol
          LEFT JOIN rcpt ON rcpt.po_line_id = ol.po_line_id
          LEFT JOIN inv ON inv.po_line_id = ol.po_line_id
    ), agg AS (
        SELECT purchase_order_id,
               count(*)::bigint AS line_count,
               min(promised_date) AS expected_arrival,
               sum(line_amount_minor)::bigint AS gross_minor,
               sum(expected)::bigint AS expected_units,
               sum(matched)::bigint AS received_units,
               sum(invoiced)::bigint AS invoiced_units,
               sum(excess)::bigint AS excess_units,
               sum(excess_pending)::bigint AS excess_pending_units,
               sum(value_minor)::bigint AS received_value_minor,
               max(last_received_at) AS last_received_at,
               max(closed_short_at) AS last_closed_at,
               bool_and(settled) AS all_settled
          FROM per_line
         GROUP BY purchase_order_id
    ), labels AS (
        -- What the order says it bought, in the units it was bought in:
        -- 5 kodi, or 10 kodi + 2 pcs for a mixed order.
        SELECT purchase_order_id, string_agg(txt, ' + ' ORDER BY pcs DESC) AS ordered_label
          FROM (
              SELECT ol.purchase_order_id,
                     trim_scale(sum(
                         CASE WHEN ol.order_unit_code IS NULL
                              THEN ol.ordered_quantity - ol.cancelled_quantity
                              ELSE ol.order_unit_quantity
                         END))::text
                     || ' ' || COALESCE(lower(ol.order_unit_code), 'pcs') AS txt,
                     sum(ol.ordered_quantity - ol.cancelled_quantity) AS pcs
                FROM ol
               GROUP BY ol.purchase_order_id, ol.order_unit_code
          ) q
         GROUP BY purchase_order_id
    )
    INSERT INTO purchase_order_summary AS s (
        purchase_order_id, supplier_key, line_count, expected_arrival, gross_minor,
        expected_stock_units, ordered_label, received_stock_units, invoiced_stock_units,
        excess_stock_units, excess_pending_stock_units, received_value_minor,
        last_received_at, last_closed_at, cancelled_at, all_lines_settled, lifecycle)
    SELECT o.purchase_order_id,
           COALESCE(o.supplier_ref_id,
                    (SELECT x.supplier_id FROM supplier x WHERE x.supplier_code = o.supplier_id)),
           COALESCE(a.line_count, 0), a.expected_arrival, COALESCE(a.gross_minor, 0),
           COALESCE(a.expected_units, 0), lb.ordered_label,
           COALESCE(a.received_units, 0), COALESCE(a.invoiced_units, 0),
           COALESCE(a.excess_units, 0), COALESCE(a.excess_pending_units, 0),
           COALESCE(a.received_value_minor, 0),
           a.last_received_at, a.last_closed_at,
           (SELECT max(r.revised_at) FROM purchase_order_revision r
             WHERE r.purchase_order_id = o.purchase_order_id
               AND r.changes @> '[{"kind": "cancelled"}]'::jsonb),
           COALESCE(a.all_settled, false),
           -- SHORT_RECEIVED is an order that stopped waiting with pieces
           -- missing; PARTIALLY_RECEIVED is still waiting for the rest.
           CASE
               WHEN o.order_status = 'CANCELLED' THEN 'CANCELLED'
               WHEN COALESCE(a.expected_units, 0) > 0
                    AND COALESCE(a.received_units, 0) >= a.expected_units THEN 'FULLY_RECEIVED'
               WHEN COALESCE(a.all_settled, false) OR o.order_status = 'CLOSED' THEN 'SHORT_RECEIVED'
               WHEN COALESCE(a.received_units, 0) > 0 THEN 'PARTIALLY_RECEIVED'
               ELSE 'ACTIVE'
           END
      FROM target t
      JOIN purchase_order o ON o.purchase_order_id = t.id
      LEFT JOIN agg a ON a.purchase_order_id = o.purchase_order_id
      LEFT JOIN labels lb ON lb.purchase_order_id = o.purchase_order_id
     ORDER BY o.purchase_order_id
    ON CONFLICT (purchase_order_id) DO UPDATE SET
        supplier_key = EXCLUDED.supplier_key,
        line_count = EXCLUDED.line_count,
        expected_arrival = EXCLUDED.expected_arrival,
        gross_minor = EXCLUDED.gross_minor,
        expected_stock_units = EXCLUDED.expected_stock_units,
        ordered_label = EXCLUDED.ordered_label,
        received_stock_units = EXCLUDED.received_stock_units,
        invoiced_stock_units = EXCLUDED.invoiced_stock_units,
        excess_stock_units = EXCLUDED.excess_stock_units,
        excess_pending_stock_units = EXCLUDED.excess_pending_stock_units,
        received_value_minor = EXCLUDED.received_value_minor,
        last_received_at = EXCLUDED.last_received_at,
        last_closed_at = EXCLUDED.last_closed_at,
        cancelled_at = EXCLUDED.cancelled_at,
        all_lines_settled = EXCLUDED.all_lines_settled,
        lifecycle = EXCLUDED.lifecycle;

    -- ...and after: the old suppliers and the new ones both have a new tally.
    SELECT COALESCE(array_agg(DISTINCT k), '{}') INTO v_keys
      FROM (
          SELECT unnest(v_keys) AS k
          UNION
          SELECT s.supplier_key
            FROM unnest(p_ids) AS u(id)
            JOIN purchase_order_summary s ON s.purchase_order_id = u.id
           WHERE s.supplier_key IS NOT NULL
      ) x;
    PERFORM refresh_supplier_order_tally(v_keys);
END;
$$;

-- The orders that own these order lines / receipt lines / invoice lines.
CREATE FUNCTION purchase_orders_of_lines(p_line_ids uuid[]) RETURNS uuid[]
LANGUAGE sql STABLE AS $$
    SELECT COALESCE(array_agg(DISTINCT l.purchase_order_id), '{}')
      FROM unnest(p_line_ids) AS u(id)
      JOIN purchase_order_line l ON l.po_line_id = u.id
$$;

-- ---- The triggers: one statement, one refresh of the orders it touched ------

CREATE FUNCTION po_summary_on_order() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    PERFORM refresh_purchase_order_summary(array(SELECT purchase_order_id FROM new_rows));
    RETURN NULL;
END;
$$;
CREATE TRIGGER po_summary_order_insert AFTER INSERT ON purchase_order
    REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION po_summary_on_order();
CREATE TRIGGER po_summary_order_update AFTER UPDATE
    ON purchase_order
    REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION po_summary_on_order();

CREATE FUNCTION po_summary_on_order_line() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        PERFORM refresh_purchase_order_summary(array(SELECT DISTINCT purchase_order_id FROM new_rows));
    ELSIF TG_OP = 'DELETE' THEN
        PERFORM refresh_purchase_order_summary(array(SELECT DISTINCT purchase_order_id FROM old_rows));
    ELSE
        PERFORM refresh_purchase_order_summary(array(
            SELECT purchase_order_id FROM new_rows UNION SELECT purchase_order_id FROM old_rows));
    END IF;
    RETURN NULL;
END;
$$;
CREATE TRIGGER po_summary_line_insert AFTER INSERT ON purchase_order_line
    REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION po_summary_on_order_line();
CREATE TRIGGER po_summary_line_update AFTER UPDATE ON purchase_order_line
    REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
    FOR EACH STATEMENT EXECUTE FUNCTION po_summary_on_order_line();
CREATE TRIGGER po_summary_line_delete AFTER DELETE ON purchase_order_line
    REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION po_summary_on_order_line();

-- Receipt lines and invoice lines both point at an order line.
CREATE FUNCTION po_summary_on_receipt_line() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        PERFORM refresh_purchase_order_summary(purchase_orders_of_lines(
            array(SELECT DISTINCT po_line_id FROM new_rows)));
    ELSIF TG_OP = 'DELETE' THEN
        PERFORM refresh_purchase_order_summary(purchase_orders_of_lines(
            array(SELECT DISTINCT po_line_id FROM old_rows)));
    ELSE
        PERFORM refresh_purchase_order_summary(purchase_orders_of_lines(array(
            SELECT po_line_id FROM new_rows UNION SELECT po_line_id FROM old_rows)));
    END IF;
    RETURN NULL;
END;
$$;
CREATE TRIGGER po_summary_receipt_line_insert AFTER INSERT ON goods_receipt_line
    REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION po_summary_on_receipt_line();
CREATE TRIGGER po_summary_receipt_line_update AFTER UPDATE ON goods_receipt_line
    REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
    FOR EACH STATEMENT EXECUTE FUNCTION po_summary_on_receipt_line();
CREATE TRIGGER po_summary_receipt_line_delete AFTER DELETE ON goods_receipt_line
    REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION po_summary_on_receipt_line();

CREATE FUNCTION po_summary_on_invoice_line() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        PERFORM refresh_purchase_order_summary(purchase_orders_of_lines(
            array(SELECT DISTINCT po_line_id FROM new_rows WHERE po_line_id IS NOT NULL)));
    ELSIF TG_OP = 'DELETE' THEN
        PERFORM refresh_purchase_order_summary(purchase_orders_of_lines(
            array(SELECT DISTINCT po_line_id FROM old_rows WHERE po_line_id IS NOT NULL)));
    ELSE
        PERFORM refresh_purchase_order_summary(purchase_orders_of_lines(array(
            SELECT po_line_id FROM new_rows WHERE po_line_id IS NOT NULL
            UNION SELECT po_line_id FROM old_rows WHERE po_line_id IS NOT NULL)));
    END IF;
    RETURN NULL;
END;
$$;
CREATE TRIGGER po_summary_invoice_line_insert AFTER INSERT ON supplier_invoice_line
    REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION po_summary_on_invoice_line();
CREATE TRIGGER po_summary_invoice_line_update AFTER UPDATE ON supplier_invoice_line
    REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
    FOR EACH STATEMENT EXECUTE FUNCTION po_summary_on_invoice_line();
CREATE TRIGGER po_summary_invoice_line_delete AFTER DELETE ON supplier_invoice_line
    REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION po_summary_on_invoice_line();

-- An invoice changing status moves its quantity in or out of what is invoiced.
CREATE FUNCTION po_summary_on_invoice() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    PERFORM refresh_purchase_order_summary(purchase_orders_of_lines(array(
        SELECT il.po_line_id FROM supplier_invoice_line il
         WHERE il.po_line_id IS NOT NULL
           AND il.invoice_id IN (SELECT invoice_id FROM new_rows))));
    RETURN NULL;
END;
$$;
CREATE TRIGGER po_summary_invoice_status AFTER UPDATE ON supplier_invoice
    REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION po_summary_on_invoice();

-- A decision on an excess moves it out of "pending".
CREATE FUNCTION po_summary_on_excess_decision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    receipt_lines uuid[];
BEGIN
    IF TG_OP = 'INSERT' THEN
        receipt_lines := array(SELECT receipt_line_id FROM new_rows);
    ELSIF TG_OP = 'DELETE' THEN
        receipt_lines := array(SELECT receipt_line_id FROM old_rows);
    ELSE
        receipt_lines := array(SELECT receipt_line_id FROM new_rows
                               UNION SELECT receipt_line_id FROM old_rows);
    END IF;
    PERFORM refresh_purchase_order_summary(purchase_orders_of_lines(array(
        SELECT r.po_line_id FROM unnest(receipt_lines) AS u(id)
          JOIN goods_receipt_line r ON r.receipt_line_id = u.id)));
    RETURN NULL;
END;
$$;
CREATE TRIGGER po_summary_excess_insert AFTER INSERT ON purchase_excess_decision
    REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION po_summary_on_excess_decision();
CREATE TRIGGER po_summary_excess_update AFTER UPDATE ON purchase_excess_decision
    REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
    FOR EACH STATEMENT EXECUTE FUNCTION po_summary_on_excess_decision();
CREATE TRIGGER po_summary_excess_delete AFTER DELETE ON purchase_excess_decision
    REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION po_summary_on_excess_decision();

-- A cancellation is read off the revision log.
CREATE FUNCTION po_summary_on_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    PERFORM refresh_purchase_order_summary(array(SELECT DISTINCT purchase_order_id FROM new_rows));
    RETURN NULL;
END;
$$;
CREATE TRIGGER po_summary_revision_insert AFTER INSERT ON purchase_order_revision
    REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION po_summary_on_revision();

-- Every order that already exists.
SELECT refresh_purchase_order_summary(array_agg(purchase_order_id)) FROM purchase_order;
