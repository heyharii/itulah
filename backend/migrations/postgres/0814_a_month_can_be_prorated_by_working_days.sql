-- 0814: a month can be prorated by working days.
--
-- Talenta's prorate setting, the owner's "Import/export prorate" of
-- 2026-09-30: somebody who joins, leaves or changes pay mid-month is paid a
-- share of the month — by calendar days (0800's rule, the default), or by
-- working days: Monday to Saturday on a six-day week, Monday to Friday on a
-- five-day week, public holidays not counted. Part of the payroll schedule,
-- so it is dated like the rest of it.

ALTER TABLE payroll_schedule
    ADD COLUMN prorate_basis text NOT NULL DEFAULT 'CALENDAR'
        CHECK (prorate_basis IN ('CALENDAR', 'WORKDAYS_6', 'WORKDAYS_5'));

-- A month counted in working days has 20-odd of them, not 28 to 31.
ALTER TABLE payroll_slip DROP CONSTRAINT payroll_slip_days_in_month_check;
ALTER TABLE payroll_slip ADD CONSTRAINT payroll_slip_days_in_month_check
    CHECK (days_in_month BETWEEN 1 AND 31);

COMMENT ON COLUMN payroll_slip.days_in_month IS
    'The days of the month a share is counted in (0814): calendar days, or the working days of the schedule''s prorate basis.';
