-- 0105: A salary is a history, not a number.
--
-- Ported from the reference HR backend's `042_employee_pay_v1.sql` and, for the
-- run lifecycle, the retail backend's payroll module.
-- `docs/hr-port-provenance.md` records what changed and what was left behind.
--
-- # Why pay is a table of dated records and not a column
--
-- The obvious schema is a `base_salary` column on the employee row. It is wrong
-- in a way that only shows up months later: a raise in March **overwrites** the
-- figure February was paid from, so February's payslip can no longer be
-- recomputed, an audit cannot check it, and a correction to February silently
-- uses March's rate.
--
-- So pay is a set of non-overlapping effective-dated records, and the only way
-- to ask about money is to ask *as of a date*. There is no "current salary"
-- column, because that is the question that goes wrong.
--
-- # What is deliberately not computed anywhere below
--
-- PPh 21 and the BPJS contributions. They are statutory arithmetic with
-- brackets that change by regulation, and a figure computed here would be filed
-- with the tax office. `statutory_base_minor` on a slip is base plus fixed
-- allowances — a fact about the agreement, which Kepmenaker 102/2004 and
-- several BPJS bases are conventionally computed *against*. Which rule
-- multiplies it by what is not this schema's business and not this backend's.

-- What a person is paid, from one date until the next record supersedes it.
CREATE TABLE employee_pay (
    employee_id      text NOT NULL REFERENCES employee(id) ON DELETE CASCADE,
    effective_from   date NOT NULL,
    -- Gaji pokok, in the smallest unit. A rupiah has no minor unit in practice,
    -- so this is whole rupiah — but it is an integer for the reason every other
    -- money column here is: a float cannot round-trip and cannot be compared.
    base_minor       bigint NOT NULL CHECK (base_minor > 0),
    -- Tunjangan **tetap**: position, housing, and the rest of the standing
    -- lines. A list of `{code, minor}`, and the codes are the operator's own —
    -- a closed enum would mean a deploy every time HR invents a line item.
    --
    -- Tunjangan *tidak tetap* — transport, meals — is deliberately absent. It
    -- is a function of days actually worked, and storing it as a standing
    -- figure is how somebody is paid a meal allowance for a month they were
    -- never in.
    fixed_allowances jsonb NOT NULL DEFAULT '[]'::jsonb,
    -- Who agreed this, when, and why.
    authorized       jsonb NOT NULL,
    created_at       timestamptz NOT NULL DEFAULT now(),
    -- Two records on one day would make "what were they on that day" a question
    -- with two answers and nothing to choose between them.
    PRIMARY KEY (employee_id, effective_from)
);

-- What payroll needs to pay somebody that is not the amount.
--
-- Its own table, and its own privilege. A bank account number and an NPWP are
-- the two most sensitive fields in this schema after the NIK, and they are here
-- rather than on `employee_profile` so a read of one is not a read of the
-- other.
CREATE TABLE payroll_identity (
    employee_id     text PRIMARY KEY REFERENCES employee(id) ON DELETE CASCADE,
    bank_name       text,
    -- Stored whole, and **masked on the way out**: the screen that checks an
    -- account is right needs the last four digits, not the number. See
    -- `PayrollIdentityView`.
    bank_account    text,
    bank_holder     text,
    npwp            text,
    -- TK/0 … K/3 — the PTKP status PPh 21 brackets turn on. Recorded, never
    -- applied.
    ptkp            text,
    bpjs_kesehatan  text,
    bpjs_ketenagakerjaan text,
    -- Append-only, each naming the one field it changed. The same shape
    -- `employee_profile.amendments` uses, and for the same reason: a record
    -- that says what changed but not why is the half of an audit trail that
    -- never helps anybody.
    amendments      jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    -- An account number with no bank and no holder is three ways of being
    -- unable to pay somebody. Either all three or none.
    CONSTRAINT payroll_identity_bank_is_whole CHECK (
        (bank_name IS NULL AND bank_account IS NULL AND bank_holder IS NULL) OR
        (bank_name IS NOT NULL AND bank_account IS NOT NULL AND bank_holder IS NOT NULL)
    )
);

