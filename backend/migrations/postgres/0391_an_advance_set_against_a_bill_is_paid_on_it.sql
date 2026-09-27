-- An advance set against a bill is paid on it.
--
-- # What was wrong
--
-- `supplier_invoice_standing` counted a bill as settled only by POSTED
-- supplier payments. An advance set against the bill
-- (`supplier_advance_application`, 0133) posts `Dr trade_payable / Cr
-- advance_purchase` and settles the payment-ledger item, so the general ledger
-- and `payment_ledger_entry.outstanding_minor` both stopped owing that amount
-- -- and every reader of this view kept owing it. A Rp 3.480.000 bill with Rp
-- 1.500.000 paid and a Rp 500.000 advance applied read "outstanding Rp
-- 1.980.000" on the bill list while the books said Rp 1.480.000.
--
-- # The shape
--
-- The same view, with the advance applications added to `settled.paid_minor`.
-- Money that left the bank before the bill arrived is money paid on it; the
-- bank side was answered when the advance posted.

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
    SELECT (COALESCE((SELECT sum(al.amount_minor)
                        FROM supplier_payment_allocation al
                        JOIN supplier_payment p USING (payment_id)
                       WHERE al.invoice_id = i.invoice_id AND p.status = 'POSTED'), 0)
            + COALESCE((SELECT sum(ap.amount_minor)
                          FROM supplier_advance_application ap
                         WHERE ap.invoice_id = i.invoice_id), 0))::bigint AS paid_minor
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
    '0391: an advance set against the bill (supplier_advance_application) is paid on it, as the ledger and the payment ledger already say. 0311: overdue is COALESCEd to false.';
