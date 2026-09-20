-- Every document that named an account now names one of the forty.
--
-- 0290 moved the map, which is how a RULE chooses an account. This migration
-- moves the other nineteen places: the columns where a DOCUMENT wrote an
-- account down and kept it — a bank account's ledger code, a deposit's drawer
-- and bank, a prepaid schedule's two sides, a bill's expense line, a statement's
-- account. Each is a row that will post again, and a row that posts to a
-- BLOCKED account fails at the moment somebody presses the button.
--
-- It also finishes the asset-register move 0287 started.
--
-- # The asset class, and the bug that falls out with it
--
-- `fixed_asset.category_code` and `asset_class_reserve.class_code` have been
-- foreign keys into `ledger_account`, which is to say the asset register has
-- been using the chart of accounts as its list of asset types. That was always
-- a borrow, and it has been broken in a way nobody could see from either side:
-- `import_client_assets.py` writes the client's ten-character sub-type
-- (`1021507027`, "OE - Rak 27"), while `seed-finance.py` maps the account-map
-- qualifier at seven (`1021507`, the family). An imported asset therefore
-- matched no qualifier, `resolve_account` refused it, and the depreciation run
-- declined to depreciate the 1,328 assets the client's own register gave us.
--
-- Both columns now point at `asset_class`, where a class is a class and the
-- length of a string means nothing. The data moves by the table below, which
-- reads both shapes: a ten-character code is the client's own template and maps
-- exactly; a seven-character code is a family, which the seed used as a
-- stand-in for its first member and which maps to that member. Anything that is
-- neither stops the migration, because a silently unclassified asset is how the
-- bug above lasted this long.
--
-- # What is left alone, again
--
-- `journal_line`, for the reason 0290 gives. `account_source_rule` and
-- `account_category_policy` are already on the new codes. The old rows keep
-- their old accounts and their old postings; only what will post next moves.

-- client asset template code -> asset_class.class_code, 60 rows
CREATE TEMP TABLE asset_class_from_code (legacy TEXT PRIMARY KEY, class_code TEXT NOT NULL) ON COMMIT DROP;
INSERT INTO asset_class_from_code (legacy, class_code) VALUES
    ('1021501001', 'TANAH_HAK_MILIK'),
    ('1021501002', 'HAK_SEWA_TANAH_HGB'),
    ('1021502001', 'BANGUNAN_UTAMA'),
    ('1021502002', 'BANGUNAN_TAMBAHAN'),
    ('1021502003', 'BANGUNAN_STAFF_HOUSE_MESS'),
    ('1021503001', 'INSTALASI_MEKANIKAL_ELEKTRIKAL'),
    ('1021504001', 'AIR_CONDITIONER'),
    ('1021504002', 'LIFT'),
    ('1021504003', 'ESKALATOR'),
    ('1021504004', 'GENSET'),
    ('1021505001', 'MOBIL'),
    ('1021505002', 'SEPEDA_MOTOR'),
    ('1021506001', 'FFE_OFFICE'),
    ('1021506002', 'FFE_TOKO_DAN_GUDANG'),
    ('1021506003', 'FFE_KOMPUTER'),
    ('1021506004', 'FFE_MUSIC'),
    ('1021506005', 'FFE_STAFF_HOUSE_MESS'),
    ('1021506006', 'FFE_INTERIOR'),
    ('1021506007', 'FFE_EXTERIOR'),
    ('1021507001', 'OE_RAK_1'),
    ('1021507002', 'OE_RAK_2'),
    ('1021507003', 'OE_RAK_3'),
    ('1021507004', 'OE_RAK_4'),
    ('1021507005', 'OE_PAJANGAN_GANTUNGAN_2'),
    ('1021507006', 'OE_PAJANGAN_GANTUNGAN_4'),
    ('1021507007', 'OE_PAJANGAN_GANTUNGAN_6'),
    ('1021507008', 'OE_PAJANGAN_GANTUNGAN_LAIN_LAIN'),
    ('1021507009', 'OE_MEJA_1'),
    ('1021507010', 'OE_MEJA_2'),
    ('1021507011', 'OE_MEJA_3'),
    ('1021507012', 'OE_BOX_OB_KAYU'),
    ('1021507013', 'OE_BOX_OB_BESI'),
    ('1021507014', 'OE_HOLO'),
    ('1021507015', 'OE_BREKET'),
    ('1021507016', 'OE_BELALAI'),
    ('1021507017', 'OE_PATUNG_FULL_BODI_DEWASA'),
    ('1021507018', 'OE_PATUNG_FULL_BODI_ANAK'),
    ('1021507019', 'OE_PATUNG_SETENGAH_BADAN_PRIA'),
    ('1021507020', 'OE_PATUNG_SETENGAH_BADAN_WANITA_1'),
    ('1021507021', 'OE_PATUNG_SETENGAH_BADAN_WANITA_2'),
    ('1021507022', 'OE_PATUNG_SETENGAH_BADAN_ANAK'),
    ('1021507023', 'OE_PATUNG_KEPALA_DEWASA'),
    ('1021507024', 'OE_PATUNG_KEPALA_ANAK'),
    ('1021507025', 'OE_PATUNG_KAKI_DEWASA'),
    ('1021507026', 'OE_PATUNG_KAKI_ANAK'),
    ('1021507027', 'OE_HANGER_WANITA_ABG'),
    ('1021507028', 'OE_HANGER_PRIA'),
    ('1021507029', 'OE_HANGER_JACKET'),
    ('1021507030', 'OE_HANGER_KAYU_ANAK'),
    ('1021507031', 'OE_HANGER_BODY_STELAN'),
    ('1021507032', 'OE_HANGER_JEPIT_DEWASA'),
    ('1021507033', 'OE_HANGER_JEPIT_ANAK'),
    ('1021507034', 'OE_HANGER_GAMIS_IBU'),
    ('1021507035', 'OE_PIN_KAWAT_SENSOR'),
    ('1021507036', 'OE_TAS_KERANJANG_BELANJA'),
    ('1021701001', 'SEVENTH_SOFT_APPLICATION'),
    ('1021701002', 'OPTI_TEX_SYSTEM'),
    ('1031802001', 'PRE_OPENING'),
    ('1031802002', 'AKUMULASI_AMORTISASI_PRE_OPENING'),
    ('1031803001', 'CONTRACT_IN_PROGRESS');

