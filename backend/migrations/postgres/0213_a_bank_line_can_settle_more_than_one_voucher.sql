-- A bank line can settle more than one voucher.
--
-- 0071 made a match one-to-one on BOTH sides: `UNIQUE (line_id)` and
-- `UNIQUE (journal_line_id)`. The second is right and stays — a journal line
-- settled twice is money counted twice. The first is wrong, and Friday is when
-- it shows: one transfer of 9.950.000 pays two suppliers, the bank reports one
-- line, and the books hold two entries. Under 0071 that line could never be
-- agreed at all, so the reconciliation could never reach zero and the screen
-- had no way to say why.
--
-- So a match now carries HOW MUCH of the line it claims, and a line may have
-- several. The remainder is the line's amount less what has been claimed, and
-- it is what the screen shows as unallocated.

ALTER TABLE bank_line_match ADD COLUMN allocated_minor bigint;

-- Every match that exists today claimed its whole line, because that was the
-- only thing 0071 could express.
UPDATE bank_line_match m
   SET allocated_minor = (SELECT GREATEST(l.debit_minor, l.credit_minor)
                            FROM bank_statement_line l
                           WHERE l.line_id = m.line_id);

ALTER TABLE bank_line_match ALTER COLUMN allocated_minor SET NOT NULL;

-- A claim of nothing is not a claim, and a negative one is a direction, which
-- the line already carries.
ALTER TABLE bank_line_match
    ADD CONSTRAINT bank_line_match_allocated_is_positive
    CHECK (allocated_minor > 0);

-- The half of 0071's promise that was wrong.
ALTER TABLE bank_line_match DROP CONSTRAINT IF EXISTS bank_line_match_line_id_key;

-- ...and the half that was right, restated so nobody has to go and read 0071
-- to find out whether it survived: one journal line, one claim, for ever.
--   UNIQUE (journal_line_id) — untouched.

-- One line cannot give away more than it holds.
--
-- In the database rather than in Rust, for the reason every other invariant in
-- this schema is: the write path is not the only way rows arrive, and a rule
-- that lives in one function is a rule that holds until somebody writes a
-- second function. AFTER, so the sum already includes the row being checked;
-- FOR EACH ROW, because that is when the caller can still be told which claim
-- was the one too many.
CREATE OR REPLACE FUNCTION bank_line_allocation_fits() RETURNS trigger AS $$
DECLARE
    line_amount bigint;
    claimed     bigint;
BEGIN
    SELECT GREATEST(l.debit_minor, l.credit_minor)
      INTO line_amount
      FROM bank_statement_line l
     WHERE l.line_id = NEW.line_id;

    SELECT COALESCE(SUM(m.allocated_minor), 0)
      INTO claimed
      FROM bank_line_match m
     WHERE m.line_id = NEW.line_id;

    IF claimed > line_amount THEN
        RAISE EXCEPTION
            'bank line % holds % but % has been allocated',
            NEW.line_id, line_amount, claimed
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER bank_line_allocation_fits
    AFTER INSERT OR UPDATE ON bank_line_match
    DEFERRABLE INITIALLY IMMEDIATE
    FOR EACH ROW EXECUTE FUNCTION bank_line_allocation_fits();

COMMENT ON COLUMN bank_line_match.allocated_minor IS
    'How much of the bank line this voucher claims. The line is fully agreed '
    'when the claims sum to its amount; anything less is the unallocated '
    'remainder the reconciliation screen still asks about.';
