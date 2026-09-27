-- 0605: every journal line is booked to a unit, and every entry balances per unit.
--
-- Owner's decisions of 2026-09-27 (`CONTEXT.md`, "The organisation"): a UNIT
-- — head office or a store — owns the books; a SITE is a premises that belongs
-- to one unit. 0600 introduced the unit and gave every site its `unit_id`, and
-- said in writing that `journal_line.site_id` would move "in a later step".
-- This is that step. Until now the ledger was keyed by premises, so head
-- office's books were "the books of the Gudang" (`dc`), and every posting a
-- unit made — a payroll accrual, a claim, a leaver's statement — had to be
-- translated into a site first (`book_site_of_unit`). The day head office opens
-- an office beside the Gudang, "which site's books" stops having one answer.
-- Keyed by unit, it never had to have one.
--
-- # What moves
--
--   * `journal_line.site_id` becomes `unit_id`, and `counter_site_id` becomes
--     `counter_unit_id`, both referencing `unit`.
--   * `bank_account.site_id` (the company side) becomes `unit_id`, and with it
--     `bank_statement.site_id` and `bank_statement_source.site_id`. They move
--     here and not later because a journal line, a statement and a statement
--     source each name their bank account by the triple (account, ledger code,
--     book), so the four cannot be keyed by different things for one commit.
--     A bank account is a unit's (P14, P16: a store may hold its own giro
--     account); which premises its paying-in book sits in is nobody's fact.
--
-- # How history is kept
--
-- Every value is translated through `site.unit_id`, which 0600 filled: the
-- Gudang's `dc` becomes head office's `ho`, and a shop `store-NN` becomes its
-- store `store-NN` (0600 keyed the store units like their shops). Nothing is
-- summed, merged or re-dated, and no entry is re-posted: each line keeps its
-- amount, its account and its entry, and only the book it names is re-spelled.
-- An entry that balanced per site balances per unit, because a unit is a set
-- of sites. The update runs with the table's own triggers off — append-only
-- (0051) would refuse it, and it is a change of key, not of what was posted.
--
-- # Head office is the unit of kind HO
--
-- `head_office_unit_id()` is the one definition, for SQL and Rust alike (Rust
-- reads it through `sites::head_office_unit_id`), the way 0603's
-- `head_office_site_id()` is for premises. 0600's unique index makes "the one"
-- true. `unit_of_site(site)` is the other half of the model: goods and
-- documents happen at a site, and their value is booked to the unit that owns
-- it. It is the only translation from a site to the books, and it goes that
-- way only.
--
-- # The two triggers
--
-- 0120's per-site balance becomes per unit (I3). The external-party trigger
-- (0376, 0603) asks whether a line sits in head office's books, found by the
-- unit's kind. The bank-match guard (0272) compares the statement's book with
-- the voucher's.

-- ---------------------------------------------------------------------------
-- 1. The two lookups
-- ---------------------------------------------------------------------------

CREATE FUNCTION head_office_unit_id() RETURNS text
LANGUAGE sql STABLE AS $$
    SELECT id FROM unit WHERE kind = 'HO'
$$;

COMMENT ON FUNCTION head_office_unit_id() IS
    'The id of the one unit of kind HO, or NULL when there is none (0605). The only definition of head office''s books; never compare a unit id to a literal.';

CREATE FUNCTION unit_of_site(text) RETURNS text
LANGUAGE sql STABLE AS $$
    SELECT unit_id FROM site WHERE id = $1
$$;

COMMENT ON FUNCTION unit_of_site(text) IS
    'The unit that owns a site, whose books its goods and documents are booked to (0605). NULL for a site the centre does not hold.';

-- ---------------------------------------------------------------------------
-- 2. Moving a column from site to unit, the same way every time
-- ---------------------------------------------------------------------------
--
-- Session-local and dropped with the session: a migration's tool, not a part
-- of the schema. 0607 and 0608 use the same one (and re-create it, since a
-- migration may run in a session of its own).