INSERT INTO asset_class_from_code (legacy, class_code)
SELECT DISTINCT left(legacy, 7), class_code
  FROM asset_class_from_code
 WHERE right(legacy, 3) = '001'
   AND NOT EXISTS (SELECT 1 FROM asset_class_from_code b WHERE b.legacy = left(asset_class_from_code.legacy, 7));

DO $$
DECLARE
    stray TEXT;
BEGIN
    SELECT string_agg(DISTINCT v, ', ') INTO stray FROM (
        SELECT category_code AS v FROM fixed_asset
        UNION SELECT class_code FROM asset_class_reserve
        UNION SELECT class_code FROM asset_replacement_rate
        UNION SELECT class_code FROM asset_replacement_charge
        UNION SELECT asset_class_code FROM supplier_invoice_expense_line WHERE asset_class_code IS NOT NULL
    ) t WHERE v IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM asset_class_from_code m WHERE m.legacy = t.v);
    IF stray IS NOT NULL THEN
        RAISE EXCEPTION
            'these asset classes are neither a client template nor a family: %. '
            'Give them a row in 0287 rather than letting an asset through '
            'unclassified', stray;
    END IF;
END $$;

-- `asset_class_reserve` is itself referenced by the rate and the charge, so the
-- class code has to move in all three at once. Dropping their keys first is not
-- a shortcut around the constraint — it is the only order in which a shared
-- identifier can be rewritten without the database seeing a moment where the
-- children point at a parent that has already moved.
ALTER TABLE asset_replacement_rate DROP CONSTRAINT IF EXISTS asset_replacement_rate_class_code_fkey;
ALTER TABLE asset_replacement_charge DROP CONSTRAINT IF EXISTS asset_replacement_charge_class_code_fkey;
ALTER TABLE fixed_asset DROP CONSTRAINT IF EXISTS fixed_asset_category_code_fkey;
ALTER TABLE asset_class_reserve DROP CONSTRAINT IF EXISTS asset_class_reserve_class_code_fkey;
ALTER TABLE supplier_invoice_expense_line
    DROP CONSTRAINT IF EXISTS supplier_invoice_expense_line_asset_class_code_fkey;

UPDATE fixed_asset a SET category_code = m.class_code
  FROM asset_class_from_code m WHERE m.legacy = a.category_code;
UPDATE asset_class_reserve r SET class_code = m.class_code
  FROM asset_class_from_code m WHERE m.legacy = r.class_code;
-- `asset_replacement_rate` is append-only, and its guard says why: "a reserve
-- rate is appended, not updated: set a new one from the month it changes, and
-- the charges already posted keep saying what they were charged at". That is
-- the right rule and it is about the RATE. What moves here is the name of the
-- class the rate is for — the same class, spelled the way the register spells
-- it from now on — and no rate, month or charge changes by a basis point.
--
-- Disabled explicitly and turned back on in the same transaction, so the window
-- in which the guard is off is this statement and nothing else.
ALTER TABLE asset_replacement_rate DISABLE TRIGGER asset_replacement_rate_append_only;
UPDATE asset_replacement_rate r SET class_code = m.class_code
  FROM asset_class_from_code m WHERE m.legacy = r.class_code;
