-- 0465: a cost is filed under a category Finance keeps, and a party may have
-- an account of its own.
--
-- Stage 2 of "Desain Fondasi Finance Dinamis". Before this, a shop could file
-- a cost under nine kinds only — `expense_electricity` … `expense_misc` — held
-- by three CHECK constraints and two lists in the Rust, and an employee claim
-- type was pointed at an account by a regular expression over its code. Adding
-- a tenth kind of cost was a developer's job.
--
-- Now:
--   * `expense_category` is master data Finance edits. The nine keep their
--     codes (the shop app files under them) and gain names.
--   * Which account a category lands on is an account link: role `expense`,
--     source `EXPENSE_CATEGORY`, one link per scope — the same screen as every
--     other link. The nine per-category roles are gone.
--   * A claim type names the category it is filed under; the regular
--     expression is gone.
--   * `party_account` (0301), which nothing ever read, becomes source `PARTY`
--     of `account_link`. The poster asks a line's party first and the company's
--     default second, as ERPNext's get_party_account does.
--
-- The source types a link may come from are widened here once for the stages
-- that follow (pay component, asset class, payment method, tax template,
-- division), so each of them adds data and not another CHECK.

ALTER TABLE account_link DROP CONSTRAINT account_link_source_type_check;
ALTER TABLE account_link ADD CONSTRAINT account_link_source_type_check
    CHECK (source_type IN ('COMPANY', 'EXPENSE_CATEGORY', 'PARTY', 'PAY_COMPONENT',
                           'ASSET_CLASS', 'PAYMENT_METHOD', 'TAX_TEMPLATE', 'DIVISION'));

-- ---------------------------------------------------------------------------
-- 1. Expense categories
-- ---------------------------------------------------------------------------

