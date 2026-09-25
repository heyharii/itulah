-- 0377: the owner's corrections to 0376 and the rest of the 25 Sep decisions.
--
-- Applied from FINANCE-CONNECT-BRIEF.md and the review of 0376:
--   * accounts the owner retired are not used at all;
--   * `cash_in_transit` is deleted — it resolved to 1002, so the step was a
--     no-op (the store's remittance now posts 1057/1002 directly, see
--     `store_deposit_hand_over`);
--   * PPN is ignored for now: no `vat_out` on a sale and no `vat_in` on a bill,
--     so the meanings are removed rather than left pointing at accounts nothing
--     should reach;
--   * bank accounts per unit stay allowed. 0376's guard covers external
--     LIABILITIES (2002/2004, giro, loans), not a unit's own bank account, and
--     nothing here widens it.

-- ── 1. accounts not used ───────────────────────────────────────────────────
-- 2003 was retired by 0375. These four are the owner's list: no online sales,
-- no disposed-inventory account, and giro clearing is 2005–2009 outstanding, not
-- 2032 "Giro Keluar".
UPDATE ledger_account
   SET is_active = FALSE,
       posting_mode = 'BLOCKED',
       manual_je_policy = 'NO',
       posting_policy_configured = TRUE
 WHERE account_code IN ('4009', '4010', '1110', '2032');

-- ── 2. meanings that no longer exist ───────────────────────────────────────
-- A deleted meaning is refused by `resolve_account` with a sentence naming the
-- key, which is what the brief wants for a line that still tries to use one.
DELETE FROM account_map WHERE semantic_key IN ('cash_in_transit', 'vat_out', 'vat_in');

-- `6002 Pendapatan lain-lain` stays MANUAL (0348 set it so) and no meaning maps
-- to it — only a Finance HO manual journal may reach it. Assert that here so a
-- later map row cannot quietly open an automatic path into it.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM account_map WHERE account_code = '6002') THEN
        RAISE EXCEPTION 'a meaning maps to 6002 Pendapatan lain-lain; it is manual-only';
    END IF;
    IF EXISTS (
        SELECT 1 FROM account_map m JOIN ledger_account a USING (account_code)
         WHERE NOT a.is_active OR a.is_group
    ) THEN
        RAISE EXCEPTION 'a map row points at a retired or heading account';
    END IF;
END;
$$;