ALTER TABLE asset_replacement_rate ENABLE TRIGGER asset_replacement_rate_append_only;
UPDATE asset_replacement_charge c SET class_code = m.class_code
  FROM asset_class_from_code m WHERE m.legacy = c.class_code;
UPDATE supplier_invoice_expense_line l SET asset_class_code = m.class_code
  FROM asset_class_from_code m WHERE m.legacy = l.asset_class_code;

ALTER TABLE fixed_asset ADD CONSTRAINT fixed_asset_category_code_fkey
    FOREIGN KEY (category_code) REFERENCES asset_class (class_code);
ALTER TABLE asset_class_reserve ADD CONSTRAINT asset_class_reserve_class_code_fkey
    FOREIGN KEY (class_code) REFERENCES asset_class (class_code);
ALTER TABLE asset_replacement_rate ADD CONSTRAINT asset_replacement_rate_class_code_fkey
    FOREIGN KEY (class_code) REFERENCES asset_class_reserve (class_code);
ALTER TABLE asset_replacement_charge ADD CONSTRAINT asset_replacement_charge_class_code_fkey
    FOREIGN KEY (class_code) REFERENCES asset_class_reserve (class_code);
ALTER TABLE supplier_invoice_expense_line ADD CONSTRAINT supplier_invoice_expense_line_asset_class_code_fkey
    FOREIGN KEY (asset_class_code) REFERENCES asset_class (class_code);

-- # The bank account's ledger code, and why the constraint comes back NOT VALID
--
-- `journal_line_bank_account_agrees_with_the_account_posted` is a three-column
-- foreign key — (bank_account_id, account_code, site_id) into
-- (account_id, ledger_account_code, site_id) — and it is a good constraint:
-- it makes it impossible to post to BCA's ledger account while naming Mandiri's
-- bank account. But it ties every journal line ever written to the ledger code
-- the bank account carries TODAY, so moving that code to `1102` would orphan
-- every bank line already posted, and Postgres would refuse the UPDATE rather
-- than let it happen.
--
-- The line that has already been posted is not wrong; it agreed with the chart
-- on the day it was written. So the constraint is dropped, the code moved, and
-- the constraint added back NOT VALID: new rows are checked exactly as before,
-- and the rows that predate the chart are left to their own account. That is
-- the same choice 0290 makes about `journal_line` in general, expressed in the
-- only way a foreign key can express it.

-- Three tables bind a row to the ledger code its bank account carried at the
-- time: the journal, and the two halves of statement intake. All three keys say
-- the same true thing — you may not post to BCA's ledger account while naming
-- Mandiri's bank account — and all three have to stand aside while the code
-- underneath them moves.
ALTER TABLE journal_line DROP CONSTRAINT IF EXISTS journal_line_bank_account_agrees_with_the_account_posted;
ALTER TABLE bank_statement DROP CONSTRAINT IF EXISTS bank_statement_account_agrees_with_its_ledger_binding;
ALTER TABLE bank_statement_source DROP CONSTRAINT IF EXISTS bank_statement_source_account_agrees_with_its_ledger_binding;
-- And a statement's own lines carry the account with it, so that a line cannot
-- be moved to a statement for a different account. They move together.
ALTER TABLE bank_statement_line DROP CONSTRAINT IF EXISTS bank_statement_line_statement_id_account_code_fkey;

-- Kept, not overwritten. Fourteen bank accounts collapse onto one `1102`, so
-- the account code stops being able to say which bank a line was about — that
-- is now `bank_account_id`, which is better, except for one thing: an
-- accountant asking for a trial balance in their own numbers needs `1011002001`
-- back, and after the UPDATE below nothing would remember it. This column is
-- what `legacy_account_code()` reads in 0292.
ALTER TABLE company_bank_account ADD COLUMN legacy_ledger_account_code TEXT;
UPDATE company_bank_account SET legacy_ledger_account_code = ledger_account_code;

UPDATE company_bank_account b SET ledger_account_code = r.new_code
  FROM ledger_account_remap r WHERE r.legacy_code = b.ledger_account_code;

ALTER TABLE journal_line ADD CONSTRAINT journal_line_bank_account_agrees_with_the_account_posted
    FOREIGN KEY (bank_account_id, account_code, site_id)
    REFERENCES company_bank_account (account_id, ledger_account_code, site_id) NOT VALID;

