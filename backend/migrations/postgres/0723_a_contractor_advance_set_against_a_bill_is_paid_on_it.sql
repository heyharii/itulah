-- A contractor's advance set against its bill is paid on that bill.
--
-- A contractor project (0720) pays the contractor ahead, then sets what is
-- left of the advance against each invoice: Dr payable / Cr advance. The
-- ledger and (from 1 Oct) the Payment Ledger both say the bill is that much
-- paid, but `supplier_invoice_standing` only counted supplier payments and
-- supplier advances, so a Rp 80.000.000 invoice with Rp 50.000.000 of
-- advance against it still read 80.000.000 owed on Supplier bills, the
-- Overview and the payment projection. Same view, one more term.

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
            WHEN settled.paid_minor >= i.total_minor THEN 'PAID'::text
            WHEN settled.paid_minor > 0 THEN 'PARTIALLY_PAID'::text
            ELSE 'UNPAID'::text
        END AS payment_state,
    COALESCE(settled.paid_minor < i.total_minor AND COALESCE(upcoming.due_date, i.due_date) < CURRENT_DATE, false) AS overdue
   FROM supplier_invoice i
     CROSS JOIN LATERAL ( SELECT (COALESCE(( SELECT sum(al.amount_minor) AS sum
                   FROM supplier_payment_allocation al
                     JOIN supplier_payment p USING (payment_id)
                  WHERE al.invoice_id = i.invoice_id AND p.status = 'POSTED'::text), 0::numeric) + COALESCE(( SELECT sum(ap.amount_minor) AS sum
                   FROM supplier_advance_application ap
                  WHERE ap.invoice_id = i.invoice_id), 0::numeric) + COALESCE(( SELECT sum(cpi.applied_minor) AS sum
                   FROM contractor_project_invoice cpi
                  WHERE cpi.invoice_id = i.invoice_id), 0::numeric))::bigint AS paid_minor) settled
     LEFT JOIN LATERAL ( SELECT t.due_date
           FROM ( SELECT supplier_invoice_payment_term.due_date,
                    sum(supplier_invoice_payment_term.amount_minor) OVER (ORDER BY supplier_invoice_payment_term.due_date, supplier_invoice_payment_term.seq) AS through
                   FROM supplier_invoice_payment_term
                  WHERE supplier_invoice_payment_term.invoice_id = i.invoice_id) t
          WHERE t.through > settled.paid_minor::numeric
          ORDER BY t.due_date
         LIMIT 1) upcoming ON true;
