-- Contractor advances already set against bills settle those bills in the
-- Payment Ledger.
--
-- Until 1 Oct 2026 `add_project_invoice` posted Dr payable / Cr advance and
-- told the Payment Ledger nothing, so the bill's open item kept the whole
-- invoice owed and CONTROL_AP was off by exactly the advance applied. The
-- code now settles it in the same transaction; this records the ones already
-- posted, the way `payable_settled` would have: against the bill's own open
-- payable item, as an ADVANCE settlement named by the project, on the
-- application's journal entry and date.
INSERT INTO payment_ledger_settlement
    (settlement_id, entry_id, against_voucher_kind, against_voucher_id,
     amount_minor, journal_entry_id, posting_date, created_by)
SELECT gen_random_uuid(), item.entry_id, 'ADVANCE', cpi.project_id::text,
       LEAST(cpi.applied_minor, item.outstanding_minor), cpi.applied_entry_id,
       e.posting_date, 'migration:0724'
  FROM contractor_project_invoice cpi
  JOIN journal_entry e ON e.entry_id = cpi.applied_entry_id
  JOIN LATERAL (
        SELECT p.entry_id, p.outstanding_minor
          FROM payment_ledger_entry p
         WHERE p.voucher_kind = 'SUPPLIER_INVOICE'
           AND p.voucher_id = cpi.invoice_id::text
           AND NOT p.delinked
           AND p.outstanding_minor > 0
         ORDER BY p.posting_date, p.entry_id
         LIMIT 1
  ) item ON true
 WHERE cpi.applied_minor > 0
   AND NOT EXISTS (
        SELECT 1 FROM payment_ledger_settlement s
         WHERE s.journal_entry_id = cpi.applied_entry_id AND NOT s.delinked);
