-- 0712: A giro whose payment is reversed is voided.
--
-- A BKK, a BKM or a Payment Entry paid by giro puts the amount on
-- `giro_outstanding` and writes the giro. Reversing that document mirrors its
-- entry — the giro is off the books — but the giro row stayed ISSUED on the
-- Giro Board, waiting to be delivered and cleared. Clearing it then would have
-- posted Dr giro_outstanding / Cr bank for a promise nobody owed any more.
--
-- The leaf is torn up, not bounced: REJECTED is the bank refusing it (7Soft's
-- Tolak), and it is what the board counts as "Bounced this month". A payment
-- we took back ourselves is a different fact, so it gets its own state,
-- VOIDED, with the day and the reason. Like CLEARED and REJECTED it is
-- settled: nothing moves it again.
--
-- A giro that has already CLEARED is not voided by a reversal — the money has
-- left the bank. The reversal is refused and says to un-clear it first
-- (Batal Cair, 0705) or record the refund as its own document.

ALTER TABLE giro ADD COLUMN voided_on date;
ALTER TABLE giro ADD COLUMN voided_reason text;

ALTER TABLE giro DROP CONSTRAINT giro_status_check;
ALTER TABLE giro ADD CONSTRAINT giro_status_check
    CHECK (status IN ('ISSUED', 'DELIVERED', 'DUE', 'CLEARED', 'REJECTED', 'VOIDED'));

ALTER TABLE giro ADD CONSTRAINT giro_voided_says_when
    CHECK ((status = 'VOIDED') = (voided_on IS NOT NULL));
ALTER TABLE giro ADD CONSTRAINT giro_voided_says_why
    CHECK (status <> 'VOIDED' OR btrim(COALESCE(voided_reason, '')) <> '');

-- `settled_by` is set exactly when the giro is settled; VOIDED is settled.
ALTER TABLE giro DROP CONSTRAINT giro_check6;
ALTER TABLE giro ADD CONSTRAINT giro_settled_says_who
    CHECK ((status IN ('CLEARED', 'REJECTED', 'VOIDED')) = (settled_by IS NOT NULL));

CREATE OR REPLACE FUNCTION protect_settled_giro() RETURNS trigger AS $$
BEGIN
    IF OLD.status IN ('CLEARED', 'REJECTED', 'VOIDED') AND NEW.status <> OLD.status THEN
        -- The one way out of a settled state (0705): a clearing somebody took
        -- back, written down before the giro moved.
        IF NOT (
            OLD.status = 'CLEARED'
            AND NEW.status IN ('DUE', 'REJECTED')
            AND EXISTS (SELECT 1 FROM giro_unclearing u
                         WHERE u.giro_id = OLD.giro_id
                           AND u.clearing_entry_id = OLD.clearing_entry_id)
        ) THEN
            RAISE EXCEPTION
                'giro % at % is already %; it cannot be settled twice',
                OLD.number, OLD.bank, lower(OLD.status);
        END IF;
    END IF;
    IF OLD.status IN ('CLEARED', 'REJECTED', 'VOIDED') AND (
           NEW.amount_minor IS DISTINCT FROM OLD.amount_minor
        OR NEW.bank         IS DISTINCT FROM OLD.bank
        OR NEW.number       IS DISTINCT FROM OLD.number
        OR NEW.due_date     IS DISTINCT FROM OLD.due_date
    ) THEN
        RAISE EXCEPTION
            'giro % at % is %; what it was written for cannot change afterwards',
            OLD.number, OLD.bank, lower(OLD.status);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
