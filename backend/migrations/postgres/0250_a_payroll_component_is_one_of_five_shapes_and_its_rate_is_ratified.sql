-- 0250: A payroll component is one of five shapes, and its rate is ratified.
--
-- Adapted from the reference HRMS payroll module's `Salary Component`,
-- `Salary Detail` and `Additional Salary`. `docs/hr-port-provenance.md`
-- records every adaptation; the two that decide this file are here.
--
-- # There is no formula column, and there cannot be one
--
-- The reference carries `condition` and `formula` as `Code` fields typed by an
-- operator and evaluated — `_safe_eval(formula, whitelisted_globals, data)` in
-- `salary_slip.py`. That is a database row fed to an interpreter. In Python it
-- is a sandbox somebody maintains; in Rust it would be a second language
-- implemented inside this one, reached by anybody who can write to a table.
--
-- So a component's arithmetic is not text. It is one of **five shapes**, and a
-- shape not in the list is not merely refused — there is no column it could be
-- written into:
--
--   FIXED_AMOUNT               a flat figure every period
--   SHARE_OF_BASE              basis points of a named base, optionally capped
--   RATE_PER_UNIT              money per counted unit
--   FRACTION_OF_BASE_PER_UNIT  a named base ÷ a divisor × a multiplier × units
--   PER_OCCASION               no standing figure at all; one-off only
--
-- `SHARE_OF_BASE` with a cap is how BPJS works. `FRACTION_OF_BASE_PER_UNIT` is
-- Kepmenaker 102/2004 art. 8 and PP 35/2021 art. 31: an hourly wage of 1/173
-- of *upah sebulan*, times a statutory multiplier. `RATE_PER_UNIT` is a
-- transport or meal allowance per day. `PER_OCCASION` is the incentive, the
-- bonus and the *kasbon* instalment, which have no standing figure by
-- definition.
--
-- **No component may name another component.** There is no column for it. So
-- every figure on a slip resolves from the pay agreement this slip already
-- copied plus a count this slip already carries, there is no evaluation order,
-- and a cycle is unrepresentable rather than detected. That is the whole
-- difference between this and an engine.
--
-- # The numbers are ratified separately, and nothing is seeded
--
-- `pay_component` says what *kind of question* a component is — which base,
-- which unit. `pay_component_rate` says the numbers, effective-dated. The
-- split is the reason a component can exist with **no rate**, which is the
-- state this design needs to be able to name: BPJS is expressible here and its
-- percentage is **not written down anywhere in this repository**. An operator
-- states it, the way `overtime_policy` (0103) makes an operator state the
-- overtime caps. Until they do, a slip refuses to report a deduction total,
-- naming the component — rather than reporting nought, which is a claim that
-- somebody looked.
--
-- Effective-dated rather than mutable for the reason `employee_pay` is: a BPJS
-- rate that changes by regulation in January must not rewrite what December was
-- deducted. And the computed figure is **snapshotted onto the slip line**, so
-- even the effective-dated row is only ever consulted once.
--
-- # One catalogue for the company
--
-- No `place_id` anywhere below. A place-scoped component would be thirteen
-- answers to what BPJS costs, and the first one to drift would be the one
-- nobody was looking at. Per-person variation is `payroll_adjustment`, which
-- is a figure somebody filed under their own name with a reason — not a second
-- rule.
--
-- # What of the reference is deliberately absent
--
-- `Salary Structure` and `Salary Structure Assignment`. The reference assigns
-- each employee a structure listing their components, so the same company has
-- as many component sets as it has structures. Here the standing agreement is
-- `employee_pay` (0105), the catalogue below is the company's, and everything
-- that varies per person per month is an adjustment. No assignment table, and
-- nothing to drift out of step with the agreement.
--
-- Also absent: `Income Tax Slab`, `Taxable Salary Slab`, `Employee Tax
-- Exemption *`, `Gratuity`, `Employee Benefit *`. PPh 21 stays outside this
-- system — the owner's decision is gross first, deductions at Finance — and
-- income-tax brackets are not this schema's to write.

-- ---------------------------------------------------------------------------
-- What a component is
-- ---------------------------------------------------------------------------

