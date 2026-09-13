-- A party we owe is not always a supplier of goods.
--
-- The client's chart has said this all along, in three accounts:
--
--   2012001001  Hutang Suppliers Barang Dagangan
--   2012001003  Hutang Supplier Non Barang Dagang
--   2012301xxx  Hutang Affiliasi … (fourteen units)
--
-- and in an accrual list that names the bills it expects every month:
-- electricity (2012201007), water (…08), telephone (…06), shop rent (…09),
-- staff-house rent (…10), BPJS (…05).
--
-- Migration 0094 already taught the BILL to be about something other than
-- goods. What it did not do is teach the PARTY: `supplier` is one flat list,
-- so PLN, the landlord and a garment factory sit in the same book with the
-- same columns, and the only way to tell them apart is to read the name.
--
-- # Why a column and not a second table
--
-- The same argument 0094 made about invoices, and for the same reason. What a
-- party IS does not differ: a name, a code, contact details, payment terms,
-- bills, ageing, payments, a balance. A `vendor` table beside `supplier` would
-- mean payables ageing, the payment allocation, the unbilled report and every
-- balance needing a second half that agrees with the first — and the day they
-- disagree is the day somebody's balance is wrong.
--
-- What genuinely differs is two things, and they are both here: which of the
-- two payable accounts the bill lands in, and which expense account it debits
-- by default. Everything else is one book.
--
-- # Why two MENUS all the same
--
-- Because the work differs even where the record does not. Merchandise runs
-- weekly against a purchase order and a goods receipt, and the question is
-- "did the delivery match". PLN and the landlord run monthly against a meter
-- reading or a contract, and the question is "is this the usual amount". One
-- screen would carry a PO column that is empty for half its rows. The
-- prototype in `finance-lab/vendors.tsx` reached the same conclusion from the
-- same three accounts, before this table knew anything about it.
--
-- # The default account, and why only non-merchandise carries one
--
-- A merchandise bill knows where it posts: inventory, by rule. An expense bill
-- does not — and asking somebody to type "Biaya Pemakaian Listrik" onto
-- fourteen identical PLN bills every month is how the wrong account ends up on
-- the fourteenth. So a non-merchandise party may name the account its bills
-- usually debit; the bill still carries the account, and a person may still
-- change it, which is what `CHECK` below leaves room for.

ALTER TABLE supplier
    ADD COLUMN category text NOT NULL DEFAULT 'MERCHANDISE'
        CHECK (category IN ('MERCHANDISE', 'EXPENSE', 'AFFILIATE')),
    -- The account this party's bills usually debit. Free text, and
    -- deliberately not a foreign key to the account table: this column holds
    -- the client's own code, the chart is loaded per node, and a party whose
    -- account has not been imported yet is still a party we owe money to.
    ADD COLUMN expense_account_code text
        CHECK (expense_account_code IS NULL OR btrim(expense_account_code) <> ''),
    -- A merchandise supplier's bills debit inventory by rule, so a default
    -- expense account on one would be a rule nobody reads fighting a rule
    -- everybody does.
    ADD CONSTRAINT supplier_default_account_is_not_merchandise
        CHECK (expense_account_code IS NULL OR category <> 'MERCHANDISE');

COMMENT ON COLUMN supplier.category IS
    'MERCHANDISE buys goods for resale (2012001001); EXPENSE sends bills for '
    'everything else (2012001003); AFFILIATE is another unit of the group '
    '(2012301xxx). One book, two menus — see the migration.';

CREATE INDEX ix_supplier_category ON supplier (category, status);
