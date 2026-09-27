-- A unit has one person in charge, and a history of who it was.
--
-- Owner's decision, 2026-09-27: every unit has a **PIC** — the one person
-- answerable for it, who gets the unit's reach and, as they arrive, its
-- approvals. Not "owner": that word is the business owner's, and the Inventory
-- Owner is a node (`CONTEXT.md`, "The organisation").
--
-- # Effective-dated, because "who was in charge in March" is asked in June
--
-- A PIC is a span, not a column on `unit`. Overwriting a column would answer
-- "who is in charge" and destroy "who was": the question an audit of a
-- shortage, a cash difference or an approval actually asks. So each
-- appointment is a row with the day it starts and the day it stops holding,
-- and appointing a successor closes the predecessor's row rather than editing
-- it.
--
-- `valid_to` is the first day the appointment NO LONGER holds (half-open,
-- `[valid_from, valid_to)`), unlike `employee_assignment.valid_to`, which is a
-- last day. The difference is deliberate: a PIC replaced on the day they were
-- appointed — the ordinary way a wrong pick is corrected — closes to an empty
-- span, `[d, d)`, which says truthfully that they were never in charge of a
-- single day. With an inclusive end that correction has no honest spelling.
--
-- # Posted there, and employed
--
-- A PIC must be an active employee posted at that unit on the day the
-- appointment starts. The domain checks it before it writes; the trigger below
-- checks it again for every other writer — a `psql` session, a backfill, the
-- next route somebody adds — because a store answered for by somebody who
-- works at another store is the one mistake this table exists to prevent.
--
-- It is checked when the appointment is made, not for ever after: when the
-- PIC is later transferred or leaves, the row stays as history, and the reader
-- that asks "who is in charge today" requires the posting to still hold (see
-- `postgres::units`). A PIC who has left is nobody's PIC, whether or not
-- anybody has appointed the successor yet.

CREATE TABLE unit_pic (
    id          bigserial PRIMARY KEY,
    unit_id     text NOT NULL REFERENCES unit (id),
    employee_id text NOT NULL REFERENCES employee (id),
    valid_from  date NOT NULL,
    -- Exclusive. NULL while the appointment stands.
    valid_to    date,
    -- Who appointed them (an `app_user.username`), and when. A name rather
    -- than a uuid for the reason `ActorId` gives: a decision is read by
    -- people, after the account may be gone.
    set_by      text NOT NULL CHECK (btrim(set_by) <> ''),
    set_at      timestamptz NOT NULL DEFAULT now(),
    reason      text NOT NULL CHECK (btrim(reason) <> ''),
    CONSTRAINT unit_pic_ends_after_it_starts
        CHECK (valid_to IS NULL OR valid_to >= valid_from)
);

-- One standing appointment per unit. Two open rows would be two people each
-- answerable for the whole unit, which is the same as nobody being.
CREATE UNIQUE INDEX ix_unit_pic_one_open ON unit_pic (unit_id) WHERE valid_to IS NULL;
CREATE INDEX ix_unit_pic_unit ON unit_pic (unit_id, valid_from DESC, id);
CREATE INDEX ix_unit_pic_employee ON unit_pic (employee_id, valid_from DESC);

-- Plain RAISE EXCEPTION (SQLSTATE P0001) on purpose: the API answers that code
-- with 409 and the message below, which is a refusal a person can read, where
-- a constraint-class code would surface as a server fault.
CREATE OR REPLACE FUNCTION assert_unit_pic_is_sound()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NOT EXISTS (SELECT 1 FROM employee e
                        WHERE e.id = NEW.employee_id AND e.status = 'ACTIVE') THEN
            RAISE EXCEPTION USING
                MESSAGE = format('%s is not an active employee, so cannot be put in charge of %s',
                                 NEW.employee_id, NEW.unit_id);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM employee_assignment a
                        WHERE a.employee_id = NEW.employee_id
                          AND a.unit_id = NEW.unit_id
                          AND a.valid_from <= NEW.valid_from
                          AND (a.valid_to IS NULL OR a.valid_to >= NEW.valid_from)) THEN
            RAISE EXCEPTION USING
                MESSAGE = format('%s is not posted at %s on %s, so cannot be put in charge of it',
                                 NEW.employee_id, NEW.unit_id, NEW.valid_from);
        END IF;
    END IF;

    -- No two appointments for one unit may share a day. The unique index
    -- covers the open rows; this covers the closed ones a backfill might write.
    IF EXISTS (SELECT 1 FROM unit_pic p
                WHERE p.unit_id = NEW.unit_id
                  AND p.id <> NEW.id
                  AND daterange(p.valid_from, p.valid_to, '[)')
                      && daterange(NEW.valid_from, NEW.valid_to, '[)')) THEN
        RAISE EXCEPTION USING
            MESSAGE = format('%s already has somebody in charge on a day from %s',
                             NEW.unit_id, NEW.valid_from);
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER unit_pic_is_sound
    BEFORE INSERT OR UPDATE OF unit_id, valid_from, valid_to ON unit_pic
    FOR EACH ROW
    EXECUTE FUNCTION assert_unit_pic_is_sound();

COMMENT ON TABLE unit_pic IS
    'Who is in charge of each unit, over time: [valid_from, valid_to). Must be an '
    'active employee posted at the unit when appointed; stops counting as the '
    'current PIC the day that posting ends. One open appointment per unit.';
