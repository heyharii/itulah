-- 0801: a run can carry THR, and the month has a cut-off and a pay day.
--
-- Two of the payroll pieces Talenta has and this system lacked, decided on
-- 2026-09-30 when the owner scoped the payroll build ("sesuai Talenta").
--
-- THR (Permenaker 6/2016): an employee with twelve months' continuous service
-- is owed one month's wage (base plus fixed allowances); one with at least a
-- month and less than twelve, months / 12 of it. It is paid in the month of
-- the holiday, so it rides that month's run: head office or the place sets
-- the holiday's date on a draft run, and every slip on it gains a THR line —
-- taxed by that month's TER like any other income, and paid out of the THR
-- accrual payroll has been setting aside since 0466 (`paid_from_accrual`).
--
-- The payroll schedule: when the attendance month closes (the cut-off) and
-- when pay goes out. A cut-off of 20 means September's run counts leave,
-- overtime and rostered days from 21 August to 20 September; NULL means the
-- calendar month. Prorata stays on calendar days — a salary is a month's.
-- Effective-dated, as every rule payroll reads.

ALTER TABLE payroll_run
    ADD COLUMN thr_on date;

COMMENT ON COLUMN payroll_run.thr_on IS
    'The religious holiday THR is paid for on this run (0801); NULL when the run carries no THR. Service is counted to this date.';

INSERT INTO pay_component (code, label, kind, basis, defined, paid_from_accrual)
VALUES ('THR', 'Tunjangan Hari Raya', 'EARNING', 'STATUTORY',
        '{"actor": "system", "action_key": "people.pay_component.define", "at": "2026-09-30T00:00:00Z", "reason": "statutory component seeded by 0801"}',
        true)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE payroll_schedule (
    effective_from date PRIMARY KEY,
    -- The last day of the attendance month, 1–28; NULL = the calendar month.
    cutoff_day     integer CHECK (cutoff_day BETWEEN 1 AND 28),
    -- The day of the month pay goes out, 1–31 (a short month pays on its last
    -- day); NULL = the last day of the month.
    pay_day        integer CHECK (pay_day BETWEEN 1 AND 31),
    ratified       jsonb NOT NULL,
    created_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE payroll_schedule IS
    'When the attendance month closes and when pay goes out, from a date (0801). The row in force for a run is the latest effective_from on or before its first day.';

INSERT INTO payroll_schedule (effective_from, cutoff_day, pay_day, ratified)
VALUES ('2020-01-01', NULL, NULL,
        '{"actor": "system", "action_key": "people.pay_component.ratify", "at": "2026-09-30T00:00:00Z", "reason": "seeded by 0801: the calendar month, paid on its last day"}');
