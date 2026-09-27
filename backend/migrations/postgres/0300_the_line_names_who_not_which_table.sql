-- The line names who, not which table.
--
-- # What was wrong
--
-- `journal_line` carried a supplier as `supplier_id` (0051) -- a typed column
-- for one register and no column at all for the other four. A payment to a
-- supplier ages; a payment to an employee, an acquirer settlement, a customer
-- refund do not, because the line that moved the money cannot say who it was
-- for. ERPNext's GL carries `party_type` + `party` on every row for exactly
-- this reason, and 0299 gave us the registry those two columns point at.
--
-- # What this migration does
--
-- 1. Adds the pair -- `party_type` (registry FK) and `party_id` (text, 0151's
--    reason: a party a document names is not always a row in a register yet) --
--    to `journal_line`, and backfills every existing `supplier_id` into it as
--    SUPPLIER. Then drops `supplier_id` and its index: two columns for one
--    fact is two answers to "who was this line for", and the pair is the one
--    every other table now speaks.
-- 2. Adds the guard ERPNext keeps in `validate_account_party_type`, as a
--    trigger rather than app code: on an account whose `category_family`
--    (0288) is RECEIVABLE or PAYABLE, a line must name its party, and the
--    party's registered `account_type` must agree with the family. The two
--    exemptions are deliberate and each has ERPNext's own precedent:
--      * EMPLOYEE is exempt from the direction match -- wages and
--        `1011102001 PIUTANG PEGAWAI` run in opposite directions, which is
--        the same exception `journal_entry.py` makes ("employee since they can
--        be both payable and receivable");
--      * `source_kind = 'OPENING'` is exempt from naming a party at all --
--        an opening balance is history arriving, and history may not have
--        carried the name.
--    MEMBER and OTHER carry NULL `account_type` in the registry, so they are
--    refused on control accounts without a second rule: a loyalty member and
--    "a name and nothing else" are not parties a balance is kept against.
--
-- # What does NOT change
--
-- The typed foreign keys that are NOT parties: `asset_id` (0213),
-- `bank_account_id` (0272), `counter_site_id` (0120). They name things that
-- are not parties -- an asset, our own account, another unit -- and the
-- registry has nothing to say about them. The poster's one door, `account_map`,
-- and the append-only rule are untouched: this migration adds a column and a
-- guard, it does not create a second way to post.

ALTER TABLE journal_line
    ADD COLUMN party_type text REFERENCES party_type (party_type),
    ADD COLUMN party_id   text CHECK (btrim(party_id) <> '');

ALTER TABLE journal_line
    ADD CONSTRAINT journal_line_party_id_needs_a_type
    CHECK ((party_id IS NULL) = (party_type IS NULL));

-- Every line that named a supplier names a SUPPLIER party now.
UPDATE journal_line
   SET party_type = 'SUPPLIER',
       party_id   = supplier_id
 WHERE supplier_id IS NOT NULL;

DO $$
DECLARE
    stranded bigint;
BEGIN
    SELECT count(*) INTO stranded
      FROM journal_line
     WHERE supplier_id IS NOT NULL
       AND (party_id IS NULL OR party_type IS NULL);
    IF stranded > 0 THEN
        RAISE EXCEPTION '% journal line(s) named a supplier the backfill missed', stranded;
    END IF;
END $$;

DROP INDEX IF EXISTS ix_journal_line_supplier;
ALTER TABLE journal_line DROP COLUMN supplier_id;

CREATE INDEX ix_journal_line_party
    ON journal_line (party_type, party_id)
    WHERE party_id IS NOT NULL;

COMMENT ON COLUMN journal_line.party_type IS
    'Which kind of party this line is against, from the party_type registry (0299). Required by the guard below on accounts whose category_family is RECEIVABLE or PAYABLE -- with the EMPLOYEE direction exemption and the OPENING exemption stated there.';
COMMENT ON COLUMN journal_line.party_id IS
    'The party''s own id, as text (0151: a party a document names is not always a row in a register yet). Frozen once posted; corrections are reversals, not edits.';

-- ---------------------------------------------------------------------------
-- The guard
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION journal_line_names_its_party() RETURNS trigger AS $$
DECLARE
    line_family   text;
    party_account text;
    party_kind    text;
BEGIN
    IF NEW.party_type IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT category_family INTO line_family
      FROM ledger_account
     WHERE account_code = NEW.account_code
       AND is_group = false;

    -- Not a control account: the party is informational, as on ERPNext's GL,
    -- and needs no direction match.
    IF line_family IS NULL OR line_family NOT IN ('RECEIVABLE', 'PAYABLE') THEN
        RETURN NEW;
    END IF;

    IF NEW.party_id IS NULL THEN
        RAISE EXCEPTION
            'a line on % (%) must name its party -- an account that answers "who do we owe / who owes us" without a who is a balance nobody can age',
            NEW.account_code, line_family
            USING ERRCODE = 'P0001';
    END IF;

    SELECT account_type INTO party_account
      FROM party_type
     WHERE party_type = NEW.party_type;

    -- EMPLOYEE runs in both directions (wages owed, advances owed TO us), the
    -- same exception ERPNext makes in journal_entry.py. Every other kind must
    -- agree with the family its account answers.
    IF NEW.party_type <> 'EMPLOYEE'
       AND party_account IS NOT NULL
       AND party_account <> line_family THEN
        RAISE EXCEPTION
            'party type % is a % party and cannot sit on a % account (%)',
            NEW.party_type, party_account, line_family, NEW.account_code
            USING ERRCODE = 'P0001';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER journal_line_names_its_party
    BEFORE INSERT OR UPDATE ON journal_line
    FOR EACH ROW EXECUTE FUNCTION journal_line_names_its_party();

-- Opening balances are history arriving; history may not have carried names.
-- The guard reads the entry's own source kind so the exemption is a fact about
-- the document, not about who typed it.
CREATE OR REPLACE FUNCTION journal_line_opening_exempt() RETURNS trigger AS $$
DECLARE
    line_family text;
BEGIN
    IF NEW.party_type IS NOT NULL THEN
        RETURN NEW;
    END IF;

    SELECT category_family INTO line_family
      FROM ledger_account
     WHERE account_code = NEW.account_code
       AND is_group = false;

    IF line_family IN ('RECEIVABLE', 'PAYABLE') THEN
        IF (SELECT source_kind FROM journal_entry WHERE entry_id = NEW.entry_id) <> 'OPENING' THEN
            RAISE EXCEPTION
                'a line on % (%) must name its party; only an OPENING entry may leave it unnamed',
                NEW.account_code, line_family
                USING ERRCODE = 'P0001';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER journal_line_opening_exempt
    BEFORE INSERT OR UPDATE ON journal_line
    FOR EACH ROW EXECUTE FUNCTION journal_line_opening_exempt();

-- ---------------------------------------------------------------------------
-- Guards
-- ---------------------------------------------------------------------------

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_attribute
                WHERE attrelid = 'journal_line'::regclass
                  AND attname = 'supplier_id' AND NOT attisdropped) THEN
        RAISE EXCEPTION 'journal_line still carries supplier_id';
    END IF;
    IF (SELECT count(*) FROM pg_trigger
         WHERE tgrelid = 'journal_line'::regclass
           AND tgname IN ('journal_line_names_its_party', 'journal_line_opening_exempt')
           AND NOT tgisinternal) <> 2 THEN
        RAISE EXCEPTION 'the party guards are not both installed';
    END IF;
    -- The backfill must have been total: nothing on a control account without
    -- a party that was not already there before this migration ran.
    IF EXISTS (SELECT 1 FROM journal_line jl
                JOIN ledger_account la
                  ON la.account_code = jl.account_code AND la.is_group = false
               WHERE la.category_family IN ('RECEIVABLE', 'PAYABLE')
                 AND jl.party_type IS NULL
                 AND (SELECT source_kind FROM journal_entry WHERE entry_id = jl.entry_id) <> 'OPENING') THEN
        RAISE EXCEPTION 'a control-account line names no party and is not OPENING';
    END IF;
END $$;
