-- Payroll's two meanings, mapped at every place that can owe or pay.
--
-- `hand_over` now posts the accrual -- Dr `payroll_expense` (6201 Beban
-- Pegawai, the pay component as its category) and Cr `payroll_payable`
-- (2301, accrual_kind BIAYA_GAJI_DAN_UPAH_YMHD) -- in the same transaction
-- that records the handover. The resolver refuses an unmapped meaning rather
-- than defaulting, so the posting needs these rows to exist before the first
-- run is handed over. Every site, both meanings, one category each: the
-- component varies per slip in the subledger, not per site.

INSERT INTO account_map (semantic_key, site_id, qualifier, account_code, category_code, set_by)
SELECT k.key, s.id, '', k.account_code, k.category, '0313'
  FROM site s
  CROSS JOIN (
      VALUES
          ('payroll_payable', '2301', 'BIAYA_GAJI_DAN_UPAH_YMHD'),
          ('payroll_expense', '6201', 'BIAYA_GAJI_KARYAWAN')
  ) AS k(key, account_code, category)
ON CONFLICT (semantic_key, site_id, qualifier) DO NOTHING;

-- The new meaning is declared in `required_semantic_keys` with the same
-- category, so the assert that keeps the used and the declared in agreement
-- passes on the first posting after this migration.
