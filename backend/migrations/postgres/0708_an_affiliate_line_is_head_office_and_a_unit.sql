-- An affiliate balance is head office's piutang against a unit's hutang, and
-- says who the other side is.
--
-- The owner's rules I7/I8 (`FINANCE-HARD-RULES.md`, 25 Sep 2026): 1057/1058/
-- 1059 (Piutang Affiliasi) sit in head office's books and name the unit on the
-- other side; 2028/2029/2030 (Hutang Affiliasi) sit in a unit's books and name
-- head office. `domain::interunit` writes them that way, and NOTHING refused a
-- line that named the account directly — `posting_matrix` has expected REFUSE
-- on exactly these rows since 25 Sep, and `CONSISTENCY-MATRIX.md` records the
-- hole as gap G1.
--
-- Enforced where the other line rules are: a trigger on `journal_line`, reading
-- which unit is head office from data (`head_office_unit_id()`, 0605) rather
-- than from a spelling, so a hand-written entry, a migration or a second writer
-- is held to the same rule the balancer follows.
--
-- OPENING and REVERSAL are exempt, as they are on every other line rule:
-- OPENING is history being carried in (the external-party trigger of 0376
-- exempts it for the same reason), and a REVERSAL undoes what was legal when it
-- was posted.

CREATE OR REPLACE FUNCTION journal_line_affiliate_sides() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    head_office   text := head_office_unit_id();
    kind_of_entry text;
BEGIN
    IF NEW.account_code NOT IN ('1057', '1058', '1059', '2028', '2029', '2030') THEN
        RETURN NEW;
    END IF;

    SELECT source_kind INTO kind_of_entry
      FROM journal_entry WHERE entry_id = NEW.entry_id;
    IF kind_of_entry IN ('OPENING', 'REVERSAL') THEN
        RETURN NEW;
    END IF;

    IF NEW.account_code IN ('1057', '1058', '1059') THEN
        -- Head office's piutang, and it names the unit that owes it.
        IF NEW.unit_id IS DISTINCT FROM head_office THEN
            RAISE EXCEPTION
                'account % is head office''s piutang against a unit and cannot sit in the books of unit %; a unit reaches the same result through 2028/2029/2030 (I7)',
                NEW.account_code, NEW.unit_id
                USING ERRCODE = 'P0001';
        END IF;
        IF NEW.counter_unit_id IS NULL OR NEW.counter_unit_id = head_office THEN
            RAISE EXCEPTION
                'account % is head office''s piutang and must name the unit on the other side (I7)',
                NEW.account_code
                USING ERRCODE = 'P0001';
        END IF;
        RETURN NEW;
    END IF;

    -- A unit's hutang to head office, and it names head office.
    IF NEW.unit_id = head_office THEN
        RAISE EXCEPTION
            'account % is a unit''s hutang to head office and cannot sit in head office''s own books; head office reaches the same result through 1057/1058/1059 (I8)',
            NEW.account_code
            USING ERRCODE = 'P0001';
    END IF;
    IF NEW.counter_unit_id IS DISTINCT FROM head_office THEN
        RAISE EXCEPTION
            'account % is a unit''s hutang and must name head office as the other side (I8)',
            NEW.account_code
            USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER journal_line_affiliate_sides
    BEFORE INSERT ON journal_line
    FOR EACH ROW EXECUTE FUNCTION journal_line_affiliate_sides();

COMMENT ON FUNCTION journal_line_affiliate_sides() IS
    'I7/I8: 1057/1058/1059 only in head office''s books and naming a unit; 2028/2029/2030 only in a unit''s books and naming head office. OPENING and REVERSAL exempt (0708).';