-- The remaining columns, each a document's own note of which account it will
-- post to next. The two statement tables come first, and their keys go back on
-- immediately after, because unlike the journal they CAN be brought into
-- agreement: a statement has not been posted yet, so moving it is not rewriting
-- anything that happened.
UPDATE bank_statement d SET account_code = r.new_code
  FROM ledger_account_remap r WHERE r.legacy_code = d.account_code;
UPDATE bank_statement_source d SET account_code = r.new_code
  FROM ledger_account_remap r WHERE r.legacy_code = d.account_code;
UPDATE bank_statement_line d SET account_code = r.new_code
  FROM ledger_account_remap r WHERE r.legacy_code = d.account_code;

ALTER TABLE bank_statement_line ADD CONSTRAINT bank_statement_line_statement_id_account_code_fkey
    FOREIGN KEY (statement_id, account_code) REFERENCES bank_statement (statement_id, account_code);
ALTER TABLE bank_statement ADD CONSTRAINT bank_statement_account_agrees_with_its_ledger_binding
    FOREIGN KEY (bank_account_id, account_code, site_id)
    REFERENCES company_bank_account (account_id, ledger_account_code, site_id);
ALTER TABLE bank_statement_source ADD CONSTRAINT bank_statement_source_account_agrees_with_its_ledger_binding
    FOREIGN KEY (bank_account_id, account_code, site_id)
    REFERENCES company_bank_account (account_id, ledger_account_code, site_id);

UPDATE advance_settlement d SET account_code = r.new_code
  FROM ledger_account_remap r WHERE r.legacy_code = d.account_code;
UPDATE cash_count d SET account_code = r.new_code
  FROM ledger_account_remap r WHERE r.legacy_code = d.account_code;
UPDATE prepaid_schedule d SET prepaid_account_code = r.new_code
  FROM ledger_account_remap r WHERE r.legacy_code = d.prepaid_account_code;
UPDATE prepaid_schedule d SET expense_account_code = r.new_code
  FROM ledger_account_remap r WHERE r.legacy_code = d.expense_account_code;
UPDATE store_deposit d SET drawer_account_code = r.new_code
  FROM ledger_account_remap r WHERE r.legacy_code = d.drawer_account_code;
UPDATE store_deposit d SET bank_account_code = r.new_code
  FROM ledger_account_remap r WHERE r.legacy_code = d.bank_account_code;
UPDATE supplier_credit_note d SET credit_account_code = r.new_code
  FROM ledger_account_remap r WHERE r.legacy_code = d.credit_account_code;
UPDATE supplier_invoice_expense_line d SET account_code = r.new_code
  FROM ledger_account_remap r WHERE r.legacy_code = d.account_code;

DO $$
DECLARE
    stale TEXT;
BEGIN
    SELECT string_agg(t, ', ') INTO stale FROM (
        SELECT 'advance_settlement' t FROM advance_settlement d JOIN ledger_account a USING (account_code) WHERE NOT a.is_active
        UNION SELECT 'bank_statement' FROM bank_statement d JOIN ledger_account a USING (account_code) WHERE NOT a.is_active
        UNION SELECT 'bank_statement_source' FROM bank_statement_source d JOIN ledger_account a USING (account_code) WHERE NOT a.is_active
        UNION SELECT 'cash_count' FROM cash_count d JOIN ledger_account a USING (account_code) WHERE NOT a.is_active
        UNION SELECT 'company_bank_account' FROM company_bank_account b JOIN ledger_account a ON a.account_code = b.ledger_account_code WHERE NOT a.is_active
        UNION SELECT 'prepaid_schedule.prepaid' FROM prepaid_schedule d JOIN ledger_account a ON a.account_code = d.prepaid_account_code WHERE NOT a.is_active
        UNION SELECT 'prepaid_schedule.expense' FROM prepaid_schedule d JOIN ledger_account a ON a.account_code = d.expense_account_code WHERE NOT a.is_active
        UNION SELECT 'store_deposit.drawer' FROM store_deposit d JOIN ledger_account a ON a.account_code = d.drawer_account_code WHERE NOT a.is_active
        UNION SELECT 'store_deposit.bank' FROM store_deposit d JOIN ledger_account a ON a.account_code = d.bank_account_code WHERE NOT a.is_active
        UNION SELECT 'supplier_credit_note' FROM supplier_credit_note d JOIN ledger_account a ON a.account_code = d.credit_account_code WHERE NOT a.is_active
        UNION SELECT 'supplier_invoice_expense_line' FROM supplier_invoice_expense_line d JOIN ledger_account a USING (account_code) WHERE NOT a.is_active
    ) x;
    IF stale IS NOT NULL THEN
        RAISE EXCEPTION 'these still name a retired account and would fail at posting time: %', stale;
    END IF;
END $$;
