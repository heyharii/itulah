-- 0817: the standard overtime components land on Biaya Lembur.
--
-- Settings › Overtime defines the eight PP 35/2021 components with fixed codes
-- (the "Define missing" presets). Defining them left Finance without a link,
-- so the first payroll with any overtime was refused at the handover — found
-- in the hub test pass of 1 Oct 2026. The chart has the leaf for it: 6013
-- Biaya Lembur at a store, 6027 at head office. A link names a code, not a
-- defined row, so a company that has not defined the presets yet loses
-- nothing; Finance can still move any of them on the Account Links screen.

INSERT INTO account_link
    (role, source_type, source_id, scope_type, scope_unit_kind, account_code, set_by, note)
SELECT 'payroll_expense', 'PAY_COMPONENT', code, 'UNIT_KIND', kind, account, 'system',
       'seeded by 0817: overtime is the overtime expense'
  FROM (VALUES ('LEMBUR_JAM_1'), ('LEMBUR_JAM_LANJUT'),
               ('LEMBUR_ISTIRAHAT'), ('LEMBUR_ISTIRAHAT_TINGKAT_2'), ('LEMBUR_ISTIRAHAT_TINGKAT_3'),
               ('LEMBUR_LIBUR'), ('LEMBUR_LIBUR_TINGKAT_2'), ('LEMBUR_LIBUR_TINGKAT_3')) AS c (code)
 CROSS JOIN (VALUES ('STORE', '6013'), ('ONLINE', '6013'), ('HO', '6027')) AS seed (kind, account)
 WHERE EXISTS (SELECT 1 FROM ledger_account a WHERE a.account_code = seed.account)
ON CONFLICT DO NOTHING;