CREATE OR REPLACE FUNCTION pg_temp.move_column_to_unit(p_table regclass, p_from text, p_to text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
    col  smallint;
    con  record;
    idx  record;
BEGIN
    SELECT attnum INTO col
      FROM pg_attribute
     WHERE attrelid = p_table AND attname = p_from AND NOT attisdropped;
    IF col IS NULL THEN
        RAISE EXCEPTION '%.% was expected and is not there', p_table, p_from;
    END IF;

    -- The key to `site` goes: the column is about to hold unit ids.
    FOR con IN
        SELECT conname
          FROM pg_constraint
         WHERE conrelid = p_table AND contype = 'f'
           AND confrelid = 'site'::regclass AND conkey = ARRAY[col]
    LOOP
        EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', p_table, con.conname);
    END LOOP;

    EXECUTE format('ALTER TABLE %s RENAME COLUMN %I TO %I', p_table, p_from, p_to);

    -- A change of key, not of what was recorded: the table's own guards
    -- (append-only, posted-is-frozen) are about the second and would refuse it.
    EXECUTE format('ALTER TABLE %s DISABLE TRIGGER USER', p_table);
    EXECUTE format(
        'UPDATE %s AS x SET %I = s.unit_id FROM site s '
        'WHERE s.id = x.%I AND s.unit_id IS DISTINCT FROM x.%I',
        p_table, p_to, p_to, p_to);
    EXECUTE format('ALTER TABLE %s ENABLE TRIGGER USER', p_table);

    EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES unit (id)',
                   p_table, left(p_table::text || '_' || p_to || '_fkey', 63), p_to);

    -- An index named for the site keeps its meaning and loses the old word.
    FOR idx IN
        SELECT i.relname AS name
          FROM pg_index x
          JOIN pg_class i ON i.oid = x.indexrelid
         WHERE x.indrelid = p_table
           AND col = ANY (x.indkey::smallint[])
           AND i.relname LIKE '%site%'
    LOOP
        EXECUTE format('ALTER INDEX %I RENAME TO %I', idx.name, replace(idx.name, 'site', 'unit'));
    END LOOP;
END
$$;

-- ---------------------------------------------------------------------------
-- 3. The journal, the bank accounts and their statements
-- ---------------------------------------------------------------------------

-- The three triples that name a bank account by its book come off first, so
-- the four tables can be re-keyed one after another, and go back on after.
ALTER TABLE journal_line
    DROP CONSTRAINT journal_line_bank_account_agrees_with_the_account_posted;
ALTER TABLE bank_statement
    DROP CONSTRAINT bank_statement_account_agrees_with_its_ledger_binding;
ALTER TABLE bank_statement_source
    DROP CONSTRAINT bank_statement_source_account_agrees_with_its_ledger_binding;

SELECT pg_temp.move_column_to_unit('journal_line', 'site_id', 'unit_id');
SELECT pg_temp.move_column_to_unit('journal_line', 'counter_site_id', 'counter_unit_id');
SELECT pg_temp.move_column_to_unit('bank_account', 'site_id', 'unit_id');
SELECT pg_temp.move_column_to_unit('bank_statement', 'site_id', 'unit_id');
SELECT pg_temp.move_column_to_unit('bank_statement_source', 'site_id', 'unit_id');

-- `bank_account_ledger_binding_is_addressable` followed its column by itself;
-- the three references are restated against it.
ALTER TABLE journal_line
    ADD CONSTRAINT journal_line_bank_account_agrees_with_the_account_posted
    FOREIGN KEY (bank_account_id, account_code, unit_id)
    REFERENCES bank_account (account_id, ledger_account_code, unit_id);
ALTER TABLE bank_statement
    ADD CONSTRAINT bank_statement_account_agrees_with_its_ledger_binding
    FOREIGN KEY (bank_account_id, account_code, unit_id)
    REFERENCES bank_account (account_id, ledger_account_code, unit_id);
ALTER TABLE bank_statement_source
    ADD CONSTRAINT bank_statement_source_account_agrees_with_its_ledger_binding
    FOREIGN KEY (bank_account_id, account_code, unit_id)
    REFERENCES bank_account (account_id, ledger_account_code, unit_id);

COMMENT ON COLUMN journal_line.unit_id IS
    'Whose books this line is in: head office or a store (0605). A document at a site is booked to the unit that owns it (unit_of_site). Every entry balances per unit.';
COMMENT ON COLUMN journal_line.counter_unit_id IS
    'The unit on the other side of an inter-unit line: the store, on head office''s piutang leg, and head office on the store''s hutang leg (I7, I8). NULL on every ordinary line. Written by poster.rs from domain::interunit; never keyed by hand.';
COMMENT ON COLUMN bank_account.unit_id IS
    'Whose books a company bank account is kept in (0605): head office''s, or a store''s own giro or savings account (P14). NULL on a party''s account.';

-- ---------------------------------------------------------------------------
-- 4. Every entry balances in every unit it touches (I3)
-- ---------------------------------------------------------------------------

DROP TRIGGER journal_line_balances_per_site ON journal_line;
DROP FUNCTION assert_journal_balanced_per_site();

CREATE FUNCTION assert_journal_balanced_per_unit() RETURNS trigger AS $$
DECLARE
    offender text;
    out_by   bigint;
BEGIN
    SELECT l.unit_id, SUM(l.debit_minor - l.credit_minor)
      INTO offender, out_by
      FROM journal_line l
     WHERE l.entry_id = NEW.entry_id
     GROUP BY l.unit_id
    HAVING SUM(l.debit_minor - l.credit_minor) <> 0
     ORDER BY l.unit_id
     LIMIT 1;

    IF FOUND THEN
        RAISE EXCEPTION
            'journal entry % leaves unit % out by %: an entry that spans two units needs the affiliate legs that bring each one back to zero',
            NEW.entry_id, offender, out_by;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER journal_line_balances_per_unit
    AFTER INSERT ON journal_line
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION assert_journal_balanced_per_unit();

