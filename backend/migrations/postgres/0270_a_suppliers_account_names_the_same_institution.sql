-- A supplier's account names the same institution, and stays their account.
--
-- 0269 gave the institution a row. `supplier_bank_account` (0221) named its bank
-- with the same normalized string as ours, which is why the Banks screen could
-- gather both halves at all — and why a typo on either half showed one bank
-- twice. It points at the institution now.
--
-- # What does NOT happen here
--
-- The two are not merged, and the supplier's account gets no reference to ours.
-- They answer different questions:
--
--     company bank account  our money; a balance that reconciles against a
--                           statement and sits on the balance sheet
--     supplier bank account where a payment goes; never a balance of ours
--
-- Both hold an account number, which is the whole of their similarity. 0221 said
-- it in its title — *a recipient's bank account is not one of ours* is 0151's
-- title, for that matter — and merging them would put our cash and somebody
-- else's destination in one table where a query could mistake them.
--
-- # The other recipient table
--
-- `payment_destination` (0151) already stores recipient accounts for
-- `SUPPLIER | EMPLOYEE | OTHER`, with the number encrypted, a fingerprint, and a
-- verification workflow — and `payment_batch_item` has a foreign key to it.
-- `supplier_bank_account` (0221) has no inbound key from anything. Two lanes
-- built an answer to one question, and which one is canonical is a decision for
-- the payments lane and the owner, not a side effect of Phase 2. Recorded in
-- `docs/finance-bank-audit.md` §7 and deliberately left alone here.

ALTER TABLE supplier_bank_account
    ADD COLUMN bank_id uuid REFERENCES bank (bank_id);

UPDATE supplier_bank_account s
   SET bank_id = b.bank_id
  FROM bank b
 WHERE b.normalized_name = s.bank_name_normalized
   AND s.bank_id IS NULL;

-- A supplier banking somewhere we have no institution row for is the one case
-- 0269's data-driven insert should already have covered. If it did not, the name
-- normalises to something that is not a usable code, and that is a row for a
-- person to look at rather than a migration to guess about.
DO $$
DECLARE
    orphaned bigint;
    sample   text;
BEGIN
    SELECT COUNT(*), MIN(bank_name) INTO orphaned, sample
      FROM supplier_bank_account WHERE bank_id IS NULL;
    IF orphaned > 0 THEN
        RAISE EXCEPTION
            '% supplier bank account(s) name an institution that does not exist, e.g. %',
            orphaned, sample;
    END IF;
END $$;

ALTER TABLE supplier_bank_account ALTER COLUMN bank_id SET NOT NULL;

-- Identity moves onto the institution for the same reason 0269 moved ours: the
-- string was standing in for a row, and now there is a row.
ALTER TABLE supplier_bank_account
    DROP CONSTRAINT IF EXISTS supplier_bank_account_supplier_id_bank_name_normalized_acco_key;

ALTER TABLE supplier_bank_account
    ADD CONSTRAINT supplier_bank_account_is_one_number_at_one_bank
    UNIQUE (supplier_id, bank_id, account_no_digits);

CREATE INDEX ix_supplier_bank_account_institution ON supplier_bank_account (bank_id);

COMMENT ON COLUMN supplier_bank_account.bank_id IS
    'The institution, shared with our own accounts. NOT a reference to one of our accounts -- this row is where a payment goes, never a balance we hold.';