CREATE TABLE pay_component (
    -- The operator's own vocabulary, upper-cased, exactly as
    -- `employee_pay.fixed_allowances` keys its codes. A closed enum would mean
    -- a deploy every time HR invents a line item.
    code        text PRIMARY KEY CHECK (btrim(code) <> '' AND code = upper(code)),
    -- What a payslip calls it, in the operator's own words. Snapshotted onto
    -- every line, so renaming a component does not rewrite last month's slip.
    label       text NOT NULL CHECK (btrim(label) <> ''),
    -- Whether it adds to gross or comes off it. Amounts are positive
    -- everywhere; this is what says which direction they point. The reference
    -- makes the same choice and for the same reason: a signed amount lets one
    -- typo turn a deduction into a pay rise.
    --
    -- The reference's third value, `Employer Contribution`, is not here. What
    -- the employer pays on top of a wage is a cost of employment and not a
    -- line on a payslip: it changes neither gross nor net, and putting it on
    -- the slip is how a person comes to read a number that was never theirs.
    kind        text NOT NULL CHECK (kind IN ('EARNING', 'DEDUCTION')),
    basis       text NOT NULL CHECK (basis IN (
                    'FIXED_AMOUNT',
                    'SHARE_OF_BASE',
                    'RATE_PER_UNIT',
                    'FRACTION_OF_BASE_PER_UNIT',
                    'PER_OCCASION')),
    -- Which figure from the pay agreement a share or an hourly wage is taken
    -- of. `BASE` is *gaji pokok* alone; `STATUTORY_BASE` is base plus the
    -- standing (*tetap*) allowances, which is the sum Kepmenaker 102/2004 and
    -- several BPJS bases are conventionally computed against, and the figure
    -- `payroll_slip.statutory_base_minor` already carries.
    --
    -- **There is no `GROSS`.** It is the one named base that would make a
    -- component depend on another component's output, and with it would come
    -- an evaluation order, and after that a dependency graph. No rule this
    -- estate implements needs it: an Indonesian statutory base is *upah*, not
    -- the month's takings. The day one does, it is a migration and a new
    -- variant, visible — not a formula somebody typed.
    base_ref    text CHECK (base_ref IN ('BASE', 'STATUTORY_BASE')),
    -- Which count a per-unit component multiplies. A closed list, because the
    -- counts a slip actually holds are a closed list — every one of these is a
    -- column on `payroll_slip` or a group of `overtime_order` rows, and a unit
    -- naming anything else would be a unit nothing could count.
    --
    -- The four overtime bands are the axes the statutory table itself uses:
    -- PP 35/2021 art. 31 pays the first hour of an ordinary working day at one
    -- multiplier and the hours after it at another, and rest days and public
    -- holidays at their own. They are counted in **whole minutes** and priced
    -- by the hour, so the count on a slip line is the same integer
    -- `overtime_order.planned_minutes` holds and the two cannot disagree.
    -- Converting minutes to a decimal of an hour first would introduce a
    -- rounding nobody asked for, twenty minutes being the obvious case.
    --
    -- What is deliberately NOT banded: the rest-day and holiday *ladder*
    -- (art. 31's 2× for the first eight hours, 3× for the ninth, 4× for the
    -- tenth and eleventh). Every rest-day minute lands in one unit here, so an
    -- operator ratifying a single rest-day multiplier will understate a very
    -- long holiday shift. Naming that limit is the point of writing it down;
    -- closing it is three more units and a migration, which is a visible act.
    --
    -- `ROSTERED_DAY` is days **planned**, not days worked. There is no punch
    -- source in this estate, and a unit called `DAY_WORKED` would be a lie the
    -- slip could not support. Every run already says so in
    -- `payroll_run.incomplete_because`.
    unit        text CHECK (unit IN (
                    'OVERTIME_WORKDAY_FIRST_HOUR',
                    'OVERTIME_WORKDAY_LATER',
                    'OVERTIME_REST_DAY',
                    'OVERTIME_HOLIDAY',
                    'ROSTERED_DAY',
                    'LEAVE_DAY_TAKEN')),
    -- Who defined it, when, under which key, and why. The `Authorization`
    -- shape every HR decision is recorded in, and the key gate is re-checked
    -- when the row is decoded.
    defined     jsonb NOT NULL,
    -- Retired, never deleted — the rule the other four master lists follow. A
    -- slip line naming a deleted component would point at nothing, and the
    -- slips it produced are still the record of what somebody was paid.
    retired_at  timestamptz,
    retired     jsonb,
    created_at  timestamptz NOT NULL DEFAULT now(),
    -- Exactly the parts its shape needs, and none it does not. A
    -- `FIXED_AMOUNT` with a unit is a row two readers would disagree about.
    CONSTRAINT pay_component_shape_is_whole CHECK (
        CASE basis
            WHEN 'FIXED_AMOUNT' THEN base_ref IS NULL AND unit IS NULL
            WHEN 'PER_OCCASION' THEN base_ref IS NULL AND unit IS NULL
            WHEN 'SHARE_OF_BASE' THEN base_ref IS NOT NULL AND unit IS NULL
            WHEN 'RATE_PER_UNIT' THEN base_ref IS NULL AND unit IS NOT NULL
            -- An hourly wage times a number of days is not a quantity. This
            -- shape divides a monthly figure by a divisor of hours, so the
            -- unit it multiplies has to be counted in hours — which the four
            -- overtime bands are and the two day counts are not.
            WHEN 'FRACTION_OF_BASE_PER_UNIT' THEN
                base_ref IS NOT NULL
                AND unit IN ('OVERTIME_WORKDAY_FIRST_HOUR',
                             'OVERTIME_WORKDAY_LATER',
                             'OVERTIME_REST_DAY',
                             'OVERTIME_HOLIDAY')
        END
    ),
    CONSTRAINT pay_component_retirement_is_signed
        CHECK ((retired_at IS NULL) = (retired IS NULL)),
    -- Not redundant with the primary key: it is the key the two tables below
    -- point at, and it is what lets each of them CHECK its own columns against
    -- a basis the definition guarantees. A cross-table CHECK is not a thing
    -- Postgres has; a composite foreign key onto a denormalised discriminator
    -- is, and it cannot disagree.
    CONSTRAINT pay_component_basis_is_referenceable UNIQUE (code, basis)
);

