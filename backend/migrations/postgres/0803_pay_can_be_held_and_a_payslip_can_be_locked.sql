-- 0803: pay can be held, and a payslip has a template and can be locked.
--
-- Three of the payroll pieces the owner scoped on 2026-09-30.
--
-- Tahan gaji (ERPNext's Salary Withholding): head office can hold one
-- person's pay on a run — an investigation, missing documents, an absconded
-- employee. The slip is still worked out and still owed (the accrual is the
-- run's gross, unchanged); what the hold stops is paying it: no envelope can be
-- listed for that person on that run until the hold is released.
--
-- The payslip template: what a payslip says around its figures — the
-- company's name and address, a closing note, and whether the company's own
-- contributions are shown to the employee. One row, the company's.
--
-- Password slip gaji (Talenta's "Password payslip"): when the company turns
-- it on, an employee opens their own payslips only with a password of their
-- own, separate from their login — a phone left unlocked on a shop counter
-- does not show what somebody earns. Stored as an Argon2 hash, never the
-- password.

CREATE TABLE payroll_withholding (
    run_id       text NOT NULL REFERENCES payroll_run (id) ON DELETE CASCADE,
    employee_id  text NOT NULL REFERENCES employee (id),
    withheld     jsonb NOT NULL,
    released     jsonb,
    released_at  timestamptz,
    created_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (run_id, employee_id),
    CONSTRAINT payroll_withholding_release_is_signed
        CHECK ((released_at IS NULL) = (released IS NULL))
);

COMMENT ON TABLE payroll_withholding IS
    'Pay held on a run for one person (0803). Still owed and accrued; no payout can be listed for them on that run until released.';

CREATE TABLE payslip_template (
    singleton                   boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    company_name                text,
    company_address             text,
    footer                      text,
    show_company_contributions  boolean NOT NULL DEFAULT true,
    password_required           boolean NOT NULL DEFAULT false,
    updated                     jsonb,
    updated_at                  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO payslip_template (singleton) VALUES (true);

CREATE TABLE payslip_password (
    employee_id  text PRIMARY KEY REFERENCES employee (id) ON DELETE CASCADE,
    hash         text NOT NULL,
    set_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE payslip_password IS
    'The password an employee opens their own payslips with when the company requires one (0803). An Argon2 hash.';