CREATE TABLE expense_category (
    code        text PRIMARY KEY CHECK (code ~ '^[A-Za-z][A-Za-z0-9_]*$'),
    name        text NOT NULL CHECK (btrim(name) <> ''),
    -- Who files under it: a shop's petty cash and payment asks, an employee's
    -- claim, or both. A category a shop cannot use is not offered at the till.
    for_stores  boolean NOT NULL DEFAULT true,
    for_claims  boolean NOT NULL DEFAULT false,
    is_active   boolean NOT NULL DEFAULT true,
    note        text,
    created_by  text NOT NULL DEFAULT 'system',
    created_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE expense_category IS
    'The kinds of cost a shop or an employee files under (0465). Master data Finance edits; its account is an account_link with role expense and source EXPENSE_CATEGORY.';

INSERT INTO expense_category (code, name, for_stores, for_claims, created_by) VALUES
    ('expense_electricity', 'Listrik',               true, false, 'migration:0465'),
    ('expense_water',       'Air (PDAM)',            true, false, 'migration:0465'),
    ('expense_telephone',   'Telepon & internet',    true, true,  'migration:0465'),
    ('expense_household',   'Rumah tangga',          true, false, 'migration:0465'),
    ('expense_stationery',  'Alat tulis kantor',     true, true,  'migration:0465'),
    ('expense_repairs',     'Perbaikan & perawatan', true, false, 'migration:0465'),
    ('expense_transport',   'Transport lokal',       true, true,  'migration:0465'),
    ('expense_cleaning',    'Kebersihan',            true, false, 'migration:0465'),
    ('expense_misc',        'Lain-lain',             true, true,  'migration:0465');

-- The links move with the categories: what each old role resolved to, per
-- scope, is what the category resolves to now.
INSERT INTO account_link
    (role, source_type, source_id, scope_type, scope_site_kind, scope_site_id,
     account_code, category_code, set_by, set_at, note)
SELECT 'expense', 'EXPENSE_CATEGORY', l.role, l.scope_type, l.scope_site_kind, l.scope_site_id,
       l.account_code, l.category_code, l.set_by, l.set_at, l.note
  FROM account_link l
 WHERE l.source_type = 'COMPANY' AND l.source_id = ''
   AND l.role IN (SELECT code FROM expense_category);

-- Employee claim types become categories of their own, with the links 0372
-- and later claim types gave them.
INSERT INTO expense_category (code, name, for_stores, for_claims, created_by)
SELECT t.code, t.name, false, true, 'migration:0465'
  FROM expense_claim_type t
 WHERE NOT EXISTS (SELECT 1 FROM expense_category c WHERE c.code = t.code);

INSERT INTO account_link
    (role, source_type, source_id, scope_type, scope_site_kind, scope_site_id,
     account_code, category_code, set_by, set_at, note)
SELECT 'expense', 'EXPENSE_CATEGORY', l.source_id, l.scope_type, l.scope_site_kind,
       l.scope_site_id, l.account_code, l.category_code, l.set_by, l.set_at, l.note
  FROM account_link l
 WHERE l.role = 'employee_expense' AND l.source_type = 'COMPANY'
ON CONFLICT (role, source_type, source_id, scope_type, scope_key) DO NOTHING;

DELETE FROM account_link
 WHERE source_type = 'COMPANY'
   AND (role = 'employee_expense' OR role IN (SELECT code FROM expense_category));

-- Owner HR decision 5 as data rather than a word search: a medical claim
-- costs Biaya Kesehatan (6016 at a shop, 6030 at head office) and is owed on
-- 2020 Biaya Pengobatan YMHD; every other claim is owed on the company's
-- `employee_claim_payable` (2031).
INSERT INTO expense_category (code, name, for_stores, for_claims, created_by)
VALUES ('MEDICAL', 'Kesehatan & pengobatan', false, true, 'migration:0465')
ON CONFLICT (code) DO NOTHING;
INSERT INTO account_link
    (role, source_type, source_id, scope_type, scope_site_kind, account_code, set_by, note)
VALUES ('expense', 'EXPENSE_CATEGORY', 'MEDICAL', 'SITE_KIND', 'STORE', '6016', 'migration:0465', 'owner HR decision 5'),
       ('expense', 'EXPENSE_CATEGORY', 'MEDICAL', 'SITE_KIND', 'HO',    '6030', 'migration:0465', 'owner HR decision 5')
ON CONFLICT (role, source_type, source_id, scope_type, scope_key) DO NOTHING;
INSERT INTO account_link
    (role, source_type, source_id, scope_type, account_code, set_by, note)
SELECT 'employee_claim_payable', 'EXPENSE_CATEGORY', 'MEDICAL', l.scope_type, l.account_code,
       'migration:0465', 'owner HR decision 5'
  FROM account_link l
 WHERE l.role = 'employee_claim_payable' AND l.source_type = 'COMPANY' AND l.source_id = 'MEDICAL'
   AND l.scope_type = 'ALL'
ON CONFLICT (role, source_type, source_id, scope_type, scope_key) DO NOTHING;
DELETE FROM account_link
 WHERE role = 'employee_claim_payable' AND source_type = 'COMPANY' AND source_id = 'MEDICAL';

-- Which kinds of account a cost may land on: what the nine and the claim
-- types landed on, and a prepaid or an asset for a cost that is one.
INSERT INTO posting_role (role, allowed_account_types, note)
VALUES ('expense', ARRAY['EXPENSE', 'PREPAID', 'FIXED_ASSET', 'COST_OF_GOODS_SOLD'],
        'the account an expense category lands on (0465)')
ON CONFLICT (role) DO UPDATE SET allowed_account_types = EXCLUDED.allowed_account_types;
DELETE FROM posting_role
 WHERE role = 'employee_expense' OR role IN (SELECT code FROM expense_category);

-- The three lists become one foreign key each.
ALTER TABLE store_expense DROP CONSTRAINT store_expense_category_check;
ALTER TABLE store_expense
    ADD CONSTRAINT store_expense_category_fkey FOREIGN KEY (category) REFERENCES expense_category (code);
ALTER TABLE fund_settlement DROP CONSTRAINT fund_settlement_expense_key_check;
ALTER TABLE fund_settlement
    ADD CONSTRAINT fund_settlement_expense_key_fkey FOREIGN KEY (expense_key) REFERENCES expense_category (code);
ALTER TABLE payment_instruction DROP CONSTRAINT payment_instruction_category_check;
ALTER TABLE payment_instruction
    ADD CONSTRAINT payment_instruction_category_fkey FOREIGN KEY (category) REFERENCES expense_category (code);

-- A claim type is filed under a category, chosen by whoever defines it.
ALTER TABLE expense_claim_type
    ADD COLUMN expense_category_code text REFERENCES expense_category (code);
UPDATE expense_claim_type SET expense_category_code = code WHERE expense_category_code IS NULL;

-- ---------------------------------------------------------------------------
-- 2. A party's own account (ERPNext Party Account)
-- ---------------------------------------------------------------------------

-- source_id is `PARTY_TYPE:party_id` — `SUPPLIER:SUP-0012`, `EMPLOYEE:emp-7`.
INSERT INTO account_link
    (role, source_type, source_id, scope_type, scope_site_id, account_code, set_by, set_at, note)
SELECT CASE pt.account_type WHEN 'RECEIVABLE' THEN 'receivable' ELSE 'trade_payable' END,
       'PARTY', pa.party_type || ':' || pa.party_id, 'SITE', pa.site_id, pa.account_code,
       pa.set_by, pa.set_at, 'from party_account (0301)'
  FROM party_account pa
  JOIN party_type pt ON pt.party_type = pa.party_type;

DROP TABLE party_account;
