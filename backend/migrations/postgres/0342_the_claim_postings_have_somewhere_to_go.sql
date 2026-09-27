-- The claim postings have somewhere to go.
--
-- Two meanings were declared for the claims lane (see
-- `required_semantic_keys`): `employee_expense`, the Dr side of an approved
-- claim, one posting line per claim type with the type code as the qualifier;
-- and `employee_claim_payable`, the Cr side that holds what the company owes
-- the employee until the petty-cash payout clears it.
--
-- # Why only the payable is seeded here
--
-- `employee_claim_payable` is unqualified: one pair per site, mapped now, in
-- the 0313 mould. `employee_expense` is QUALIFIED — the qualifier is the claim
-- type code, and the map resolves a qualifier EXACTLY, never falling back — so
-- its rows arrive with the types themselves: defining the first claim type
-- maps it at every site in the same transaction, and an unmapped type refuses
-- by name at approval rather than posting somewhere guessed. Seeding an
-- unqualified row here instead would mark the pair "mapped" on the Account Map
-- screen while every actual posting still refused — the report would lie in
-- the one direction that hides a gap. (Deviation from the phase-2 spec's
-- "qualifier '' for the map pair", forced by `resolve_account`'s exact match;
-- recorded in the claims module doc.)
--
-- # The account the debits land on
--
-- `6010210014 Klaim Karyawan`, minted under the client's own `60102 Beban
-- Pegawai` rung, with NO category family. `6201` was the other candidate and
-- is wrong by one dimension: its family is `pay_component`, so every claim
-- line would have to carry a payslip component as its category, which would
-- make TRAVEL mean "Uang Transport" and mean nothing the decider sanctioned.
-- The claim type answers "which one", and it already has a home: the
-- qualifier. Every type's qualifier points at this one leaf today, so Finance
-- can split the leaf per type later without a change to the posting rule —
-- the same shape `card_receivable` keeps its acquirers on. The code is the
-- next free number on the client's own ladder, awaiting their name for it —
-- the 0277 discipline, and it is declared in `tests/accounting_closure.rs`.
--
-- # The payable's category
--
-- `2301 Biaya masih harus dibayar` is where an approved-but-unpaid expense
-- already lives; its `accrual_kind` family held the client's ten YMHD kinds
-- and none of them is an employee claim, so this migration adds the eleventh
-- rather than posting claims under somebody's salary accrual — the 0296
-- discipline: the family grows when the company has a question it cannot
-- answer with the names it has.

-- The category the payable carries. One kind, the claim itself: the employee
-- the debt is owed TO is the line's party (0300), not its category. It comes
-- before the map row, because `account_map.category_code` points here.
INSERT INTO line_category (category_code, family, name, sort_order, legacy_code)
VALUES ('BIAYA_KLAIM_KARYAWAN_YMHD', 'accrual_kind', 'Biaya Klaim Karyawan YMHD', 23,
        '2012201011')
ON CONFLICT (category_code) DO NOTHING;

-- The payable: mapped at every place that can owe, in the 0313 mould. An
-- org_place of kind HO carries no site, and head office posts at
-- HEAD_OFFICE_SITE (`dc`), so the join falls back to `dc` — the same rule
-- `pay.rs` uses to find a posting's site.
INSERT INTO account_map (semantic_key, site_id, qualifier, account_code, category_code, set_by)
SELECT 'employee_claim_payable', COALESCE(p.site_id, 'dc'), '', '2301',
       'BIAYA_KLAIM_KARYAWAN_YMHD', '0342'
  FROM org_place p
ON CONFLICT (semantic_key, site_id, qualifier) DO NOTHING;

-- The expense leaf, minted, on the client's own rung. `statement_section`
-- is 0318's declaration, and a staff-claim reimbursement is an operating
-- expense whatever the COA parent says.
INSERT INTO ledger_account
    (account_code, name, name_en, parent_code, is_group, is_active, dimension,
     normal_balance, is_contra, category_family, requires_counter_site,
     posting_mode, manual_je_policy, posting_policy_configured, code_provenance,
     statement_section)
VALUES
    ('6010210014', 'Klaim Karyawan', 'Employee claims', '60102', FALSE, TRUE, 'unit',
     'D', FALSE, NULL, FALSE, 'AUTO_ONLY', 'NO', TRUE, 'PENDING_CLIENT_CODE',
     'OPERATING_EXPENSE')
ON CONFLICT (account_code) DO NOTHING;

-- And the source kinds the two claim postings arrive under, in the 0298 mould.
ALTER TABLE journal_entry DROP CONSTRAINT IF EXISTS journal_entry_source_kind_check;
ALTER TABLE journal_entry ADD CONSTRAINT journal_entry_source_kind_check
    CHECK (source_kind IN (
        'ACQ_SETTLEMENT', 'ADJUSTMENT', 'ADVANCE', 'AMORTIZATION_RUN',
        'ASSET_CAPITALIZATION', 'ASSET_DISPOSAL', 'ASSET_RESERVE',
        'ASSET_TRANSFER', 'BANK_STATEMENT', 'CASH_COUNT', 'CASH_DOC',
        'CASH_SHIFT', 'COGS_DAY', 'CREDIT_NOTE', 'DEPOSIT', 'DEPRECIATION',
        'EQUITY_MOVEMENT', 'EXPENSE_CLAIM', 'EXPENSE_CLAIM_PAYOUT', 'GIRO',
        'GOODS_RECEIPT', 'INTERUNIT_SETTLE',
        'LANDED_COST', 'MANUAL', 'OPENING', 'PAYMENT', 'PAYROLL_RUN',
        'PETTY_REPLENISH', 'PREPAID_ALLOCATION', 'RECLASS', 'REMITTANCE',
        'RETENDER', 'REVERSAL', 'SALE_DAY', 'STOCK_COUNT', 'STORE_DEPOSIT',
        'STORE_EXPENSE', 'SUPPLIER_ADVANCE', 'SUPPLIER_INVOICE',
        'TAX_SETTLEMENT', 'TRANSFER', 'VOUCHER_ISSUE', 'WRITE_OFF'
    ));

COMMENT ON COLUMN journal_entry.source_kind IS
    'What caused this entry. EQUITY_MOVEMENT is an owner putting capital in,
     taking drawings out, lending to the company or being repaid — see 0284.
     VOUCHER_ISSUE is a card being written: the credit is the client''s 65 and
     the debit is where the money behind it came from — cash for a gift card, a
     return for a refund card, 74 Biaya Promosi for a giveaway. See 0298.
     EXPENSE_CLAIM is an approved claim being sanctioned into the books and
     EXPENSE_CLAIM_PAYOUT the petty-cash payout that settles it — see 0341.';

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM org_place p
                WHERE NOT EXISTS (SELECT 1 FROM account_map m
                                   WHERE m.semantic_key = 'employee_claim_payable'
                                     AND m.site_id = COALESCE(p.site_id, 'dc')
                                     AND m.qualifier = '')) THEN
        RAISE EXCEPTION 'a place has no employee_claim_payable mapping';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM line_category
                    WHERE category_code = 'BIAYA_KLAIM_KARYAWAN_YMHD'
                      AND family = 'accrual_kind') THEN
        RAISE EXCEPTION 'the accrual_kind for employee claims did not install';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM ledger_account
                    WHERE account_code = '6010210014'
                      AND NOT is_group AND is_active
                      AND posting_policy_configured
                      AND category_family IS NULL) THEN
        RAISE EXCEPTION 'the employee claim expense leaf did not install postable and family-free';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conname = 'journal_entry_source_kind_check'
                      AND pg_get_constraintdef(oid) LIKE '%EXPENSE_CLAIM_PAYOUT%') THEN
        RAISE EXCEPTION 'EXPENSE_CLAIM_PAYOUT is not allowed as a source kind';
    END IF;
END $$;
