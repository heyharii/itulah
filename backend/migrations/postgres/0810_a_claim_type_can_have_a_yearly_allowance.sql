-- 0810: a claim type can have a yearly allowance per person.
--
-- Talenta's "Saldo / benefit per karyawan", kept by the owner on 2026-09-30:
-- medical up to Rp3.000.000 a year, glasses once at Rp750.000. A claim type
-- may state, from a date, how much one person may be reimbursed in a calendar
-- year; head office may give one person a different figure for one year.
-- An approval that would take the year past it is refused, naming what is
-- left. No row: no limit, as before.

CREATE TABLE claim_benefit (
    type_code           text NOT NULL REFERENCES expense_claim_type (code),
    effective_from      date NOT NULL,
    -- NULL lifts a limit stated earlier.
    yearly_limit_minor  bigint CHECK (yearly_limit_minor > 0),
    ratified            jsonb NOT NULL,
    created_at          timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (type_code, effective_from)
);

CREATE TABLE claim_benefit_override (
    employee_id   text NOT NULL REFERENCES employee (id),
    type_code     text NOT NULL REFERENCES expense_claim_type (code),
    year          integer NOT NULL CHECK (year BETWEEN 2000 AND 2100),
    limit_minor   bigint NOT NULL CHECK (limit_minor >= 0),
    set_by        jsonb NOT NULL,
    set_at        timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (employee_id, type_code, year)
);
