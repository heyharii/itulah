-- A bill with no due date is never overdue.
--
-- # What was wrong
--
-- `supplier_invoice_standing.overdue` was
--
--     settled.paid_minor < i.total_minor
--         AND COALESCE(upcoming.due_date, i.due_date) < CURRENT_DATE
--
-- and AND does not coalesce. A bill with no instalments and no `due_date` --
-- cash-on-delivery terms, a booking paid in full ahead of any date -- made the
-- second comparison NULL, made the AND NULL, and made `overdue` NULL for a
-- column every reader decodes as `bool`. `bill()` answered such a bill with a
-- decode failure that reached the screen as "database operation failed",
-- naming neither the bill nor the column; any listing that carried the
-- overdue column failed with it.
--
-- A bill whose date nobody agreed is not "unknown overdue"; it is not overdue.
--
-- # The shape
--
-- The same view, one expression widened: the comparison is COALESCEd to false
-- where the date it needs does not exist. `next_due_date` keeps its NULL --
-- "no date agreed" is real information and is decoded as an Option -- while
-- `overdue` is a question with a boolean answer.

CREATE OR REPLACE VIEW supplier_invoice_standing AS
SELECT i.invoice_id,
       i.total_minor,
       settled.paid_minor,
       i.total_minor - settled.paid_minor AS outstanding_minor,
       CASE
           WHEN settled.paid_minor >= i.total_minor THEN NULL::date
           ELSE COALESCE(upcoming.due_date, i.due_date)
       END AS next_due_date,
       CASE
           WHEN settled.paid_minor >= i.total_minor THEN 'PAID'
           WHEN settled.paid_minor > 0 THEN 'PARTIALLY_PAID'
           ELSE 'UNPAID'
       END AS payment_state,
       COALESCE(
           settled.paid_minor < i.total_minor
               AND COALESCE(upcoming.due_date, i.due_date) < CURRENT_DATE,
           false
       ) AS overdue
FROM supplier_invoice i
CROSS JOIN LATERAL (
    SELECT COALESCE(sum(al.amount_minor), 0)::bigint AS paid_minor
      FROM supplier_payment_allocation al
      JOIN supplier_payment p USING (payment_id)
     WHERE al.invoice_id = i.invoice_id AND p.status = 'POSTED'
) settled
LEFT JOIN LATERAL (
    SELECT t.due_date
      FROM (
           SELECT supplier_invoice_payment_term.due_date,
                  sum(supplier_invoice_payment_term.amount_minor)
                      OVER (ORDER BY supplier_invoice_payment_term.due_date,
                            supplier_invoice_payment_term.seq) AS through
             FROM supplier_invoice_payment_term
            WHERE supplier_invoice_payment_term.invoice_id = i.invoice_id
      ) t
     WHERE t.through > settled.paid_minor
     ORDER BY t.due_date
     LIMIT 1
) upcoming ON true;

COMMENT ON VIEW supplier_invoice_standing IS
    '0311: overdue is COALESCEd to false -- a bill with no due date and no instalment has no date to be late by, and NULL here crashed every reader that decoded the column as bool.';
