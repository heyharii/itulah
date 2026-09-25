-- 0372: HR claims get an account of their own.
--
-- 0371 connected the meanings a posting writer names to an active client leaf,
-- but for two HR meanings it had to choose a neighbouring account:
--
--   * `employee_expense`     -> `6064 Miscellaneous Expences` for a claim that
--                              names no specific expense;
--   * `employee_claim_payable` -> `2031 Hutang Lain - Lain`, which is also
--                              principal, affiliate and anything else that has
--                              no better home.
--
-- The owner asked for the two accounts the distinction deserves. This migration
-- mints them, points the meanings at them, and leaves every other 0371 mapping
-- alone:
--
--   2049 Hutang Klaim Karyawan   under 2016 ACCRUED EXPENSE
--   6076 Biaya Klaim Karyawan    under 6025 BEBAN PEGAWAI
--
-- A claim that names a specific expense still draws that expense's leaf —
-- medical to 6016/6030, travel to 6047, and so on — so the specific reports are
-- unchanged. What moves is the claim that named nothing else, and the liability
-- side, which is now its own balance instead of "Hutang Lain - Lain".

-- ── the two leaves ─────────────────────────────────────────────────────────
INSERT INTO ledger_account
    (account_code, name, name_en, parent_code, is_group, is_active, dimension,
     normal_balance, is_contra, category_family, requires_counter_site,
     posting_mode, manual_je_policy, posting_policy_configured, code_provenance,
     statement_section)
VALUES
    ('2049', 'Hutang Klaim Karyawan', 'Employee claims payable', '2016',
     FALSE, TRUE, 'unit', 'C', FALSE, NULL, FALSE,
     'MANUAL', 'YES', TRUE, 'PENDING_CLIENT_CODE', 'LIABILITY'),
    ('6076', 'Biaya Klaim Karyawan', 'Employee claims', '6025',
     FALSE, TRUE, 'unit', 'D', FALSE, NULL, FALSE,
     'MANUAL', 'YES', TRUE, 'PENDING_CLIENT_CODE', 'OPERATING_EXPENSE');

-- ── employee_expense: the general claim, not Miscellaneous ────────────────
--
-- Two shapes to repair: the 0371 fallback at 6064, and any row the old
-- `define_claim_type` planted at the retired `6010210014`. A specific type
-- that already resolves to an active leaf keeps it.
UPDATE account_map mapping
   SET account_code = '6076',
       category_code = NULL,
       set_by = 'migration:0372',
       set_at = now(),
       note = 'General employee claim; 6076 Biaya Klaim Karyawan'
 WHERE mapping.semantic_key = 'employee_expense'
   AND (
        mapping.account_code IN ('6064', '6010210014')
        OR EXISTS (
            SELECT 1 FROM ledger_account account
             WHERE account.account_code = mapping.account_code
               AND (NOT account.is_active OR account.is_group)
        )
   );

-- ── employee_claim_payable: every site, its own liability ──────────────────
INSERT INTO account_map
    (semantic_key, site_id, qualifier, account_code, category_code, set_by, note)
SELECT 'employee_claim_payable', site.id, '', '2049', NULL, 'migration:0372',
       'Hutang Klaim Karyawan; a dedicated leaf instead of Hutang Lain - Lain'
  FROM site
ON CONFLICT (semantic_key, site_id, qualifier) DO UPDATE
    SET account_code = EXCLUDED.account_code,
        category_code = NULL,
        set_by = EXCLUDED.set_by,
        set_at = now(),
        note = EXCLUDED.note;

DO $$
DECLARE
    missing bigint;
BEGIN
    SELECT count(*) INTO missing
      FROM account_map mapping
      JOIN ledger_account account USING (account_code)
     WHERE mapping.set_by = 'migration:0372'
       AND (NOT account.is_active OR account.is_group);

    IF missing <> 0 THEN
        RAISE EXCEPTION '0372 installed % mappings that do not resolve to active leaf accounts', missing;
    END IF;
END;
$$;
