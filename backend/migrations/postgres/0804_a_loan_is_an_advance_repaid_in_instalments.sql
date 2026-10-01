-- 0804: a loan is an advance repaid from pay in instalments.
--
-- Pinjaman karyawan, kept in scope by the owner on 2026-09-30 ("pinjaman
-- karyawan tetap dibangun"). Talenta's Loan: an amount lent, repaid by a fixed
-- deduction each month until nothing is owed.
--
-- # Not a second ledger of money lent
--
-- This estate already has the thing a loan is made of: an EMPLOYEE advance
-- (0280) — money out before it is earned back, paid by Finance with its own
-- journal (Dr Advance / Cr Bank), and repaid from the wage by a one-off that
-- names it (0347), settled when head office approves the run. What a kasbon
-- lacks is the *plan*: somebody had to file each month's instalment by hand.
-- So a loan is an advance plus this row — how much comes off each month, and
-- from which month — and payroll files the instalment itself when it builds a
-- draft run. Approval settles it exactly as it settles a hand-filed kasbon,
-- and a reopen takes it back the same way.
--
-- # Where the money sits
--
-- A loan advance is qualified OTHERS (1054 Advanced - Others), the account
-- its payout debits; the instalment component credits the same account, so
-- what goes out and what comes back meet in one place.

INSERT INTO pay_component (code, label, kind, basis, defined)
VALUES ('CICILAN_PINJAMAN', 'Cicilan pinjaman', 'DEDUCTION', 'PER_OCCASION',
        '{"actor": "system", "action_key": "people.pay_component.define", "at": "2026-10-01T00:00:00Z", "reason": "loan instalment component seeded by 0804"}')
ON CONFLICT (code) DO NOTHING;

INSERT INTO account_link
    (role, source_type, source_id, scope_type, account_code, set_by, note)
SELECT 'payroll_deduction', 'PAY_COMPONENT', 'CICILAN_PINJAMAN', 'ALL', '1054', 'system',
       'seeded by 0804: a loan instalment comes back to the advance account its payout debited'
 WHERE EXISTS (SELECT 1 FROM ledger_account WHERE account_code = '1054')
ON CONFLICT DO NOTHING;

CREATE TABLE employee_loan_plan (
    advance_id        uuid PRIMARY KEY REFERENCES advance (advance_id),
    employee_id       text NOT NULL REFERENCES employee (id),
    instalment_minor  bigint NOT NULL CHECK (instalment_minor > 0),
    -- The first month an instalment comes off: a run for an earlier month
    -- files none.
    first_period      date NOT NULL CHECK (extract(day from first_period) = 1),
    granted           jsonb NOT NULL,
    -- Instalments stop — repaid in cash, written off, the person left — and
    -- the advance's own settlement says what came back; this only stops the
    -- deductions.
    stopped_at        timestamptz,
    stopped           jsonb,
    created_at        timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT employee_loan_plan_stop_is_signed
        CHECK ((stopped_at IS NULL) = (stopped IS NULL))
);

CREATE INDEX ix_employee_loan_plan_employee ON employee_loan_plan (employee_id);

COMMENT ON TABLE employee_loan_plan IS
    'A loan (0804): an EMPLOYEE advance repaid by a fixed CICILAN_PINJAMAN deduction from first_period on. Payroll files the instalment when it builds a draft run; approval settles it like any kasbon recovery.';