-- One payroll run: one place, one month, and the chain of people who signed it.
--
-- Keyed by `org_place`, not by a store: head office employs people too, and a
-- payroll that could only be run for a shop cannot pay the buyer.
CREATE TABLE payroll_run (
    id            text PRIMARY KEY CHECK (btrim(id) <> ''),
    place_id      text NOT NULL REFERENCES org_place(id),
    period        date NOT NULL CHECK (extract(day from period) = 1),
    -- DRAFT → VERIFIED → APPROVED → SEALED, and REOPENED back to DRAFT.
    state         text NOT NULL CHECK (
                      state IN ('DRAFT', 'VERIFIED', 'APPROVED', 'SEALED')
                  ),
    -- Whether the figures below are the whole story.
    --
    -- They are not, today, and this column is how the run says so rather than
    -- looking settled. There is no punch source, so nothing here knows what was
    -- actually worked — only what was planned, and what leave and overtime were
    -- decided. A run that presented that as a finished payroll would be a run
    -- somebody paid from.
    complete      boolean NOT NULL DEFAULT false,
    incomplete_because text,
    -- Append-only: every verify, approve, seal and reopen, with its authority.
    -- The state is folded back from this on the way in.
    history       jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    -- One run per place per month. A second run for a month somebody has
    -- already been paid for is a correction, and a correction is a new period's
    -- business — not a second answer to the same question.
    CONSTRAINT payroll_run_one_per_place_period UNIQUE (place_id, period),
    -- A run that says it is incomplete must say why, and one that says it is
    -- complete must not carry a reason it is not.
    CONSTRAINT payroll_run_incompleteness_is_explained CHECK (
        (complete AND incomplete_because IS NULL) OR
        (NOT complete AND incomplete_because IS NOT NULL)
    )
);

CREATE INDEX ix_payroll_run_place ON payroll_run (place_id, period DESC);

-- One person's line in one run.
--
-- The figures are the pay agreement in force on the period's first day plus the
-- facts this system actually holds. **No deduction is computed**: the columns
-- for them do not exist, so nothing can quietly acquire a zero that reads as
-- "nothing was owed".
CREATE TABLE payroll_slip (
    run_id             text NOT NULL REFERENCES payroll_run(id) ON DELETE CASCADE,
    employee_id        text NOT NULL REFERENCES employee(id) ON DELETE CASCADE,
    -- Copied from the agreement rather than joined at read time: a raise next
    -- month must not change what this month's slip says.
    base_minor         bigint NOT NULL CHECK (base_minor >= 0),
    fixed_allowances   jsonb NOT NULL DEFAULT '[]'::jsonb,
    -- Base plus fixed allowances. Stored because it is what the agreement said
    -- on the day, not because the sum is hard.
    statutory_base_minor bigint NOT NULL CHECK (statutory_base_minor >= 0),
    -- Facts, not money. What was approved, as this system recorded it.
    leave_days_taken   integer NOT NULL DEFAULT 0 CHECK (leave_days_taken >= 0),
    overtime_minutes   integer NOT NULL DEFAULT 0 CHECK (overtime_minutes >= 0),
    rostered_days      integer NOT NULL DEFAULT 0 CHECK (rostered_days >= 0),
    created_at         timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (run_id, employee_id)
);

COMMENT ON TABLE employee_pay IS
    'Pay as an effective-dated history. There is no current-salary column, '
    'because that is the question that overwrites what a closed month was paid.';
COMMENT ON COLUMN payroll_slip.statutory_base_minor IS
    'Base plus fixed allowances — the figure statutory rules are computed '
    'against. Which rule multiplies it by what is not recorded here.';
COMMENT ON COLUMN payroll_run.complete IS
    'False while no punch source exists: the run knows only what was planned '
    'and what was decided, never what was worked.';
