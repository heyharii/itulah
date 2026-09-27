-- A party is named by a registry, not a check.
--
-- # What was wrong
--
-- Seven columns carry a party's kind and they speak four dialects:
--
--     cash_document.party_kind            SUPPLIER | EMPLOYEE | OTHER
--     advance.party_kind                  EMPLOYEE | SUPPLIER | OTHER
--     payment_execution (cash 'PAY')      SUPPLIER | EMPLOYEE | OTHER
--     payment_ledger_entry.party_type     SUPPLIER | ACQUIRER | EMPLOYEE | CUSTOMER | OTHER
--     opening_subledger_line.party_type   SUPPLIER | ACQUIRER | EMPLOYEE | CUSTOMER | OTHER
--     payment_destination.party_type      SUPPLIER | EMPLOYEE | OTHER
--     bank_statement_line.counterparty_kind  SUPPLIER | CUSTOMER | MEMBER | STAFF | OTHER
--
-- Each CHECK is its own list, so the same person is a STAFF on a bank line,
-- an EMPLOYEE on an advance, and neither spelling can be JOINed to the other.
-- A seventh shape of party cannot be recorded anywhere without a migration in
-- five files.
--
-- # The shape being adopted
--
-- ERPNext keeps one registry for this and nothing else: doctype `Party Type`
-- (`party_type` + `account_type` Payable|Receivable, `in_create`). Every
-- accounting row then carries the same two columns -- `party_type` and `party`
-- -- and a new party shape joins by a row, not by an ALTER.
--
-- The owner chose this shape on 22 September 2026: adopt it
-- (`docs/erpnext-finance-adoption.md`).
--
-- # What this overrides, and what it does not
--
-- Three frozen essays end here, and are named because the chain remembers:
--
-- * the brief's §16 ban on a generic Party (`docs/finance-bank-audit.md` §3);
-- * 0280's "Typed, and not a generic party";
-- * 0214's word `counterparty` (its other half -- `bank_said`, the bank's own
--   string, kept apart from our conclusion -- SURVIVES, and is not even a
--   departure: ERPNext's `bank_transaction` keeps the same pair as
--   `bank_party_name` beside its `party_type`/`party`).
--
-- What does NOT change, and is the reason this is a rename and not a rebuild:
--
-- * the typed foreign keys stay. `cash_document.supplier_id` /
--   `advance.supplier_id` still reference `supplier`, `employee_id` still
--   references `employee`. A registry governs the VOCABULARY axis; the typed
--   keys are what stop a typo becoming a debtor, and they keep doing that.
-- * `party_id` stays text and not a foreign key, for 0151's reason: "a
--   supplier a bill names is not always a row in `supplier` yet".
-- * `party_name` stays denormalised and frozen -- evidence, not a join
--   (0144).
--
-- # account_type, and one admitted departure
--
-- `account_type` follows ERPNext's semantics: PAYABLE = we owe them,
-- RECEIVABLE = they owe us. EMPLOYEE gets PAYABLE and is exempted from the
-- match in both directions, exactly as ERPNext exempts it
-- (`journal_entry.py`: "making an exception for employee since they can be
-- both payable and receivable") -- wages on one side, `1011102001 PIUTANG
-- PEGAWAI` on the other.
--
-- The departure: ERPNext has no party that is not a control account, so its
-- `account_type` is required. We have two -- MEMBER (loyalty; no posting path)
-- and OTHER (a name, honestly, and nothing else) -- and NULL here means "not a
-- party control account", not "undecided".
--
-- STAFF becomes EMPLOYEE (the spelling 0113/0115 already use). CUSTOMER stays
-- distinct from MEMBER: `member` is a register, CUSTOMER is a party with no
-- register -- two different things that happen to rhyme.

CREATE TABLE party_type (
    party_type   text PRIMARY KEY,
    -- The register that holds the rows; '' for a party with no register
    -- (CUSTOMER, OTHER). party_id remains text either way (0151).
    register     text NOT NULL DEFAULT '' CHECK (register = '' OR register ~ '^[a-z_]+$'),
    account_type text CHECK (account_type IN ('PAYABLE', 'RECEIVABLE')),
    note         text,
    created_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE party_type IS
    'The kinds of party the books may name, and whether they are a payable or a receivable. The ERPNext Party Type registry: one vocabulary for every accounting row, extensible by a row rather than by five CHECK constraints. account_type NULL means the type is not a party control account (MEMBER, OTHER).';
COMMENT ON COLUMN party_type.account_type IS
    'PAYABLE: we owe them. RECEIVABLE: they owe us. NULL: not a control-account party. EMPLOYEE is PAYABLE but exempt from the match both ways -- wages and employee advances run in opposite directions (see ERPNext journal_entry.py, which exempts Employee for the same reason).';

INSERT INTO party_type (party_type, register, account_type, note) VALUES
    ('SUPPLIER', 'supplier', 'PAYABLE',
     'the register of 0032, categories of 0212 unchanged'),
    ('EMPLOYEE', 'employee', 'PAYABLE',
     'both directions: payroll payable and 1011102001 employee receivable; exempt from the account_type match'),
    ('ACQUIRER', '', 'RECEIVABLE',
     'a card scheme or QRIS provider holding our money (0135); qualifier text, no register'),
    ('CUSTOMER', '', 'RECEIVABLE',
     'a party with no register; party_id is whatever the document named'),
    ('MEMBER',  'member', NULL,
     'the loyalty register (0082); not a control account -- a member promise lives on the voucher liability, not on a receivable'),
    ('OTHER',   '', NULL,
     'a name and nothing else, which is honest about what we know (0280)');

-- ---------------------------------------------------------------------------
-- STAFF speaks EMPLOYEE from here on
-- ---------------------------------------------------------------------------

UPDATE bank_statement_line
   SET counterparty_kind = 'EMPLOYEE'
 WHERE counterparty_kind = 'STAFF';

-- ---------------------------------------------------------------------------
-- One name for the columns
-- ---------------------------------------------------------------------------

ALTER TABLE bank_statement_line RENAME COLUMN counterparty_kind  TO party_type;
ALTER TABLE bank_statement_line RENAME COLUMN counterparty_id    TO party_id;
ALTER TABLE bank_statement_line RENAME COLUMN counterparty_name  TO party_name;
ALTER TABLE bank_statement_line RENAME COLUMN counterparty_set_by TO party_set_by;
ALTER TABLE bank_statement_line RENAME COLUMN counterparty_set_at TO party_set_at;

ALTER INDEX ix_bank_statement_line_counterparty RENAME TO ix_bank_statement_line_party;
ALTER TABLE bank_statement_line RENAME CONSTRAINT bank_statement_line_counterparty_id_needs_a_kind
    TO bank_statement_line_party_id_needs_a_type;

ALTER TABLE cash_document RENAME COLUMN party_kind TO party_type;
ALTER TABLE advance       RENAME COLUMN party_kind TO party_type;

-- Column renames carry their column-level objects with them (the partial
-- indexes, the identity CHECKs like `(party_type = 'SUPPLIER') = (supplier_id
-- IS NOT NULL)` -- Postgres rewrites those definitions to the new name). What
-- renames do NOT touch are the vocabulary CHECKs, because those are
-- table-level constraints in every file that minted them. Those are dropped
-- by definition, not by guessed auto-names, so a constraint added under a
-- different name by a sibling chain is caught too -- the lesson of 0257.
DO $$
DECLARE
    victim record;
BEGIN
    FOR victim IN
        SELECT conrelid::regclass AS tbl, conname
          FROM pg_constraint
         WHERE contype = 'c'
           AND (
                position('party_kind in (' in lower(pg_get_constraintdef(oid))) > 0
             OR position('counterparty_kind in (' in lower(pg_get_constraintdef(oid))) > 0
             OR position('party_type in (' in lower(pg_get_constraintdef(oid))) > 0
           )
    LOOP
        EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', victim.tbl, victim.conname);
        RAISE NOTICE 'dropped vocabulary check % on %', victim.conname, victim.tbl;
    END LOOP;
END $$;

-- ...and the registry takes over the guarantee those lists held.
ALTER TABLE cash_document
    ADD CONSTRAINT cash_document_party_names_a_registered_party
    FOREIGN KEY (party_type) REFERENCES party_type (party_type);
ALTER TABLE advance
    ADD CONSTRAINT advance_party_names_a_registered_party
    FOREIGN KEY (party_type) REFERENCES party_type (party_type);
ALTER TABLE payment_ledger_entry
    ADD CONSTRAINT payment_ledger_entry_party_names_a_registered_party
    FOREIGN KEY (party_type) REFERENCES party_type (party_type);
ALTER TABLE opening_subledger_line
    ADD CONSTRAINT opening_subledger_line_party_names_a_registered_party
    FOREIGN KEY (party_type) REFERENCES party_type (party_type);
ALTER TABLE payment_destination
    ADD CONSTRAINT payment_destination_party_names_a_registered_party
    FOREIGN KEY (party_type) REFERENCES party_type (party_type);
ALTER TABLE bank_statement_line
    ADD CONSTRAINT bank_statement_line_party_names_a_registered_party
    FOREIGN KEY (party_type) REFERENCES party_type (party_type);
-- Plain text since 0113, never checked: it speaks the registry now too.
ALTER TABLE store_ledger_shim
    ADD CONSTRAINT store_ledger_shim_party_names_a_registered_party
    FOREIGN KEY (party_type) REFERENCES party_type (party_type);

COMMENT ON COLUMN bank_statement_line.party_name IS
    'Our reading of who the other side was (0214, renamed by 0299). The bank''s own string is in bank_said, and the two are deliberately not the same column.';

-- ---------------------------------------------------------------------------
-- Guards
-- ---------------------------------------------------------------------------

DO $$
DECLARE
    missing bigint;
BEGIN
    -- The registry is exactly the six, and nothing joined it that is not in it
    -- (the FKs above would have refused the inserts; this counts the outcome).
    IF (SELECT count(*) FROM party_type) <> 6 THEN
        RAISE EXCEPTION 'party_type must seed exactly six rows';
    END IF;

    IF EXISTS (SELECT 1 FROM bank_statement_line WHERE party_type = 'STAFF') THEN
        RAISE EXCEPTION 'STAFF survived the backfill';
    END IF;

    SELECT count(*) INTO missing
      FROM (
            SELECT party_type FROM cash_document
      UNION SELECT party_type FROM advance
      UNION SELECT party_type FROM payment_ledger_entry
      UNION SELECT party_type FROM opening_subledger_line
      UNION SELECT party_type FROM payment_destination
      UNION SELECT party_type FROM bank_statement_line WHERE party_type IS NOT NULL
      UNION SELECT party_type FROM store_ledger_shim
      ) every_said
     WHERE NOT EXISTS (SELECT 1 FROM party_type p WHERE p.party_type = every_said.party_type);
    IF missing > 0 THEN
        RAISE EXCEPTION '% party value(s) in use are not in the registry', missing;
    END IF;

    -- Every table that names a party is pinned to the registry.
    IF (SELECT count(*) FROM pg_constraint
         WHERE conname LIKE '%_party_names_a_registered_party') <> 7 THEN
        RAISE EXCEPTION 'expected seven registry foreign keys';
    END IF;
END $$;