-- The catalogue a payroll run reads: what is still in force, in payslip order.
CREATE INDEX ix_pay_component_in_force ON pay_component (kind, code)
    WHERE retired_at IS NULL;

-- ---------------------------------------------------------------------------
-- What it is worth, as somebody ratified it
-- ---------------------------------------------------------------------------

CREATE TABLE pay_component_rate (
    component_code  text NOT NULL,
    -- Carried so the CHECK below can see it. Pinned to the definition's own
    -- value by the composite foreign key, so it is a copy that cannot drift
    -- rather than a second opinion.
    basis           text NOT NULL,
    effective_from  date NOT NULL,
    -- FIXED_AMOUNT: the flat figure.
    amount_minor    bigint CHECK (amount_minor > 0),
    -- RATE_PER_UNIT: money per whole unit — per rostered day, per hour of
    -- overtime, per day of leave taken.
    rate_minor      bigint CHECK (rate_minor > 0),
    -- SHARE_OF_BASE: basis points. Not a float anywhere: 4% is 400, and 0.04
    -- is a number that cannot be compared, cannot round-trip, and sums
    -- differently depending on the order. The ceiling is 1 000 000 bp —
    -- ten thousand per cent — which is not a policy, only a refusal of a
    -- figure that is certainly a typo.
    rate_bp         integer CHECK (rate_bp > 0 AND rate_bp <= 1000000),
    -- SHARE_OF_BASE, optional: the ceiling the share is taken of. This is how
    -- BPJS Kesehatan works — a percentage of wage up to a stated maximum wage,
    -- not a percentage up to a maximum contribution. NULL means uncapped,
    -- which is a real and different statement.
    cap_minor       bigint CHECK (cap_minor > 0),
    -- FRACTION_OF_BASE_PER_UNIT: the divisor that turns a monthly wage into an
    -- hourly one. 173 in Kepmenaker 102/2004 art. 8, and **not compiled into
    -- the binary** for the reason `overtime_policy` gives about the caps: the
    -- figures before the current regulation were different ones, and a
    -- constant in a Rust file would have been silently wrong for every
    -- deployment that upgraded across the change.
    hours_divisor   integer CHECK (hours_divisor > 0),
    -- FRACTION_OF_BASE_PER_UNIT: the statutory multiplier, in basis points.
    -- 1.5× is 15000 and 2× is 20000. Basis points rather than a decimal for
    -- the reason above, and because 1.5 is the one multiplier that is exactly
    -- representable in binary floating point out of the four the regulation
    -- uses — which is the sort of luck that hides a bug for a year.
    multiplier_bp   integer CHECK (multiplier_bp > 0),
    -- Who ratified it, when, under which key, and why. This is the row an
    -- auditor reads to answer "who decided BPJS was 1% here, and when".
    ratified        jsonb NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    -- Two rates from one day would make "what was the rate that day" a
    -- question with two answers and nothing to choose between them — the rule
    -- `employee_pay` states with the same primary key.
    PRIMARY KEY (component_code, effective_from),
    FOREIGN KEY (component_code, basis)
        REFERENCES pay_component (code, basis) ON DELETE CASCADE,
    -- Exactly the numbers its shape needs. A `SHARE_OF_BASE` rate carrying an
    -- `hours_divisor` is a row somebody would later read as an overtime rate.
    --
    -- `PER_OCCASION` resolves to `false`, so a rate for one cannot be written
    -- at all. That is the shape's definition rather than an omission: there is
    -- nothing standing to ratify, and its figure arrives one person and one
    -- month at a time in `payroll_adjustment`.
    CONSTRAINT pay_component_rate_states_exactly_its_basis CHECK (
        CASE basis
            WHEN 'FIXED_AMOUNT' THEN
                amount_minor IS NOT NULL AND rate_minor IS NULL
                AND rate_bp IS NULL AND cap_minor IS NULL
                AND hours_divisor IS NULL AND multiplier_bp IS NULL
            WHEN 'RATE_PER_UNIT' THEN
                rate_minor IS NOT NULL AND amount_minor IS NULL
                AND rate_bp IS NULL AND cap_minor IS NULL
                AND hours_divisor IS NULL AND multiplier_bp IS NULL
            WHEN 'SHARE_OF_BASE' THEN
                rate_bp IS NOT NULL AND amount_minor IS NULL
                AND rate_minor IS NULL
                AND hours_divisor IS NULL AND multiplier_bp IS NULL
            WHEN 'FRACTION_OF_BASE_PER_UNIT' THEN
                hours_divisor IS NOT NULL AND multiplier_bp IS NOT NULL
                AND amount_minor IS NULL AND rate_minor IS NULL
                AND rate_bp IS NULL AND cap_minor IS NULL
            WHEN 'PER_OCCASION' THEN false
        END
    )
);