COMMENT ON FUNCTION assert_journal_balanced_per_unit() IS
    'Every unit an entry touches must net to zero (I3, 0605; per site from 0120). The client reads a trial balance per unit, so an entry balanced only in total is wrong in both books at once and right in neither.';

-- ---------------------------------------------------------------------------
-- 5. An external party's account is head office's alone (I4)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION journal_line_external_party_is_head_office()
RETURNS trigger AS $$
DECLARE
    party_kind text;
    kind_of_entry text;
BEGIN
    SELECT kind INTO party_kind
      FROM external_party_account
     WHERE account_code = NEW.account_code;

    IF party_kind IS NULL THEN
        RETURN NEW;
    END IF;

    IF NEW.unit_id = head_office_unit_id() THEN
        RETURN NEW;
    END IF;

    SELECT source_kind INTO kind_of_entry
      FROM journal_entry WHERE entry_id = NEW.entry_id;

    IF kind_of_entry = 'OPENING' THEN
        RETURN NEW;
    END IF;

    RAISE EXCEPTION
        'account % is an external-party % account; it is head office''s alone and cannot sit in the books of unit %. The unit reaches the same result through an affiliate account (1057/1058/1059 or 2028/2029/2030).',
        NEW.account_code, party_kind, NEW.unit_id
        USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;

COMMENT ON TABLE external_party_account IS
    'Accounts whose only accounting counterparty is head office: supplier and vendor payables (2002/2004) and lenders, the owner''s loan included (2035-2040, 2043-2048). A journal line on one of these may only sit in head office''s books, the unit of kind HO (0605); a store reaches the same economic result through the affiliate accounts (1057/2028 Pembiayaan, 1058/2029 Atas Barang, 1059/2030 Lain-lain). Giro 2005-2009 and 2030 are not here since 0380, and tax payables 2011-2015 are kept per unit. Read by the trigger journal_line_external_party_is_head_office.';

-- ---------------------------------------------------------------------------
-- 6. A bank line is agreed with a voucher in the same books (0272)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION bank_line_match_stays_on_one_account()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    statement_account   text;
    statement_unit      text;
    statement_bank      uuid;
    voucher_account     text;
    voucher_unit        text;
    voucher_bank        uuid;
BEGIN
    SELECT s.account_code, s.unit_id, s.bank_account_id
      INTO statement_account, statement_unit, statement_bank
      FROM bank_statement_line l
      JOIN bank_statement s ON s.statement_id = l.statement_id
     WHERE l.line_id = NEW.line_id;

    SELECT j.account_code, j.unit_id, j.bank_account_id
      INTO voucher_account, voucher_unit, voucher_bank
      FROM journal_line j
     WHERE j.line_id = NEW.journal_line_id;

    IF voucher_account IS DISTINCT FROM statement_account
       OR voucher_unit IS DISTINCT FROM statement_unit THEN
        RAISE EXCEPTION
            'this voucher line is on % in the books of %, and the statement is of % in the books of % -- a bank line can only be agreed with a voucher that moved the same account',
            voucher_account, voucher_unit, statement_account, statement_unit
            USING ERRCODE = 'P0001';
    END IF;

    IF statement_bank IS NOT NULL AND voucher_bank IS NOT NULL
       AND statement_bank <> voucher_bank THEN
        RAISE EXCEPTION
            'the statement and the voucher are of two different accounts at this bank, so they cannot be the same event'
            USING ERRCODE = 'P0001';
    END IF;

    RETURN NEW;
END $$;

-- ---------------------------------------------------------------------------
-- 7. The legacy reading of a line names its unit
-- ---------------------------------------------------------------------------

DROP VIEW journal_line_legacy;

CREATE VIEW journal_line_legacy AS
SELECT l.line_id,
       l.entry_id,
       l.account_code,
       l.category_code,
       l.unit_id,
       l.debit_minor,
       l.credit_minor,
       legacy_account_code(l.account_code, l.category_code, l.bank_account_id,
                           l.debit_minor > 0) AS legacy_code
  FROM journal_line l;

-- ---------------------------------------------------------------------------
-- What must now be true
-- ---------------------------------------------------------------------------

DO $$
BEGIN
    IF head_office_unit_id() IS NULL THEN
        RAISE EXCEPTION '0605: no unit is head office; exactly one unit must have kind HO';
    END IF;
    IF EXISTS (SELECT 1 FROM journal_line l
                WHERE NOT EXISTS (SELECT 1 FROM unit u WHERE u.id = l.unit_id)) THEN
        RAISE EXCEPTION '0605: a journal line names a book that is not a unit';
    END IF;
    IF EXISTS (SELECT 1 FROM journal_line
                WHERE counter_unit_id IS NOT NULL AND counter_unit_id = unit_id) THEN
        RAISE EXCEPTION '0605: an inter-unit line would name its own unit as the other side';
    END IF;
END
$$;
