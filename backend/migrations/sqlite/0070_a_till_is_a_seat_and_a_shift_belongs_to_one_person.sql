-- A till is a seat the store has, and a shift is one person's drawer at it.
--
-- Owner, 30 Sep 2026: "kasir" is a position under the store — Kasir 1,
-- Kasir 2 — and head office decides how many there are. A machine does not
-- become a till by joining; it sits at one. Whoever signs in picks a seat and
-- counts in their own float; somebody else may take the seat over, and the
-- drawer they leave is counted by them, never by the person arriving.
--
-- `till_count` is head office's number, carried with the site profile like
-- `opened` (0061). NULL: an older centre that has not said, read as one seat.
--
-- `business_date` is the day a shift trades for, fixed when it opens in the
-- store's own time. A shift opened at 23:00 that runs past midnight is still
-- that evening's takings.
--
-- `taken_over_by`: the shift ended because somebody took the seat, not because
-- its holder closed it. It is CLOSED with nothing declared until its holder
-- counts what they took out; `counted_at` says when that happened.
BEGIN;

ALTER TABLE site_directory ADD COLUMN till_count INTEGER
    CHECK (till_count IS NULL OR till_count BETWEEN 0 AND 50);

ALTER TABLE cash_shift ADD COLUMN business_date TEXT;
ALTER TABLE cash_shift ADD COLUMN taken_over_by TEXT;
ALTER TABLE cash_shift ADD COLUMN counted_at TEXT;

-- Shifts already written trade for the day they opened, in the store's own
-- time — the rule every new shift follows.
UPDATE cash_shift
   SET business_date = date(
           opened_at,
           COALESCE((SELECT utc_offset_minutes FROM site_directory WHERE is_own = 1), 420)
               || ' minutes'
       )
 WHERE business_date IS NULL;

UPDATE cash_shift SET counted_at = closed_at
 WHERE status = 'CLOSED' AND declared_cash_minor IS NOT NULL AND counted_at IS NULL;

CREATE INDEX IF NOT EXISTS cash_shift_open_by_person
    ON cash_shift(opened_by) WHERE status = 'OPEN';

COMMIT;