-- ---------------------------------------------------------------------------
-- What one place is asking to pay one person, once
-- ---------------------------------------------------------------------------
--
-- The reference's `Additional Salary`, which is the gap the owner cares most
-- about: the place submits the whole payroll batch and sees the figures
-- (0231), and without this it can only resend numbers head office has already
-- fixed. An incentive, a *kasbon* instalment, a one-month bonus, a transport
-- allowance somebody is owed for a fortnight — all of them are this row.
--
-- # Keyed by the month, not by the run
--
-- The reference keys `Additional Salary` by a free `payroll_date` and lets
-- whichever slip covers it pick it up. Here it is (place, month), because a
-- run is one place and one month and nothing else. Not keyed by `run_id`,
-- deliberately: a run may only be opened once the attendance period is closed,
-- so a run-keyed adjustment could not be filed in the month it was earned. The
-- place files as the month happens; the run collects what is there when it is
-- built.
--
-- # It rides the run's own decide-and-return path
--
-- There is no second approval chain here, and no state column. An adjustment
-- is writable while its month has no run or a `DRAFT` one, and frozen the
-- moment the place submits — so the decision on it is the decision on the
-- batch it is part of, taken by head office under `people.payroll.approve`,
-- and the way back is the reopen that already exists and already clears both
-- signatures.
--
-- The alternative — its own PROPOSED → APPROVED/RETURNED machine, the shape
-- `hire_proposal` has — was rejected on the ground that it would ask head
-- office to approve the same figure twice: once as an adjustment and again as
-- part of the batch carrying it. Two approvals of one number is how two
-- screens come to disagree about whether something was decided. `hire_proposal`
-- needs its own machine because nothing else carries a candidate; an
-- adjustment has a batch to ride.
--
-- The freeze is enforced where it can be seen — in `postgres::components`,
-- against `payroll_run.state` in the same transaction as the write — and not
-- by a trigger, because the refusal has to name the run and the month in a
-- sentence somebody reads.
--
-- # Only a PER_OCCASION component
--
-- The reference lets an `Additional Salary` *overwrite* a structure
-- component's amount (`overwrite_salary_structure_amount`), which means one
-- component can produce two figures and something has to decide which wins.
-- Here it cannot: an adjustment may only name a component whose shape is
-- `PER_OCCASION`, enforced by the composite foreign key below, and such a
-- component has no standing figure to collide with. So no line on any slip is
-- ever the answer to "which of these two won".

