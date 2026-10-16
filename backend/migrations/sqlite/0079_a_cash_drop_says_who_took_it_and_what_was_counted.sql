-- A cash drop names the person who took the cash and the handful it was
-- counted from.
--
-- Owner, 11 Oct 2026: the store head writes a drop the way the till writes the
-- close — note by note — and says who received it. Until now a `DROP` carried
-- an amount and a free-text reason, so "who has the money" lived in a sentence
-- and "what was in it" was not written anywhere.
--
-- `received_by` is the name of whoever took the cash; NULL on every drop the
-- till has rung without one, which stays valid — the till has always posted a
-- drop by amount alone. `cash_movement_count` is `cash_shift_count`'s sibling,
-- one row per denomination, and the movement refuses a sheet that does not add
-- up to the amount beside it (`till::record_cash_movement`). A note and a coin
-- of the same value are one row: the sheet counts values, as the close does.
--
-- An ALTER, so probed in code: applied while `cash_movement.received_by` is
-- absent. The table is `IF NOT EXISTS`.

BEGIN;

ALTER TABLE cash_movement ADD COLUMN received_by TEXT;

CREATE TABLE IF NOT EXISTS cash_movement_count (
    movement_id TEXT NOT NULL REFERENCES cash_movement(id) ON DELETE CASCADE,
    value_minor INTEGER NOT NULL CHECK (value_minor > 0),
    pieces      INTEGER NOT NULL CHECK (pieces > 0),
    PRIMARY KEY (movement_id, value_minor)
);

COMMIT;
