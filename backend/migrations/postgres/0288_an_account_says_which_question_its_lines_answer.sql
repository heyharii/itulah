-- An account says which question its lines answer, and a line has to answer it.
--
-- 0287 built the two places identity goes. This migration wires them to the
-- ledger and makes the wiring compulsory, which is the whole difference between
-- a dimension and a comment.
--
-- `ledger_account.category_family` is the declaration: *this account takes a
-- value from this family, and from no other*. `6301 Beban umum & administrasi`
-- declares `expense_category`; `1102 Bank` declares nothing, because which bank
-- is already `journal_line.bank_account_id` and a second answer to the same
-- question is a second thing to keep in step.
--
-- # Why a trigger and not a foreign key
--
-- The obvious shape is the one `journal_line` already uses for groups:
-- `(account_code, is_group)` REFERENCES `ledger_account(account_code, is_group)`,
-- a composite key that makes "you may not post to a heading" unrepresentable
-- rather than merely forbidden. The same trick looks like it should work here —
-- carry `category_family` on the line, point a composite foreign key at the
-- account, and let the database refuse a mismatch.
--
-- It does not work, and the reason is worth writing down so nobody tries it
-- again. A composite foreign key is `MATCH SIMPLE` by default: if ANY column of
-- it is NULL the constraint is not checked at all. So a line that names an
-- account declaring `expense_category` and simply leaves the family NULL
-- satisfies the foreign key — which is precisely the case the rule exists to
-- catch. `MATCH FULL` refuses that, but it also refuses every line on an
-- account that takes no category, because then both columns are NULL and
-- MATCH FULL wants all-or-nothing against a row that does not exist.
--
-- So the rule is a trigger, in the company of `assert_period_open` and
-- `assert_journal_balanced_per_site`, which are constraints of exactly the same
-- kind: true of every row, not expressible as one.
--
-- # What it refuses
--
--   1. an account that declares a family, on a line with no category
--   2. a category on a line whose account declares no family
--   3. a category from the wrong family
--   4. a retired category on a new posting
--
-- The message names the account, the family it wants, and up to five values
-- that would have been accepted. A refusal that says only "invalid category"
-- sends the reader to the wrong screen.

ALTER TABLE ledger_account ADD COLUMN category_family TEXT
    CHECK (category_family ~ '^[a-z][a-z0-9_]*$');

COMMENT ON COLUMN ledger_account.category_family IS
    'The line_category family this account accepts, or NULL when its identity '
    'comes from a column or a sub-ledger instead (bank_account_id, asset_id, '
    'supplier_id, counter_site_id, tax_type, financing_facility, principal).';

ALTER TABLE journal_line ADD COLUMN category_code TEXT
    REFERENCES line_category (category_code);

ALTER TABLE account_map ADD COLUMN category_code TEXT
    REFERENCES line_category (category_code);

ALTER TABLE ledger_account_remap ADD COLUMN category_code TEXT
    REFERENCES line_category (category_code);

CREATE INDEX ix_journal_line_category ON journal_line (category_code, site_id)
    WHERE category_code IS NOT NULL;

-- Raise if this account and this category do not belong together. Shared by the
-- two triggers below so the map and the ledger cannot drift into disagreeing
-- about what is legal.
CREATE FUNCTION assert_category_fits(
    -- Parameter names are prefixed because PL/pgSQL resolves a bare identifier
    -- to a variable before a column, and `category_code` is both here. Left
    -- unprefixed it raises "column reference is ambiguous" from inside the
    -- refusal that was trying to be helpful.
    for_account   TEXT,
    carrying      TEXT,
    what          TEXT
) RETURNS VOID AS $$
DECLARE
    wanted    TEXT;
    has       TEXT;
    live      BOOLEAN;
    allowed   TEXT;
BEGIN
    SELECT a.category_family INTO wanted
      FROM ledger_account a WHERE a.account_code = for_account;

    IF carrying IS NULL THEN
        IF wanted IS NOT NULL THEN
            SELECT string_agg(c.category_code, ', ' ORDER BY c.sort_order) INTO allowed
              FROM (SELECT lc.category_code, lc.sort_order FROM line_category lc
                     WHERE lc.family = wanted AND lc.is_active
                     ORDER BY lc.sort_order LIMIT 5) c;
            RAISE EXCEPTION
                '% names %, which needs a % — try one of %',
                what, for_account, wanted, allowed;
        END IF;
        RETURN;
    END IF;

    IF wanted IS NULL THEN
        RAISE EXCEPTION
            '% names % and carries the category %, but that account takes no '
            'category: what distinguishes its lines is a column of its own',
            what, for_account, carrying;
    END IF;

    SELECT c.family, c.is_active INTO has, live
      FROM line_category c WHERE c.category_code = carrying;

    IF has IS NULL THEN
        RAISE EXCEPTION '% names the category %, which does not exist', what, carrying;
    END IF;

    IF has <> wanted THEN
        RAISE EXCEPTION
            '% names %, which takes a %, but % is a %',
            what, for_account, wanted, carrying, has;
    END IF;

    IF NOT live THEN
        RAISE EXCEPTION
            '% names the retired category %; it still reads back on old '
            'postings but nothing new may be posted to it',
            what, carrying;
    END IF;
END $$ LANGUAGE plpgsql;

CREATE FUNCTION assert_line_category() RETURNS TRIGGER AS $$
BEGIN
    PERFORM assert_category_fits(NEW.account_code, NEW.category_code, 'this journal line');
    RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER journal_line_category_fits
    BEFORE INSERT ON journal_line
    FOR EACH ROW EXECUTE FUNCTION assert_line_category();

-- The same rule at the other end. A map row is set once and read by every
-- posting that names its meaning, so a wrong category there is a wrong category
-- on thousands of lines — and it is far cheaper to refuse it on the Account Map
-- screen, where somebody is looking at the account, than at the moment a day's
-- sale will not post.
CREATE FUNCTION assert_map_category() RETURNS TRIGGER AS $$
BEGIN
    PERFORM assert_category_fits(
        NEW.account_code, NEW.category_code,
        format('the map row for %L', NEW.semantic_key));
    RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER account_map_category_fits
    BEFORE INSERT OR UPDATE ON account_map
    FOR EACH ROW EXECUTE FUNCTION assert_map_category();