CREATE TABLE payroll_adjustment (
    id             text PRIMARY KEY CHECK (btrim(id) <> ''),
    -- Which shop is asking. `org_place`, like the run, because head office
    -- employs people too and an adjustment that could only be filed by a shop
    -- could not pay the buyer an incentive.
    place_id       text NOT NULL REFERENCES org_place(id),
    period         date NOT NULL CHECK (extract(day from period) = 1),
    -- No CASCADE from `employee`: nothing deletes a person here — employment
    -- ends, it is not erased — and if something ever tries, a filed figure
    -- somebody signed for is the wrong thing to remove quietly.
    employee_id    text NOT NULL REFERENCES employee(id),
    component_code text NOT NULL,
    -- Pinned to `PER_OCCASION` by the CHECK and to the component's own shape
    -- by the foreign key, so the two cannot disagree. See the header.
    basis          text NOT NULL CHECK (basis = 'PER_OCCASION'),
    -- Positive, always. Which way it points is the component's `kind`, so a
    -- *kasbon* instalment is a positive amount under a DEDUCTION component and
    -- an incentive is a positive amount under an EARNING one. The reference
    -- refuses a negative amount for the same reason.
    amount_minor   bigint NOT NULL CHECK (amount_minor > 0),
    -- Who filed it, when, under which key, and why. The reason is not
    -- decoration here: this is the one figure on a payslip that head office
    -- did not agree in advance, so "why" is the whole of what it is approving.
    filed          jsonb NOT NULL,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    -- One figure per person per component per month. Two incentives for one
    -- person in one month are one incentive of the sum, or two different
    -- components — and either way somebody has to say which. The reference
    -- refuses duplicates in application code
    -- (`validate_duplicate_additional_salary`); this refuses them in the key.
    CONSTRAINT payroll_adjustment_one_per_component
        UNIQUE (place_id, period, employee_id, component_code),
    FOREIGN KEY (component_code, basis)
        REFERENCES pay_component (code, basis)
);

-- The batch query: what one place has filed for one month.
CREATE INDEX ix_payroll_adjustment_batch
    ON payroll_adjustment (place_id, period, employee_id);

COMMENT ON TABLE pay_component IS
    'What a payroll line is: one of five shapes, never a formula. The '
    'reference this is adapted from evaluates operator-typed Python; a shape '
    'not in the CHECK above has no column to be written into (0250).';
COMMENT ON TABLE pay_component_rate IS
    'The numbers, effective-dated and ratified under somebody''s name. '
    'NOTHING IS SEEDED: no BPJS percentage and no overtime multiplier exists '
    'in this repository. A component with no rate in force makes a slip refuse '
    'to report a deduction total, naming the component — never report nought.';
COMMENT ON COLUMN pay_component_rate.hours_divisor IS
    'The 1/173 of Kepmenaker 102/2004 art. 8, as a policy input an operator '
    'states and an auditor can see — not a constant in a binary.';
COMMENT ON TABLE payroll_adjustment IS
    'One figure one place is asking to pay one person once, in one month. It '
    'carries no state: it is writable while its month''s run is absent or '
    'DRAFT and frozen by the submission, so the decision on it is head '
    'office''s decision on the batch it rides (0250).';
